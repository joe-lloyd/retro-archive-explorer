import type { MeshObject, ModelAsset, ModelTexture } from '../../shared/types';
import { BinaryReader } from './binaryReader';
import { parseTim } from './timParser';

// TMD id longword: version 0x41 in the low byte -> u32 LE 0x00000041.
const TMD_ID = 0x00000041;
const HEADER_SIZE = 12;

const MAX_OBJECTS = 4096;
const MAX_VERTS = 1_000_000;
const MAX_PRIMS = 1_000_000;

// Neutral color for textured faces when no texture is resolved.
const TEX_GRAY: [number, number, number] = [0.62, 0.62, 0.66];

interface ObjEntry {
  vertTop: number;
  nVert: number;
  primTop: number;
  nPrim: number;
}

/** Accumulates expanded (non-indexed) triangle data for one object. */
class MeshBuilder {
  positions: number[] = [];
  colors: number[] = [];
  uvs: number[] = [];
  hasTexture = false;
  triangleCount = 0;
}

function readObjectTable(r: BinaryReader, nobj: number, base: number): ObjEntry[] {
  const objects: ObjEntry[] = [];
  for (let i = 0; i < nobj; i++) {
    const vertTop = r.u32();
    const nVert = r.u32();
    r.u32(); // normal_top
    r.u32(); // n_normal
    const primTop = r.u32();
    const nPrim = r.u32();
    r.i32(); // scale (power-of-two exponent; ignored for display)
    objects.push({ vertTop: vertTop + base, nVert, primTop: primTop + base, nPrim });
  }
  return objects;
}

/** Read an object's vertex table into a flat XYZ array indexed by vertex id. */
function readVertices(r: BinaryReader, entry: ObjEntry): Float32Array {
  if (entry.nVert > MAX_VERTS) throw new Error('vertex count exceeds sane limit');
  const positions = new Float32Array(entry.nVert * 3);
  r.seek(entry.vertTop);
  for (let i = 0; i < entry.nVert; i++) {
    positions[i * 3] = r.i16();
    positions[i * 3 + 1] = r.i16();
    positions[i * 3 + 2] = r.i16();
    r.u16(); // pad
  }
  return positions;
}

/**
 * Decode one polygon primitive's vertex indices, per-vertex colors and UVs.
 *
 * TMD polygon packets store, in order: an optional color/UV preamble, then the
 * normal+vertex tail. The one runtime unknown is whether normals are present; we
 * resolve it by checking which layout's word count matches the packet's declared
 * `ilen` (self-consistency), then read the vertices from the correct positions.
 */
function decodePrimitive(
  r: BinaryReader,
  packetStart: number,
  ilenWords: number,
  mode: number,
  positions: Float32Array,
  vertCount: number,
  out: MeshBuilder,
): void {
  const code = (mode >> 5) & 0x07;
  if (code !== 1) return; // polygons only (skip lines/sprites)

  const gouraud = ((mode >> 4) & 1) === 1;
  const quad = ((mode >> 3) & 1) === 1;
  const textured = ((mode >> 2) & 1) === 1;
  const nverts = quad ? 4 : 3;

  const preambleWords = textured ? nverts : gouraud ? nverts : 1;
  const geomWithNormals = gouraud ? nverts : Math.ceil((1 + nverts) / 2);
  const geomNoNormals = Math.ceil(nverts / 2);

  let hasNormals: boolean;
  if (preambleWords + geomWithNormals === ilenWords) hasNormals = true;
  else if (preambleWords + geomNoNormals === ilenWords) hasNormals = false;
  else if (preambleWords + geomWithNormals <= ilenWords) hasNormals = true;
  else if (preambleWords + geomNoNormals <= ilenWords) hasNormals = false;
  else return; // packet too small for any known layout

  // --- Preamble: colors or UVs ---
  const vColors: [number, number, number][] = [];
  const vUvs: [number, number][] = [];
  r.seek(packetStart);
  if (textured) {
    for (let i = 0; i < nverts; i++) {
      const u = r.u8();
      const v = r.u8();
      r.u16(); // cba (i==0) / tsb (i==1) / pad — page/palette; not applied here
      vUvs.push([u, v]);
      vColors.push(TEX_GRAY);
    }
    out.hasTexture = true;
  } else if (gouraud) {
    for (let i = 0; i < nverts; i++) {
      const rr = r.u8();
      const gg = r.u8();
      const bb = r.u8();
      r.u8(); // mode/pad
      vColors.push([rr / 255, gg / 255, bb / 255]);
    }
  } else {
    const rr = r.u8();
    const gg = r.u8();
    const bb = r.u8();
    r.u8(); // mode
    const c: [number, number, number] = [rr / 255, gg / 255, bb / 255];
    for (let i = 0; i < nverts; i++) vColors.push(c);
  }

  // --- Geometry tail: normals + vertices ---
  r.seek(packetStart + preambleWords * 4);
  const verts: number[] = [];
  if (hasNormals && gouraud) {
    for (let i = 0; i < nverts; i++) {
      r.u16(); // normal
      verts.push(r.u16());
    }
  } else if (hasNormals) {
    r.u16(); // single face normal
    for (let i = 0; i < nverts; i++) verts.push(r.u16());
  } else {
    for (let i = 0; i < nverts; i++) verts.push(r.u16());
  }

  // Reject primitives that reference vertices we don't have, rather than corrupt.
  for (const vi of verts) if (vi >= vertCount) return;

  const tris = nverts === 4 ? [[0, 1, 2], [1, 3, 2]] : [[0, 1, 2]];
  for (const tri of tris) {
    for (const k of tri) {
      const vi = verts[k];
      out.positions.push(positions[vi * 3], positions[vi * 3 + 1], positions[vi * 3 + 2]);
      out.colors.push(vColors[k][0], vColors[k][1], vColors[k][2]);
      const uv = vUvs[k] ?? [0, 0];
      out.uvs.push(uv[0], uv[1]);
    }
    out.triangleCount++;
  }
}

/**
 * Parse a TMD blob (or an RE1 EMD object-mesh section) into mesh objects.
 * Standard TMD headers are `[id=0x41, flags, nobj]`; RE1's EMD mesh section uses
 * the same object/primitive layout but an id-less `[length, unknown, nobj]`
 * header — both have a 12-byte header, 28-byte object entries, and base=12.
 */
export function parseTmd(buffer: Buffer, namePrefix = 'object'): MeshObject[] {
  const r = new BinaryReader(buffer);
  const w0 = r.u32();
  let nobj: number;
  let base: number;
  if (w0 === TMD_ID) {
    const flags = r.u32();
    nobj = r.u32();
    base = (flags & 0x01) !== 0 ? 0 : HEADER_SIZE; // FIXP: absolute vs header-relative
  } else {
    r.u32(); // unknown
    nobj = r.u32();
    base = HEADER_SIZE;
  }
  if (nobj === 0 || nobj > MAX_OBJECTS) throw new Error(`implausible object count ${nobj}`);

  r.seek(HEADER_SIZE);
  const table = readObjectTable(r, nobj, base);

  const meshes: MeshObject[] = [];
  table.forEach((entry, i) => {
    if (entry.nPrim > MAX_PRIMS) throw new Error('primitive count exceeds sane limit');
    const positions = readVertices(r, entry);
    const out = new MeshBuilder();

    r.seek(entry.primTop);
    for (let p = 0; p < entry.nPrim; p++) {
      if (r.remaining < 4) break;
      r.u8(); // olen
      const ilen = r.u8();
      r.u8(); // flag
      const mode = r.u8();
      const packetStart = r.offset;
      const packetBytes = ilen * 4;
      if (packetBytes < 0 || r.remaining < packetBytes) break;
      decodePrimitive(r, packetStart, ilen, mode, positions, entry.nVert, out);
      r.seek(packetStart + packetBytes);
    }

    if (out.triangleCount > 0) {
      meshes.push({
        name: `${namePrefix}_${i}`,
        positions: Float32Array.from(out.positions),
        colors: Float32Array.from(out.colors),
        uvs: out.hasTexture ? Float32Array.from(out.uvs) : undefined,
        triangleCount: out.triangleCount,
      });
    }
  });
  return meshes;
}

/**
 * Parse a Resident Evil 1 `.EMD` via its real container layout: a directory of
 * four little-endian offsets at `filesize - 16` pointing to
 * `[skeleton, animation, mesh, texture]`. The mesh section is a TMD-style object
 * mesh (id-less for enemies), and the texture is an embedded TIM.
 * (Format: pmandin/reevengi-tools wiki, ".EMD (Resident Evil)".)
 */
export function parseEmdContainer(buffer: Buffer): ModelAsset {
  if (buffer.length < 32) throw new Error('EMD too small for a directory');
  const dirOff = buffer.length - 16;
  const dir = [0, 1, 2, 3].map((i) => buffer.readUInt32LE(dirOff + i * 4));
  const [skel, anim, mesh, tim] = dir;
  // Directory must be ascending offsets inside the file.
  if (!(skel < anim && anim < mesh && mesh < tim && tim < buffer.length)) {
    throw new Error('EMD directory offsets are not a valid ascending table');
  }
  void skel;
  void anim;

  const objects = parseTmd(buffer.subarray(mesh, tim), 'part');
  if (objects.length === 0) throw new Error('EMD mesh section produced no geometry');

  let texture: ModelTexture | undefined;
  try {
    const tex = parseTim(buffer.subarray(tim));
    texture = { width: tex.width, height: tex.height, pixels: tex.pixels };
  } catch {
    texture = undefined;
  }
  return { kind: 'model', objects, texture, sourceExt: 'emd' };
}

/** Parse an `.EMD`/`.IVM`/`.DOR` by scanning for embedded TMD blocks. */
export function parseEmd(buffer: Buffer): MeshObject[] {
  const meshes: MeshObject[] = [];
  let block = 0;
  for (let off = 0; off + HEADER_SIZE <= buffer.length; off += 4) {
    if (buffer.readUInt32LE(off) !== TMD_ID) continue;
    const nobj = buffer.readUInt32LE(off + 8);
    if (nobj === 0 || nobj > 256) continue;
    try {
      const sub = parseTmd(buffer.subarray(off), `block${block}`);
      if (sub.length > 0) {
        meshes.push(...sub);
        block++;
      }
    } catch {
      // Not a real TMD block; keep scanning.
    }
  }
  if (meshes.length === 0) throw new Error('no TMD blocks found in EMD');
  return meshes;
}

/** Best-effort: find an embedded TIM and decode it as a model texture. */
export function findEmbeddedTexture(buffer: Buffer): ModelTexture | undefined {
  for (let off = 0; off + 8 <= buffer.length; off += 4) {
    if (buffer.readUInt32LE(off) !== 0x00000010) continue; // TIM magic
    try {
      const tex = parseTim(buffer.subarray(off));
      if (tex.width >= 8 && tex.height >= 8 && tex.width <= 2048 && tex.height <= 2048) {
        return { width: tex.width, height: tex.height, pixels: tex.pixels };
      }
    } catch {
      // keep scanning
    }
  }
  return undefined;
}

/** Dispatch by extension and wrap the result as a ModelAsset. */
export function parseModel(buffer: Buffer, extension: string | undefined): ModelAsset {
  // EMD uses its real directory container (mesh + texture located precisely).
  if (extension === 'emd') {
    return parseEmdContainer(buffer);
  }
  // IVM/DOR embed TMD blocks at non-zero offsets (plus a TIM); scan for them.
  if (extension === 'ivm' || extension === 'dor') {
    const objects = parseEmd(buffer);
    const texture = findEmbeddedTexture(buffer);
    return { kind: 'model', objects, texture, sourceExt: extension };
  }
  const objects = parseTmd(buffer);
  const texture = findEmbeddedTexture(buffer);
  return { kind: 'model', objects, texture, sourceExt: extension };
}
