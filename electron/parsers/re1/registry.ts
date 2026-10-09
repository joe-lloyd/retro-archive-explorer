import type {
  ArchiveAsset,
  ParsedAsset,
  StructuredAsset,
  StructuredField,
  StructuredSection,
  VirtualNode,
} from '../../../shared/types';
import { unpackContainer } from '../rdtParser';
import { vabSamples } from '../audio/psxAudio';
import { parseRdt1 } from './rdt1';

/** Human-readable metadata for each recognized RE1 engine extension. */
export const RE1_FORMATS: Record<string, { name: string; description: string }> = {
  rdt: {
    name: 'Room Data Table (RDT)',
    description:
      'Master container for one room: pre-rendered background, collision walkmesh, camera angles, lighting and enemy spawns.',
  },
  dat: {
    name: 'Packed Archive (DAT)',
    description: 'General archive packing multiple smaller assets together to reduce disc reads.',
  },
  emd: { name: 'Enemy/Character Model (EMD)', description: 'Enemy and character 3D models.' },
  ivm: { name: 'Inventory Model (IVM)', description: 'Inventory item 3D models inspected in the menu.' },
  dor: { name: 'Door Data (DOR)', description: 'Door transition animations and logic.' },
  pix: { name: 'Background Pixels (PIX)', description: 'Raw 2D background pixel data.' },
  esp: { name: 'Sprite Effects (ESP)', description: '2D sprite effects: blood, muzzle flashes, fire.' },
  emw: { name: 'Enemy Animation/Weapons (EMW)', description: 'Enemy animation sets and weapon properties.' },
  stf: { name: 'Text Data (STF)', description: 'Text data, typically the staff roll and credits.' },
  tim: { name: 'PSX Texture (TIM)', description: 'PlayStation texture image with CLUT palette.' },
  tmd: { name: 'PSX Model (TMD)', description: 'PlayStation 3D model (vertices, normals, primitives).' },
  hed: { name: 'Sound Header (HED)', description: 'Sound-bank header describing samples packed in the paired .VB body.' },
  vb: { name: 'Sound Body (VB)', description: 'SPU-ADPCM sample body; boundaries described by the paired .HED.' },
  exe: { name: 'PSX Executable (PS-X EXE)', description: 'PlayStation executable/overlay code — not a movie. FMV videos are the .STR files.' },
  str: { name: 'PSX Video Stream (STR)', description: 'MDEC/XA streamed FMV video. Playback needs an MDEC decoder (not yet implemented).' },
};

function hex(n: number, width = 0): string {
  const s = (n >>> 0).toString(16);
  return '0x' + (width ? s.padStart(width, '0') : s);
}

function overviewSection(bytes: Uint8Array): StructuredSection {
  const head = Array.from(bytes.subarray(0, 16))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
  let printable = 0;
  const sample = bytes.subarray(0, 256);
  for (const b of sample) if (b === 0x0a || b === 0x0d || (b >= 0x20 && b < 0x7f)) printable++;
  return {
    title: 'Overview',
    fields: [
      { label: 'Size', value: `${bytes.length} bytes` },
      { label: 'First 16 bytes', value: head },
      { label: 'Printable ratio', value: sample.length ? `${Math.round((printable / sample.length) * 100)}%` : 'n/a' },
    ],
  };
}

/** Extension for an RDT section, so embedded models, textures and sounds open in their viewers. */
function sectionExt(name: string, buf: Buffer, offset: number): string {
  const dot = name.lastIndexOf('.');
  const ext = name.slice(dot + 1);
  if (['tim', 'tmd', 'vh', 'vb', 'scd'].includes(ext)) return ext;
  if (offset + 4 <= buf.length && buf.readUInt32LE(offset) === 0x10) return 'tim';
  return 'bin';
}

/**
 * Interpret an RE1 room file as an expandable archive of its sections, using
 * the RE1 RDT layout (offset table at 0x48, cameras at 0x94; see rdt1.ts).
 */
export function interpretRdt(bytes: Uint8Array, node: VirtualNode): ArchiveAsset {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: VirtualNode[] = parseRdt1(bytes)
    .sections.filter((s) => s.size > 0)
    .map((s, i) => {
      const name = `${String(i).padStart(2, '0')}_${s.name}`;
      return {
        id: `${node.id}:s${i}`,
        name,
        path: `${node.path}/${name}`,
        type: 'file' as const,
        extension: sectionExt(s.name, buf, s.offset),
        size: s.size,
        offset: s.offset,
      };
    });
  return { kind: 'archive', entries, format: RE1_FORMATS.rdt.name };
}

/** Interpret camera position data (RID-style records). */
export function interpretCamera(bytes: Uint8Array): StructuredAsset {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const RECORD = 0x20;
  const count = Math.floor(buf.length / RECORD);
  const sections: StructuredSection[] = [];
  const shown = Math.min(count, 32);
  for (let i = 0; i < shown; i++) {
    const o = i * RECORD;
    sections.push({
      title: `Camera ${i}`,
      fields: [
        { label: 'Flags', value: hex(buf.readUInt16LE(o)) },
        {
          label: 'Camera pos (x,y,z)',
          value: `${buf.readInt16LE(o + 4)}, ${buf.readInt16LE(o + 6)}, ${buf.readInt16LE(o + 8)}`,
        },
        {
          label: 'Look-at (x,y,z)',
          value: `${buf.readInt16LE(o + 10)}, ${buf.readInt16LE(o + 12)}, ${buf.readInt16LE(o + 14)}`,
        },
      ],
    });
  }
  return {
    kind: 'structured',
    format: 'Camera Positions (RID)',
    summary: `Best-effort interpretation of ${count} camera record(s) (${RECORD}-byte stride).`,
    sections: sections.length ? sections : [overviewSection(bytes)],
  };
}

/** Decode STF text data. */
export function interpretStf(bytes: Uint8Array): StructuredAsset {
  // Keep printable characters and newlines; collapse runs of control bytes.
  let text = '';
  let gap = false;
  for (const b of bytes) {
    if (b === 0x0a || b === 0x0d || (b >= 0x20 && b < 0x7f)) {
      text += String.fromCharCode(b);
      gap = false;
    } else if (!gap) {
      text += '\n';
      gap = true;
    }
  }
  return {
    kind: 'structured',
    format: RE1_FORMATS.stf.name,
    summary: RE1_FORMATS.stf.description,
    sections: [overviewSection(bytes)],
    text: text.trim(),
  };
}

/** List a DAT/RDT container's packed sub-files. */
export function interpretContainer(
  bytes: Uint8Array,
  node: VirtualNode,
  formatName: string,
): ArchiveAsset {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = unpackContainer(buf, { idPrefix: node.id, parentPath: node.path });
  return { kind: 'archive', entries, format: formatName };
}

/**
 * Interpret a `.HED` sound-bank header. RE1's HED is a Capcom-specific header
 * (not a standard VAB) paired with a `.VB` body; we surface its leading word
 * table so the sample layout is inspectable rather than hex-only.
 */
export function interpretHed(bytes: Uint8Array): StructuredAsset {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const wordCount = Math.min(32, Math.floor(buf.length / 4));
  const fields: StructuredField[] = [];
  for (let i = 0; i < wordCount; i++) {
    fields.push({ label: `word[${i}] @${hex(i * 4)}`, value: hex(buf.readUInt32LE(i * 4)) });
  }
  return {
    kind: 'structured',
    format: RE1_FORMATS.hed.name,
    summary: `${RE1_FORMATS.hed.description} Pairs with the same-named .VB body.`,
    sections: [overviewSection(bytes), { title: 'Header words', fields }],
  };
}

/** Interpret a VAB sound bank as an expandable list of playable samples. */
export function interpretVab(bytes: Uint8Array, node: VirtualNode): ArchiveAsset {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = vabSamples(buf);
  const entries: VirtualNode[] = samples.map((s, i) => {
    const name = `sample_${String(i).padStart(2, '0')}.vb`;
    return {
      id: `${node.id}:vab${i}`,
      name,
      path: `${node.path}/${name}`,
      type: 'file' as const,
      extension: 'vb', // raw SPU-ADPCM -> decoded on play
      size: s.size,
      offset: s.offset,
    };
  });
  return { kind: 'archive', entries, format: 'VAB Sound Bank' };
}

/** Generic "identified but not fully decoded" fallback. */
export function identifiedSummary(bytes: Uint8Array, ext: string): StructuredAsset {
  const meta = RE1_FORMATS[ext];
  return {
    kind: 'structured',
    format: meta?.name ?? `.${ext.toUpperCase()} file`,
    summary: meta?.description ?? 'Recognized RE1 engine file; no dedicated decoder yet.',
    sections: [overviewSection(bytes)],
  };
}

/**
 * Interpret an RE1 engine file that is not a model/texture/audio. Returns null
 * when the extension is not one this registry handles structurally.
 */
export function interpretRe1(
  ext: string | undefined,
  node: VirtualNode,
  bytes: Uint8Array,
): ParsedAsset | null {
  const name = node.name.toLowerCase();
  if (name === 'camera.bin' || (ext === 'bin' && name.includes('camera'))) {
    return interpretCamera(bytes);
  }
  switch (ext) {
    case 'rdt':
      return interpretRdt(bytes, node);
    case 'dat':
      return interpretContainer(bytes, node, RE1_FORMATS.dat.name);
    case 'stf':
      return interpretStf(bytes);
    case 'hed':
      return interpretHed(bytes);
    case 'pix':
    case 'esp':
    case 'emw':
    case 'exe':
    case 'str':
      return identifiedSummary(bytes, ext);
    default:
      return null;
  }
}
