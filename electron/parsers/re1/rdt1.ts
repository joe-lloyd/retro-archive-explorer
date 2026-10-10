// RE1 room file (ROOMsrrp.RDT) layout, ported from biohazard-utils' Rdt1
// (MIT, https://github.com/biorand/biohazard-utils):
//
//   0x00  header: nSprite, nCut (cameras), nOmodel, nItem, nDoor, nRoomAt
//   0x06  light data
//   0x48  19 absolute offsets (see SECTION_NAMES)
//   0x94  nCut camera records, 44 bytes each
//
// Section lengths are not stored. A section runs to the next known offset.
import { enemyName, itemName, readScd1, roomName, type ScdInstruction } from './scd1';

const OFFSETS_AT = 0x48;
const CAMERAS_AT = 0x94;
const CAMERA_SIZE = 44;
const SWITCH_SIZE = 20;

const SECTION_NAMES = [
  'zone.rvd', 'collision.sca', 'object_models.tbl', 'item_models.tbl', 'block.blk',
  'floor.flr', 'init.scd', 'main.scd', 'events.scd', 'animation.emr', 'animation.edd',
  'message.msg', 'item_icons.pix', 'esp_ids.bin', 'esp_eff.tbl', 'esp_tim.tbl', 'snd.edt',
  'snd.vh', 'snd.vb',
] as const;

export interface RdtSection {
  name: string;
  offset: number;
  size: number;
}

export interface RdtHeader {
  sprites: number;
  cameras: number;
  objectModels: number;
  items: number;
  doors: number;
  roomAt: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface RdtCamera {
  index: number;
  from: Vec3;
  to: Vec3;
  maskOffset: number;
  maskTimOffset: number;
}

/** A floor quad; standing inside it while viewed by `from` switches to camera `to`. */
export interface RdtCameraSwitch {
  from: number;
  to: number;
  quad: [number, number][];
}

export interface Procedure {
  offset: number;
  instructions: ScdInstruction[];
}

export type Placement =
  | { kind: 'enemy'; offset: number; id: number; type: number; name: string; pos: Vec3; facing: number; state: number }
  | { kind: 'item'; offset: number; id: number; type: number; name: string; amount: number; x: number; z: number }
  | {
      kind: 'door';
      offset: number;
      id: number;
      target: string;
      x: number;
      z: number;
      next: Vec3;
      lock: number;
    };

export interface Rdt1 {
  header: RdtHeader;
  sections: RdtSection[];
  cameras: RdtCamera[];
  cameraSwitches: RdtCameraSwitch[];
  init: Procedure[];
  main: Procedure[];
  events: RdtSection[];
  placements: Placement[];
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Split a `[u16 size][body]...[u16 0]` procedure container into decoded procedures. */
function readProcedures(bytes: Uint8Array, section: RdtSection | undefined): Procedure[] {
  if (!section) return [];
  const dv = view(bytes);
  const end = section.offset + section.size;
  const out: Procedure[] = [];
  let at = section.offset;
  while (at + 2 <= end) {
    const size = dv.getUint16(at, true);
    if (size < 2 || at + size > end) break;
    out.push({ offset: at, instructions: readScd1(bytes, at + 2, at + size) });
    at += size;
  }
  return out;
}

/** The events section starts with a 0-terminated table of u32 offsets relative to itself. */
function readEvents(bytes: Uint8Array, section: RdtSection | undefined): RdtSection[] {
  if (!section) return [];
  const dv = view(bytes);
  const starts: number[] = [];
  // The table ends at a 0 entry, or where the first event begins.
  for (let at = section.offset; at + 4 <= (starts[0] ?? section.offset + section.size); at += 4) {
    const rel = dv.getUint32(at, true);
    const start = section.offset + rel;
    if (rel === 0 || rel >= section.size || start <= (starts.at(-1) ?? at)) break;
    starts.push(start);
  }
  return starts.map((offset, i) => ({
    name: `event_${i.toString(16).toUpperCase().padStart(2, '0')}`,
    offset,
    size: (starts[i + 1] ?? section.offset + section.size) - offset,
  }));
}

function placementOf(ins: ScdInstruction): Placement | null {
  const dv = view(ins.bytes);
  const b = ins.bytes;
  switch (ins.opcode) {
    case 0x1b:
      return {
        kind: 'enemy',
        offset: ins.offset,
        id: b[18],
        type: b[1],
        name: enemyName(b[1]),
        state: b[2],
        facing: dv.getInt16(8, true),
        pos: { x: dv.getInt16(12, true), y: dv.getInt16(14, true), z: dv.getInt16(16, true) },
      };
    case 0x18:
      return {
        kind: 'item',
        offset: ins.offset,
        id: b[1],
        type: b[10],
        name: itemName(b[10]),
        amount: b[11],
        x: dv.getInt16(2, true),
        z: dv.getInt16(4, true),
      };
    case 0x0c:
      return {
        kind: 'door',
        offset: ins.offset,
        id: b[1],
        target: roomName(b[15]),
        x: dv.getInt16(2, true),
        z: dv.getInt16(4, true),
        next: { x: dv.getInt16(16, true), y: dv.getInt16(18, true), z: dv.getInt16(20, true) },
        lock: b[14],
      };
    default:
      return null;
  }
}

/** Retail discs fill unused room numbers with a 4-byte file of zeros. */
export function isEmptyRoomSlot(bytes: Uint8Array): boolean {
  return bytes.length <= 4 && bytes.every((b) => b === 0);
}

export function parseRdt1(bytes: Uint8Array): Rdt1 {
  if (isEmptyRoomSlot(bytes)) throw new Error('empty room slot: the disc holds no room here');
  if (bytes.length < CAMERAS_AT) throw new Error('RDT too small for an RE1 room header');
  const dv = view(bytes);
  const header: RdtHeader = {
    sprites: bytes[0],
    cameras: bytes[1],
    objectModels: bytes[2],
    items: bytes[3],
    doors: bytes[4],
    roomAt: bytes[5],
  };
  const inFile = (o: number) => o > 0 && o < bytes.length;
  const u32 = (o: number) => (o + 4 <= bytes.length ? dv.getUint32(o, true) : 0);

  // Every offset the file declares, with a name. Lengths come from sorting these.
  const named: { name: string; offset: number }[] = [
    { name: 'header.hdr', offset: 0 },
    { name: 'light.lit', offset: 0x06 },
    { name: 'offsets.tbl', offset: OFFSETS_AT },
    { name: 'camera.rid', offset: CAMERAS_AT },
  ];
  const table = SECTION_NAMES.map((_, i) => u32(OFFSETS_AT + i * 4));
  table.forEach((offset, i) => {
    if (i === 2 && header.objectModels === 0) return;
    if ((i === 3 || i === 12) && header.items === 0) return;
    // The ESP tables are addressed by their last entry.
    const start = i === 14 || i === 15 ? offset - 7 * 4 : offset;
    if (inFile(start)) named.push({ name: SECTION_NAMES[i], offset: start });
  });
  // ESP ids are 8 bytes; what follows is a separate (unnamed) chunk.
  if (inFile(table[13])) named.push({ name: 'unknown.bin', offset: table[13] + 8 });
  // Each ESP table holds 8 offsets to embedded effect scripts and textures.
  for (const [i, ext] of [[14, 'eff'], [15, 'tim']] as const) {
    const start = table[i] - 7 * 4;
    if (!inFile(start) || start + 8 * 4 > bytes.length) continue;
    for (let k = 0; k < 8; k++) {
      const entry = dv.getInt32(start + k * 4, true);
      if (entry !== -1 && (ext === 'tim' || entry !== 0) && inFile(entry)) {
        named.push({ name: `esp${k}.${ext}`, offset: entry });
      }
    }
  }

  const cameras: RdtCamera[] = [];
  for (let i = 0; i < header.cameras; i++) {
    const at = CAMERAS_AT + i * CAMERA_SIZE;
    if (at + CAMERA_SIZE > bytes.length) break;
    const s32 = (k: number) => dv.getInt32(at + k * 4, true);
    const cam: RdtCamera = {
      index: i,
      maskOffset: s32(0),
      maskTimOffset: s32(1),
      from: { x: s32(2), y: s32(3), z: s32(4) },
      to: { x: s32(5), y: s32(6), z: s32(7) },
    };
    cameras.push(cam);
    if (inFile(cam.maskOffset)) named.push({ name: `camera${i}_mask.pri`, offset: cam.maskOffset });
    if (inFile(cam.maskTimOffset)) named.push({ name: `camera${i}_mask.tim`, offset: cam.maskTimOffset });
  }

  const modelTable = (tableOffset: number, count: number, prefix: string) => {
    if (!inFile(tableOffset)) return;
    for (let i = 0; i < count; i++) {
      const tmd = u32(tableOffset + i * 8);
      const tim = u32(tableOffset + i * 8 + 4);
      if (inFile(tmd)) named.push({ name: `${prefix}${i}.tmd`, offset: tmd });
      if (inFile(tim)) named.push({ name: `${prefix}${i}.tim`, offset: tim });
    }
  };
  modelTable(table[2], header.objectModels, 'object');
  modelTable(table[3], header.items, 'item');

  // Sort by offset; the first name registered at an offset wins.
  const byOffset = new Map<number, string>();
  for (const n of named) if (!byOffset.has(n.offset)) byOffset.set(n.offset, n.name);
  const offsets = [...byOffset.keys()].sort((a, b) => a - b);
  const sections: RdtSection[] = offsets.map((offset, i) => ({
    name: byOffset.get(offset) ?? 'unknown',
    offset,
    size: (offsets[i + 1] ?? bytes.length) - offset,
  }));
  const section = (name: string) => sections.find((s) => s.name === name);

  const cameraSwitches: RdtCameraSwitch[] = [];
  const zone = section('zone.rvd');
  if (zone) {
    for (let at = zone.offset; at + SWITCH_SIZE <= zone.offset + zone.size; at += SWITCH_SIZE) {
      const to = dv.getUint16(at, true);
      const from = dv.getUint16(at + 2, true);
      if (to === 0xffff && from === 0xffff) break;
      const quad: [number, number][] = [0, 1, 2, 3].map((k) => [
        dv.getInt16(at + 4 + k * 4, true),
        dv.getInt16(at + 6 + k * 4, true),
      ]);
      cameraSwitches.push({ from, to, quad });
    }
  }

  const init = readProcedures(bytes, section('init.scd'));
  const main = readProcedures(bytes, section('main.scd'));
  const placements = [...init, ...main]
    .flatMap((p) => p.instructions)
    .map(placementOf)
    .filter((p): p is Placement => p !== null);

  return {
    header,
    sections,
    cameras,
    cameraSwitches,
    init,
    main,
    events: readEvents(bytes, section('events.scd')),
    placements,
  };
}
