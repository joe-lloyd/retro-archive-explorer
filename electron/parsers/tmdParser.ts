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
 * Parse a Resident Evil 1 enemy mesh section (id-less `[length, unknown, count]`
 * header). Unlike a standard TMD, its primitives are FIXED 28-byte triangles:
 *   u32 unknown; u8 tu0,tv0; u16 clut; u8 tu1,tv1; u16 page; u8 tu2,tv2; u16 pad;
 *   u16 n0,v0; u16 n1,v1; u16 n2,v2;
 * (structs from pmandin/reevengi-tools src/emd1.h). Vertices are emd_vertex4_t
 * (x,y,z,pad int16). Object offsets are relative to the 12-byte header.
 */
export function parseRe1EnemyMesh(buffer: Buffer, namePrefix = 'part'): MeshObject[] {
  const r = new BinaryReader(buffer);
  r.u32(); // length
  r.u32(); // unknown
  const count = r.u32();
  if (count === 0 || count > MAX_OBJECTS) throw new Error(`implausible RE1 mesh count ${count}`);

  interface Obj { vtxOff: number; vtxCount: number; triOff: number; triCount: number }
  const objs: Obj[] = [];
  r.seek(HEADER_SIZE);
  for (let i = 0; i < count; i++) {
    const vtxOff = r.u32() + HEADER_SIZE;
    const vtxCount = r.u32();
    r.u32(); // nor_offset
    r.u32(); // nor_count
    const triOff = r.u32() + HEADER_SIZE;
    const triCount = r.u32();
    r.u32(); // dummy
    objs.push({ vtxOff, vtxCount, triOff, triCount });
  }

  const meshes: MeshObject[] = [];
  objs.forEach((o, i) => {
    if (o.vtxCount > MAX_VERTS || o.triCount > MAX_PRIMS) throw new Error('RE1 mesh part too large');
    const pos = new Float32Array(o.vtxCount * 3);
    r.seek(o.vtxOff);
    for (let v = 0; v < o.vtxCount; v++) {
      pos[v * 3] = r.i16();
      pos[v * 3 + 1] = r.i16();
      pos[v * 3 + 2] = r.i16();
      r.u16(); // pad
    }

    const out = new MeshBuilder();
    out.hasTexture = true;
    r.seek(o.triOff);
    for (let t = 0; t < o.triCount; t++) {
      r.u32(); // unknown
      const tu0 = r.u8(); const tv0 = r.u8(); r.u16(); // clut
      const tu1 = r.u8(); const tv1 = r.u8(); r.u16(); // page
      const tu2 = r.u8(); const tv2 = r.u8(); r.u16(); // pad
      r.u16(); const v0 = r.u16();
      r.u16(); const v1 = r.u16();
      r.u16(); const v2 = r.u16();
      if (v0 >= o.vtxCount || v1 >= o.vtxCount || v2 >= o.vtxCount) continue;
      const verts: [number, number, number][] = [
        [v0, tu0, tv0],
        [v1, tu1, tv1],
        [v2, tu2, tv2],
      ];
      for (const [vi, tu, tv] of verts) {
        out.positions.push(pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]);
        out.colors.push(TEX_GRAY[0], TEX_GRAY[1], TEX_GRAY[2]);
        out.uvs.push(tu, tv);
      }
      out.triangleCount++;
    }
    if (out.triangleCount > 0) {
      meshes.push({
        name: `${namePrefix}_${i}`,
        positions: Float32Array.from(out.positions),
        colors: Float32Array.from(out.colors),
        uvs: Float32Array.from(out.uvs),
        triangleCount: out.triangleCount,
      });
    }
  });
  return meshes;
}

/**
 * Compute each bone's world position from the EMD skeleton section by
 * accumulating per-bone relative positions down the armature hierarchy.
 * Layout (reevengi emd_common.h / emd2xml.c): header
 * `{u16 relpos_len, move_offset, count, move_size}`; relative positions
 * `int16 x,y,z` per bone at `skel+8`; armature `{u16 num_mesh, offset}` per bone
 * at `skel+relpos_len`, with child bone indices as bytes at `armature+offset`.
 */
function parseEmdSkeleton(buffer: Buffer, skelOff: number): number[][] {
  const relposLen = buffer.readUInt16LE(skelOff);
  const count = buffer.readUInt16LE(skelOff + 4);
  if (count === 0 || count > 512) throw new Error('implausible bone count');
  const relposBase = skelOff + 8;
  const armBase = skelOff + relposLen;
  const world: number[][] = Array.from({ length: count }, () => [0, 0, 0]);
  const seen = new Set<number>();

  const dfs = (bone: number, px: number, py: number, pz: number): void => {
    if (bone >= count || seen.has(bone)) return;
    seen.add(bone);
    const rx = buffer.readInt16LE(relposBase + bone * 6);
    const ry = buffer.readInt16LE(relposBase + bone * 6 + 2);
    const rz = buffer.readInt16LE(relposBase + bone * 6 + 4);
    const wx = px + rx, wy = py + ry, wz = pz + rz;
    world[bone] = [wx, wy, wz];
    const numMesh = buffer.readUInt16LE(armBase + bone * 4);
    const off = buffer.readUInt16LE(armBase + bone * 4 + 2);
    for (let i = 0; i < numMesh; i++) {
      const at = armBase + off + i;
      if (at < buffer.length) dfs(buffer[at], wx, wy, wz);
    }
  };
  dfs(0, 0, 0, 0);
  return world;
}

/** Translate each mesh part's vertices by its bone's accumulated world position. */
function assembleBySkeleton(objects: MeshObject[], world: number[][]): void {
  objects.forEach((o, i) => {
    const w = world[i];
    if (!w) return; // extra objects with no bone stay where they are
    for (let j = 0; j < o.positions.length; j += 3) {
      o.positions[j] += w[0];
      o.positions[j + 1] += w[1];
      o.positions[j + 2] += w[2];
    }
  });
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

  // Characters store a standard TMD (id 0x41); enemies use the id-less mesh with
  // fixed 28-byte triangles — decode each with the matching parser.
  const meshBuf = buffer.subarray(mesh, tim);
  const objects =
    meshBuf.length >= 4 && meshBuf.readUInt32LE(0) === TMD_ID
      ? parseTmd(meshBuf, 'part')
      : parseRe1EnemyMesh(meshBuf, 'part');
  if (objects.length === 0) throw new Error('EMD mesh section produced no geometry');

  // Mesh parts are stored in bone-local space; place each by its skeleton bone's
  // accumulated world position so the model assembles instead of stacking.
  try {
    assembleBySkeleton(objects, parseEmdSkeleton(buffer, skel));
  } catch {
    // If the skeleton can't be read, render parts unassembled rather than fail.
  }

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
