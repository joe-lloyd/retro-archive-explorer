// RE1 room file (ROOMsrrp.RDT) layout, ported from biohazard-utils' Rdt1
// (MIT, https://github.com/biorand/biohazard-utils):
//
//   0x00  header: nSprite, nCut (cameras), nOmodel, nItem, nDoor, nRoomAt
//   0x06  light data
//   0x48  19 absolute offsets (see SECTION_NAMES)
//   0x94  nCut camera records, 44 bytes each
//
// Section lengths are not stored. A section runs to the next known offset.
import { encodeMessageSection, readMessageSection, type RawMessage } from './msg1';
import { enemyName, formatScd1, itemName, readScd1, roomName, type ScdInstruction } from './scd1';

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

/** Every init and main procedure as pseudo-C, each under a `// init procedure N @ 0x...` header. */
export function formatScripts(rdt: Rdt1): string {
  const block = (kind: string, procs: Procedure[]) =>
    procs.map((p, i) => `// ${kind} procedure ${i} @ 0x${p.offset.toString(16)}\n${formatScd1(p.instructions)}`);
  return [...block('init', rdt.init), ...block('main', rdt.main)].join('\n\n') + '\n';
}

/** Procedure bodies (opcodes only, no size prefix) to write in place of a room's scripts. */
export interface ScriptReplacements {
  init?: readonly Uint8Array[];
  main?: readonly Uint8Array[];
}

const SCRIPT_SLOTS = { init: SECTION_NAMES.indexOf('init.scd'), main: SECTION_NAMES.indexOf('main.scd') };
const SCRIPT_ALIGN = 4;
const MESSAGE_SLOT = SECTION_NAMES.indexOf('message.msg');
const VB_AT = OFFSETS_AT + SECTION_NAMES.indexOf('snd.vb') * 4;
const OMODEL_RECORD_SIZE = 0xa4;

const align = (n: number) => Math.ceil(n / SCRIPT_ALIGN) * SCRIPT_ALIGN;

/** `[u16 size][body]...[u16 0]` */
function encodeProcedures(bodies: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(bodies.reduce((n, b) => n + b.length + 2, 2));
  const dv = view(out);
  let at = 0;
  for (const body of bodies) {
    if (body.length + 2 > 0xffff) throw new Error(`procedure is ${body.length} bytes, the limit is 65533`);
    dv.setUint16(at, body.length + 2, true);
    out.set(body, at + 2);
    at += body.length + 2;
  }
  return out;
}

/**
 * Where the engine's model scratch memory sits. room_set (RoomInit.cpp) starts
 * g_loadDataDestPointer at the room's snd.vb address, carves one 0xA4-byte
 * record per object and item model out of it, then loads each enemy's EMD
 * upward from there. The bytes it overwrites are the vb region and everything
 * after it in the file, which are dead once sound and textures are uploaded.
 * Anything a writer put after snd.vb would be overwritten as well, so new
 * sections go before it. The room buffer, g_DataBuffer, is a fixed size.
 */
const ROOM_BUFFER_SIZE = 832728;
/**
 * Headroom for EMD loading. The room loads one model per enemy type its
 * scripts place (NPCs included), and the largest EMD runs to 220 KB, so a
 * written room must leave that much for every distinct type plus a margin for
 * the object and item records. A room that already had less than that may not
 * shrink at all: shipped rooms prove only their own headroom was enough.
 */
const EMD_MAX = 220_000;
const EMD_MARGIN = 32_768;

function emdReserve(rdt: Uint8Array): number {
  const types = new Set(parseRdt1(rdt).placements.flatMap((p) => (p.kind === 'enemy' ? [p.type] : [])));
  return types.size * EMD_MAX + EMD_MARGIN;
}

const emdHeadroom = (bytes: Uint8Array, vb: number) =>
  ROOM_BUFFER_SIZE - (vb + (bytes[2] + bytes[3]) * OMODEL_RECORD_SIZE);

/**
 * One layout for every writer: new sections first, then snd.vb last, with the
 * offset-table slot of each pointed at its bytes, so the engine's scratch area
 * starts past all new data. Each section starts on a 4-byte boundary. A section
 * whose bytes already sit where its slot points is left alone, and when none
 * changed the result is a plain copy.
 *
 * snd.vb is the only thing the offset table points at there: parseRdt1 ends it
 * at the next offset anything declares, and for retail rooms its size plus the
 * VAB header's matches the size the header states, so no other offset points
 * inside. If snd.vb is already the file's last section (a room written before)
 * the new sections go where it starts and it moves behind them, so repeated
 * writes do not leave a dead copy each. Otherwise vb is copied to the end and
 * the old copy stays as unused bytes. Everything else stays where it was.
 */
function appendSections(original: Uint8Array, wanted: readonly { slot: number; bytes: Uint8Array }[]): Uint8Array {
  if (original.length < CAMERAS_AT) throw new Error('RDT too small for an RE1 room header');
  const dv0 = view(original);
  const appended = wanted.filter(({ slot, bytes }) => {
    const at = dv0.getUint32(OFFSETS_AT + slot * 4, true);
    return !(at + bytes.length <= original.length && bytes.every((b, i) => original[at + i] === b));
  });
  if (appended.length === 0) return original.slice();

  const vb = dv0.getUint32(VB_AT, true);
  const vbSection = parseRdt1(original).sections.find((s) => s.offset === vb);
  if (!vbSection) throw new Error(`room has no snd.vb data at 0x${vb.toString(16)} to keep behind the new sections`);
  const vbBytes = original.subarray(vb, vb + vbSection.size);
  const vbIsLast = vb + vbSection.size === original.length;

  const keep = vbIsLast ? vb : original.length;
  let end = align(keep);
  const placed = appended.map((a) => {
    const at = end;
    end = align(end + a.bytes.length);
    return { ...a, at };
  });
  const vbAt = end;
  const out = new Uint8Array(vbAt + vbBytes.length);
  out.set(original.subarray(0, keep));
  const dv = view(out);
  for (const { slot, bytes, at } of placed) {
    out.set(bytes, at);
    dv.setUint32(OFFSETS_AT + slot * 4, at, true);
  }
  out.set(vbBytes, vbAt);
  dv.setUint32(VB_AT, vbAt, true);

  const before = emdHeadroom(original, vb);
  const after = emdHeadroom(out, vbAt);
  const reserve = emdReserve(out);
  if (out.length > ROOM_BUFFER_SIZE || after < Math.min(before, reserve)) {
    throw new Error(
      `the new room is ${out.length} bytes and leaves ${after} bytes of the ${ROOM_BUFFER_SIZE}-byte room buffer for enemy models; ` +
        `its enemy types need ${reserve} and the original left ${before}`,
    );
  }
  return out;
}

/**
 * Copy a room with new init and/or main scripts written behind the old data
 * (see appendSections) and the offset table pointed at them. Only the offset table points at
 * the script sections; the event table is relative to its own start and the
 * scripts hold no file offsets.
 */
export function replaceRdtSections(original: Uint8Array, replacements: ScriptReplacements): Uint8Array {
  const appended = (['init', 'main'] as const).flatMap((kind) => {
    const bodies = replacements[kind];
    return bodies ? [{ slot: SCRIPT_SLOTS[kind], bytes: encodeProcedures(bodies) }] : [];
  });
  return appendSections(original, appended);
}

/** Every message of a room, as text and as stored bytes. */
export function readRdtMessages(bytes: Uint8Array): RawMessage[] {
  const section = parseRdt1(bytes).sections.find((s) => s.name === 'message.msg');
  if (!section) throw new Error('room has no message section');
  // Read to the end of the file, not the section: retail ROOM5140 ends its last
  // message with an opened-and-never-closed skip span that runs into the next section.
  return readMessageSection(bytes.subarray(section.offset));
}

/**
 * Copy a room with its messages replaced by `messages` (editable text, see
 * msg1.ts). The new section is written the way replaceRdtSections writes
 * scripts (see appendSections) and the 0x74 pointer is moved to it, so the two
 * compose in either order. Nothing points into the old message section
 * except that pointer: LoadRoomRdt adds the file's base address to every entry
 * of the 0x48 table, and message text is only reached through it.
 */
export function replaceRdtMessages(original: Uint8Array, messages: readonly string[]): Uint8Array {
  return appendSections(original, [{ slot: MESSAGE_SLOT, bytes: encodeMessageSection(messages) }]);
}
