// Round-trip proof for the script encoder, the text assembler and the room
// writer, run against real rooms.
//
//   node scripts/verify-scd-roundtrip.mjs <image | dir> [<image | dir> ...]
//
// For every room's init and main procedures it checks that
//   1. encodeScd1(decoded instructions) equals the original bytes, and
//   2. assembleScd1(formatScripts(room)) equals the original bytes.
// Then, for a sample of rooms per target, it appends the unchanged scripts with
// replaceRdtSections and checks the result re-parses to the same scripts and the
// same sections, with every byte of the original outside the two offset-table
// entries untouched. Exits 1 on any mismatch.
import { roomFiles, type RoomFile } from './disc';
import { formatScripts, parseRdt1, replaceRdtSections, type Rdt1 } from '../electron/parsers/re1/rdt1';
import { assembleScd1 } from '../electron/parsers/re1/scdAsm';
import { encodeScd1, formatScd1 } from '../electron/parsers/re1/scd1';

const MIN_ROOM = 0x94;
const WRITER_SAMPLE = 20;
// init.scd and main.scd are entries 6 and 7 of the offset table at 0x48.
const SCRIPT_TABLE_FROM = 0x60;
const SCRIPT_TABLE_TO = 0x68;

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

/** Append the unchanged scripts and check nothing else about the room changed. */
function checkWriter(room: RoomFile, problems: string[]): void {
  const before = parseRdt1(room.bytes);
  const bodies = (procs: Rdt1['init']) => procs.map((p) => encodeScd1(p.instructions));
  const written = replaceRdtSections(room.bytes, { init: bodies(before.init), main: bodies(before.main) });
  const after = parseRdt1(written);
  const fail = (what: string) => problems.push(`${room.name} writer: ${what}`);

  // The header text carries file offsets, which move, so compare the procedure text alone.
  const text = (r: Rdt1) => [...r.init, ...r.main].map((p) => formatScd1(p.instructions)).join('\n--\n');
  if (text(after) !== text(before)) fail('decoded scripts differ');
  const want = originalBodies(room.bytes, before);
  const got = originalBodies(written, after);
  if (want.length !== got.length) fail(`${want.length} procedures, now ${got.length}`);
  want.forEach((w, i) => {
    const diff = got[i] && (w.kind === got[i].kind ? firstDifference(w.body, got[i].body) : 'kind changed');
    if (diff) fail(`${w.kind}@0x${w.offset.toString(16)} bytes: ${diff}`);
  });
  const others = (r: Rdt1) => r.sections.filter((s) => s.name !== 'init.scd' && s.name !== 'main.scd');
  const key = (r: Rdt1) => others(r).map((s) => `${s.name}@${s.offset}`).join(' ');
  if (key(after) !== key(before)) fail('the other sections changed name or offset');
  for (const name of ['init.scd', 'main.scd']) {
    const section = after.sections.find((s) => s.name === name);
    if (!section || section.offset % 4 !== 0 || section.offset < room.bytes.length) fail(`${name} not appended and aligned`);
  }
  if (JSON.stringify(after.events.map((e) => e.offset)) !== JSON.stringify(before.events.map((e) => e.offset))) {
    fail('event offsets differ');
  }
  for (let i = 0; i < room.bytes.length; i++) {
    if ((i < SCRIPT_TABLE_FROM || i >= SCRIPT_TABLE_TO) && room.bytes[i] !== written[i]) {
      fail(`byte 0x${i.toString(16)} of the original changed`);
      break;
    }
  }
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

let rooms = 0;
let skipped = 0;
let procedures = 0;
let writerRooms = 0;
const problems: string[] = [];
checkHandWritten(problems);

for (const target of process.argv.slice(2)) {
  const files = [...roomFiles(target)].filter((f) => {
    if (f.bytes.length >= MIN_ROOM) return true;
    skipped++;
    return false;
  });
  // Spread the writer sample evenly over the target.
  const step = Math.max(1, Math.floor(files.length / WRITER_SAMPLE));
  let sampled = 0;
  files.forEach((room, i) => {
    rooms++;
    try {
      procedures += checkProcedures(room, parseRdt1(room.bytes), problems);
      if (i % step === 0 && sampled < WRITER_SAMPLE) {
        sampled++;
        writerRooms++;
        checkWriter(room, problems);
      }
    } catch (err) {
      problems.push(`${room.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

if (rooms === 0) {
  console.error('usage: node scripts/verify-scd-roundtrip.mjs <image | dir> ...');
  process.exit(1);
}
for (const problem of problems) console.log(problem);
console.log(
  `${rooms} rooms (${skipped} empty slots skipped), ${procedures} procedures, ` +
    `${writerRooms} rooms through the writer, ${problems.length} problems`,
);
if (problems.length) process.exit(1);
console.log('ok: every procedure round-trips byte for byte');
