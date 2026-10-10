// Round-trip proof for the script encoder, the text assembler and the room
// writer, run against real rooms.
//
//   node scripts/verify-scd-roundtrip.mjs <image | dir> [<image | dir> ...]
//
// For every room's init and main procedures it checks that
//   1. encodeScd1(decoded instructions) equals the original bytes, and
//   2. assembleScd1(formatScripts(room)) equals the original bytes.
// Then, for a sample of rooms per target, it checks the writer twice:
//   - unchanged scripts leave the room byte for byte as it was, and
//   - with one procedure added to main, only main.scd is written, behind the old
//     data and before snd.vb, snd.vb is last with the same data, the other
//     sections and every original byte outside the main.scd and snd.vb pointers
//     (and the old snd.vb region, when it was the last section) are unchanged,
//     and the scripts read back as the old ones plus the new procedure.
// A room whose engine headroom the writer refuses to shrink is skipped and the
// next room along is used. Exits 1 on any mismatch.
import { roomFiles, type RoomFile } from './disc';
import { formatScripts, parseRdt1, replaceRdtSections, type Rdt1 } from '../electron/parsers/re1/rdt1';
import { assembleScd1 } from '../electron/parsers/re1/scdAsm';
import { encodeScd1, formatScd1 } from '../electron/parsers/re1/scd1';

const MIN_ROOM = 0x94;
const WRITER_SAMPLE = 20;
// init.scd, main.scd and snd.vb are entries 6, 7 and 18 of the offset table at 0x48.
const INIT_POINTER_AT = 0x60;
const MAIN_POINTER_AT = 0x64;
const VB_POINTER_AT = 0x90;
/** `end(0)`: an empty procedure that just returns. */
const ADDED_PROCEDURE = Uint8Array.of(0x00, 0x00);

/** The procedure bodies as stored in the file, without their size prefix. */
function originalBodies(bytes: Uint8Array, rdt: Rdt1): { kind: 'init' | 'main'; offset: number; body: Uint8Array }[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const all = [
    ...rdt.init.map((p) => ({ kind: 'init' as const, p })),
    ...rdt.main.map((p) => ({ kind: 'main' as const, p })),
  ];
  return all.map(({ kind, p }) => ({
    kind,
    offset: p.offset,
    body: bytes.subarray(p.offset + 2, p.offset + dv.getUint16(p.offset, true)),
  }));
}

/** Describe the first difference between two byte strings, or null when equal. */
function firstDifference(want: Uint8Array, got: Uint8Array): string | null {
  const n = Math.min(want.length, got.length);
  for (let i = 0; i < n; i++) {
    if (want[i] !== got[i]) return `byte ${i}: want ${want[i]}, got ${got[i]} (lengths ${want.length}, ${got.length})`;
  }
  return want.length === got.length ? null : `lengths differ: want ${want.length}, got ${got.length}`;
}

function checkProcedures(room: RoomFile, rdt: Rdt1, problems: string[]): number {
  const originals = originalBodies(room.bytes, rdt);
  const procs = [...rdt.init, ...rdt.main];
  originals.forEach(({ kind, offset, body }, i) => {
    const encoded = firstDifference(body, encodeScd1(procs[i].instructions));
    if (encoded) problems.push(`${room.name} ${kind}@0x${offset.toString(16)} encode: ${encoded}`);
  });

  let assembled: ReturnType<typeof assembleScd1>;
  try {
    assembled = assembleScd1(formatScripts(rdt));
  } catch (err) {
    problems.push(`${room.name} assemble: ${err instanceof Error ? err.message : String(err)}`);
    return originals.length;
  }
  for (const kind of ['init', 'main'] as const) {
    const want = originals.filter((o) => o.kind === kind);
    if (assembled[kind].length !== want.length) {
      problems.push(`${room.name} ${kind}: ${want.length} procedures, assembled ${assembled[kind].length}`);
      continue;
    }
    want.forEach(({ offset, body }, i) => {
      const diff = firstDifference(body, assembled[kind][i]);
      if (diff) problems.push(`${room.name} ${kind}@0x${offset.toString(16)} assemble: ${diff}`);
    });
  }
  return originals.length;
}

/** The writer's headroom guard turned the room down. Not a failure. */
const isRefusal = (err: unknown) => err instanceof Error && err.message.includes('room buffer');

/** Check the writer on one room. Returns false when the headroom guard refused it. */
function checkWriter(room: RoomFile, problems: string[]): boolean {
  const before = parseRdt1(room.bytes);
  const bodies = (procs: Rdt1['init']) => procs.map((p) => encodeScd1(p.instructions));
  const fail = (what: string) => problems.push(`${room.name} writer: ${what}`);

  const same = replaceRdtSections(room.bytes, { init: bodies(before.init), main: bodies(before.main) });
  if (firstDifference(room.bytes, same)) fail('unchanged scripts changed the file');

  let written: Uint8Array;
  try {
    written = replaceRdtSections(room.bytes, { main: [...bodies(before.main), ADDED_PROCEDURE] });
  } catch (err) {
    if (isRefusal(err)) return false;
    throw err;
  }
  const after = parseRdt1(written);
  const dv = new DataView(written.buffer, written.byteOffset, written.byteLength);
  const odv = new DataView(room.bytes.buffer, room.bytes.byteOffset, room.bytes.byteLength);

  // Only main changed: init stays where it was, main moved behind the old data.
  const main = after.sections.find((s) => s.name === 'main.scd');
  const vb0 = odv.getUint32(VB_POINTER_AT, true);
  const vbSize = before.sections.find((s) => s.offset === vb0)?.size ?? 0;
  const vbWasLast = vb0 + vbSize === room.bytes.length;
  const vb1 = dv.getUint32(VB_POINTER_AT, true);
  if (dv.getUint32(INIT_POINTER_AT, true) !== odv.getUint32(INIT_POINTER_AT, true)) fail('init.scd moved though it did not change');
  if (!main || main.offset % 4 !== 0 || main.offset < (vbWasLast ? vb0 : room.bytes.length) || main.offset + main.size > vb1) {
    fail('main.scd not written behind the old data, aligned and before snd.vb');
  }
  if (vb1 + vbSize !== written.length) fail('snd.vb is not the last data in the file');
  if (firstDifference(room.bytes.subarray(vb0, vb0 + vbSize), written.subarray(vb1, vb1 + vbSize))) fail('snd.vb data changed');

  // The scripts read back as the old ones plus the new procedure.
  const text = (procs: Rdt1['init']) => procs.map((p) => formatScd1(p.instructions)).join('\n--\n');
  if (text(after.init) !== text(before.init)) fail('decoded init scripts differ');
  if (after.main.length !== before.main.length + 1 || text(after.main.slice(0, -1)) !== text(before.main)) {
    fail('decoded main scripts are not the old ones plus the added procedure');
  }
  const others = (r: Rdt1) => r.sections.filter((s) => !['offsets.tbl', 'main.scd'].includes(s.name) && s.offset !== vb0);
  for (const s of others(before)) {
    const there = after.sections.find((a) => a.offset === s.offset);
    if (!there || there.name !== s.name) fail(`section ${s.name}@${s.offset} lost or renamed`);
    else if (firstDifference(room.bytes.subarray(s.offset, s.offset + s.size), written.subarray(s.offset, s.offset + s.size))) {
      fail(`section ${s.name}@${s.offset} bytes differ`);
    }
  }
  if (JSON.stringify(after.events.map((e) => e.offset)) !== JSON.stringify(before.events.map((e) => e.offset))) {
    fail('event offsets differ');
  }
  for (let i = 0; i < room.bytes.length; i++) {
    const pointer = (at: number) => i >= at && i < at + 4;
    if (!pointer(MAIN_POINTER_AT) && !pointer(VB_POINTER_AT) && !(vbWasLast && i >= vb0) && room.bytes[i] !== written[i]) {
      fail(`byte 0x${i.toString(16)} of the original changed`);
      break;
    }
  }
  return true;
}

/** Hand-written text whose bytes are known: block lengths, nop, and a nonzero end operand. */
function checkHandWritten(problems: string[]): void {
  const text = `// main procedure 0
if (ck(FG_ITEM, 5, 1)) {
    nop(5);
} else {
    bgm_play(3);
}
end(1);`;
  const want = '01 08 04 07 05 01 0e 05 02 04 15 03 00 01';
  const got = Array.from(assembleScd1(text).main[0], (b) => b.toString(16).padStart(2, '0')).join(' ');
  if (got !== want) problems.push(`hand-written script: want ${want}, got ${got}`);
}

/** Scripts the assembler must refuse, with a fragment of the reason, and ones at the limit it must take. */
function checkRules(problems: string[]): void {
  const enemy = (type: number) => `enemy(${[type, ...Array(16).fill(0)].join(', ')});`;
  const nested = (depth: number) =>
    `// main procedure 0\n${'if (ck(FG_ITEM, 1, 1)) {\n'.repeat(depth)}nop(1);\n${'}\n'.repeat(depth)}return;`;
  const refused: [string, string, string][] = [
    ['first of two procedures without return', '// init procedure 0\nnop(1);\n// init procedure 1\nreturn;', 'init procedure 0 must end with "return;"'],
    ['17 nested ifs', nested(17), 'nest more than 16 deep'],
    ['enemy type 49', `// init procedure 0\n${enemy(49)}\nreturn;`, 'enemy type 49'],
    ['item 129', '// main procedure 0\nitem_ck(129);\nreturn;', 'item 129'],
    ['set mode 3', '// main procedure 0\nset(FG_ITEM, 1, 3);\nreturn;', 'set mode is 3'],
  ];
  for (const [what, text, reason] of refused) {
    try {
      assembleScd1(text);
      problems.push(`refused (${what}): assembled`);
    } catch (err) {
      const got = err instanceof Error ? err.message : String(err);
      if (!got.includes(reason)) problems.push(`refused (${what}): got "${got}", want "${reason}"`);
    }
  }
  const taken: [string, string][] = [
    ['last procedure without return', '// main procedure 0\nnop(1);'],
    ['16 nested ifs', nested(16)],
    ['enemy type 48', `// init procedure 0\n${enemy(48)}\nreturn;`],
    ['item 128 and LOCKED', '// main procedure 0\nitem_ck(128);\nitem_ck(LOCKED);\nreturn;'],
    ['set mode 2', '// main procedure 0\nset(FG_ITEM, 1, 2);\nreturn;'],
  ];
  for (const [what, text] of taken) {
    try {
      assembleScd1(text);
    } catch (err) {
      problems.push(`taken (${what}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

let rooms = 0;
let skipped = 0;
let procedures = 0;
let writerRooms = 0;
let refusedRooms = 0;
const problems: string[] = [];
checkHandWritten(problems);
checkRules(problems);

for (const target of process.argv.slice(2)) {
  const files = [...roomFiles(target)].filter((f) => {
    if (f.bytes.length >= MIN_ROOM) return true;
    skipped++;
    return false;
  });
  // Spread the writer sample evenly over the target.
  const guard = (room: RoomFile, work: () => void) => {
    try {
      work();
    } catch (err) {
      problems.push(`${room.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  files.forEach((room) => {
    rooms++;
    guard(room, () => {
      procedures += checkProcedures(room, parseRdt1(room.bytes), problems);
    });
  });
  // Spread the writer sample evenly over the target; a refused room gives way to the next one along.
  const step = Math.max(1, Math.floor(files.length / WRITER_SAMPLE));
  const candidates = files.map((room, i) => ({ room, i })).sort((a, b) => (a.i % step) - (b.i % step) || a.i - b.i);
  let sampled = 0;
  for (const { room } of candidates) {
    if (sampled >= WRITER_SAMPLE) break;
    guard(room, () => {
      if (checkWriter(room, problems)) {
        sampled++;
        writerRooms++;
      } else {
        refusedRooms++;
      }
    });
  }
}

if (rooms === 0) {
  console.error('usage: node scripts/verify-scd-roundtrip.mjs <image | dir> ...');
  process.exit(1);
}
for (const problem of problems) console.log(problem);
console.log(
  `${rooms} rooms (${skipped} empty slots skipped), ${procedures} procedures, ` +
    `${writerRooms} rooms through the writer (${refusedRooms} skipped for headroom), ${problems.length} problems`,
);
if (problems.length) process.exit(1);
console.log('ok: every procedure round-trips byte for byte');
