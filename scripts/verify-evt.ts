// Proof for the event script (EVT) decoder, assembler and writer.
//
//   node scripts/verify-evt.mjs [<image | dir> ...]
//
// Always, with no game files:
//   1. A made-up room gets two event procedures through `rae asm`. The new
//      events section must hold the literal bytes worked out by hand from
//      docs/EVT_FORMAT.md, and `rae script` must print the literal text back.
//   2. Byte strings with the retail quirks (an SCD command whose length byte
//      is short, a byte the engine stops at, an SCD block whose if lengths do
//      not match its blocks) decode to the literal text and assemble back to
//      the same bytes.
//   3. Text the engine cannot run is refused with a reason.
// Given disc images or directories of .RDT files (or RAE_ROOMS, a list of them
// separated by the path delimiter), it also checks every room:
//   4. formatScripts, then assembleScd1, then encodeEventSection gives back the
//      room's events section byte for byte, and
//   5. for a sample of rooms, unchanged events leave the file as it was, and an
//      added event procedure is written behind the old data and before snd.vb,
//      with the old ones reading back the same and the rest of the file kept.
// Without them, steps 4 and 5 are skipped. Exits 1 on any mismatch.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { roomFiles, type RoomFile } from './disc';
import { encodeEventSection, formatScripts, parseRdt1, replaceRdtSections } from '../electron/parsers/re1/rdt1';
import { evtLength, formatEvt1, readEvt1 } from '../electron/parsers/re1/evt1';
import { assembleScd1 } from '../electron/parsers/re1/scdAsm';

const MIN_ROOM = 0x94;
const WRITER_SAMPLE = 20;
const OFFSETS_AT = 0x48;
const EVENTS_POINTER_AT = OFFSETS_AT + 8 * 4;
const VB_POINTER_AT = OFFSETS_AT + 18 * 4;

const problems: string[] = [];
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const hex = (bytes: ArrayLike<number>) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');

/** Describe the first difference between two byte strings, or null when equal. */
function firstDifference(want: Uint8Array, got: Uint8Array): string | null {
  const n = Math.min(want.length, got.length);
  for (let i = 0; i < n; i++) {
    if (want[i] !== got[i]) return `byte ${i}: want ${want[i]}, got ${got[i]} (lengths ${want.length}, ${got.length})`;
  }
  return want.length === got.length ? null : `lengths differ: want ${want.length}, got ${got.length}`;
}

// ---------------------------------------------------------------- 1. synthetic room

const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
const u32 = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];

/** A room with one camera, an init and main that just return, one event script and a snd.vb. */
function syntheticRoom(): { bytes: Uint8Array; vbAt: number } {
  const ret = [...u16(4), 0x00, 0x00, ...u16(0)];
  const parts: [slot: number, bytes: number[]][] = [
    [0, [...u16(0), ...u16(0), ...Array(16).fill(0), ...u16(0xffff), ...u16(0xffff), ...Array(16).fill(0)]],
    [6, [...ret, 0, 0]],
    [7, [...ret, 0, 0]],
    [8, [...u32(8), ...u32(0), 0xff, 0, 0, 0]],
    [18, Array(16).fill(0)],
  ];
  let at = MIN_ROOM + 44;
  const table = Array(19).fill(0);
  const placed = parts.map(([slot, bytes]) => {
    table[slot] = at;
    at += bytes.length;
    return { at: table[slot], bytes };
  });
  const out = new Uint8Array(at);
  out.set([0, 1, 0, 0, 0, 0], 0);
  table.forEach((v, i) => out.set(u32(v), OFFSETS_AT + i * 4));
  out.set([0, 0, 1000, -2000, 3000, 0, 0, 0, 0, 0, 0].flatMap(u32), MIN_ROOM);
  for (const p of placed) out.set(p.bytes, p.at);
  return { bytes: out, vbAt: table[18] };
}

const EVENT_0 = `set_entity(ENT_ENEMY, 1);
anim_begin();
    anim_play(34, 35, 0);
    sleep(30);
anim_end_release();
evt_nop();
scd {
    if (ck(FG_ROOM, 3, 0)) {
        message(2, 0, 0);
    }
    return;
}
bgm_play(3);
do {
    yield();
} while (ck(FG_ROOM, 4, 1));
evt_start(255, 1 /* event_01 */);
return;`;

const EVENT_1 = `set_entity(ENT_PLAYER, 0);
move_begin();
    move_speed(0, 0, -20);
    repeat (15) {
        move_step();
        yield();
    }
    move_nop();
    move_pos(1000, 0, -2000);
move_end();
evt_nop();
wait_voice();
sleep(1);
evt_jump(0 /* event_00 */);`;

/** EVENT_0 and EVENT_1 as docs/EVT_FORMAT.md lays them out, offsets from the section start. */
const EXPECTED_SECTION = [
  // table: event 0 at 12, event 1 at 64, then the 0 entry
  '0c 00 00 00 40 00 00 00 00 00 00 00',
  // set_entity, anim_begin, anim_play, sleep(30), anim_end_release, evt_nop
  '04 01 01 01 84 22 23 00 f8 f9 1e 00 80 00',
  // scd block: 06 LL [size 16] if(10) ck(4, 3, 0) message(2, 0, 0) endif end, zero word
  '06 13 10 00 01 0a 04 04 03 00 0b 02 00 00 03 00 00 00 00 00',
  // bgm_play(3) as one SCD command, do { yield } while (ck(4, 4, 1)), evt_start(255, 1), return, pad
  '07 04 15 03 fc 06 04 04 04 01 fe fd 05 ff 01 00 ff 00',
  // set_entity, move_begin, move_speed, repeat(15) { move_step yield }, move_nop
  '04 00 00 03 05 00 00 ec fa 00 0f 00 02 fe fb 00',
  // move_pos(1000, 0, -2000), move_end, evt_nop, wait_voice, sleep(1), evt_jump(0), pad
  '07 00 e8 03 00 00 30 f8 01 00 f6 f7 f8 f9 01 00 08 00 00 00',
].join(' ');

function checkSyntheticRoom(): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'evt-'));
  // This file runs bundled from a temp directory; the .mjs entry that started it sits next to the CLI.
  const cli = path.join(path.dirname(process.argv[1]), 'cli.mjs');
  const { bytes, vbAt } = syntheticRoom();
  const src = path.join(dir, 'ROOM1000.RDT');
  const out = path.join(dir, 'OUT.RDT');
  const text = path.join(dir, 'events.c');
  writeFileSync(src, bytes);
  writeFileSync(text, `// event procedure 0\n${EVENT_0}\n\n// event procedure 1 /* the walk */\n${EVENT_1}\n`);
  const asm = spawnSync(process.execPath, [cli, 'asm', text, src, out], { encoding: 'utf8' });
  if (asm.status !== 0) {
    problems.push(`synthetic room: asm failed: ${asm.stderr}`);
    return;
  }
  // snd.vb was the last section, so the events go where it started, on a 4-byte boundary.
  const at = Math.ceil(vbAt / 4) * 4;
  const wantMessage = `wrote ${out}: init unchanged, main unchanged, event 2 procedure(s) written at 0x${at.toString(16)}\n`;
  if (asm.stdout !== wantMessage) problems.push(`synthetic room: asm said ${JSON.stringify(asm.stdout)}, want ${JSON.stringify(wantMessage)}`);

  const room = new Uint8Array(readFileSync(out));
  const section = parseRdt1(room).sections.find((s) => s.name === 'events.scd');
  const got = section ? hex(room.subarray(section.offset, section.offset + 100)) : 'no events section';
  if (section?.offset !== at || got !== EXPECTED_SECTION) {
    problems.push(`synthetic room: events section at 0x${section?.offset.toString(16)}\n  want ${EXPECTED_SECTION}\n  got  ${got}`);
  }

  const script = execFileSync(process.execPath, [cli, 'script', out], { encoding: 'utf8' });
  const events = script.slice(script.indexOf('// event procedure'));
  const wantText = `// event procedure 0 @ 0x${(at + 12).toString(16)}\n${EVENT_0}\n\n// event procedure 1 @ 0x${(at + 64).toString(16)}\n${EVENT_1}\n`;
  if (events !== wantText) problems.push(`synthetic room: script printed\n${events}--- want\n${wantText}`);
}

// ---------------------------------------------------------------- 2. retail quirks

const QUIRKS: { what: string; bytes: number[]; text: string }[] = [
  {
    what: 'a short SCD command, then a byte the engine stops at',
    bytes: [0x07, 0x04, 0x05, 0x04, 0x42, 0x00, 0xff, 0x00],
    text: 'scd_bytes(0x05, 0x04); /* runs set(FG_ROOM, 66, 0), reading 2 bytes past its end */\nraw(0x42, 0x00, 0xFF);',
  },
  {
    what: 'an SCD command in the anim state, where the engine hangs',
    bytes: [0x01, 0x86, 0x07, 0x04, 0x15, 0x03, 0xff, 0x00],
    text: 'anim_begin();\n    anim_idle();\n    raw(0x07, 0x04, 0x15, 0x03, 0xFF);',
  },
  {
    what: 'an SCD block with an endif and no if',
    bytes: [0x06, 0x09, 0x06, 0x00, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0x00],
    text: 'scd_block_bytes(0x03, 0x00, 0x00, 0x00); /* an SCD block whose if lengths do not match its blocks */\nreturn;',
  },
  {
    what: 'a loop the engine stops inside, kept whole',
    bytes: [0xfa, 0x00, 0x02, 0x00, 0xfe, 0x42, 0xfb, 0xff],
    text: 'raw(0xFA, 0x00, 0x02, 0x00, 0xFE, 0x42, 0xFB, 0xFF);',
  },
  {
    what: 'a sleep and a repeat stored with a count of 0, which the engine runs 65536 times',
    bytes: [0xf8, 0xf9, 0x00, 0x00, 0xfa, 0x00, 0x00, 0x00, 0xfe, 0xfb, 0xff, 0x00],
    text: 'sleep(65536);\nrepeat (65536) {\n    yield();\n}\nreturn;',
  },
  {
    what: 'a script that runs on into the next one, with zero bytes that are not all padding',
    bytes: [0xf8, 0xf9, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00],
    text: 'sleep(5);\nevt_nop();',
  },
];

function checkQuirks(): void {
  for (const { what, bytes, text } of QUIRKS) {
    const code = Uint8Array.from(bytes);
    const got = formatEvt1(readEvt1(code, 0, code.length));
    if (got !== text) {
      problems.push(`quirk (${what}): printed\n${got}\n--- want\n${text}`);
      continue;
    }
    try {
      const [body] = assembleScd1(`// event procedure 0\n${text}\n`).event;
      const diff = firstDifference(code, encodeEventSection([body]).subarray(8));
      if (diff) problems.push(`quirk (${what}): assembled ${diff}`);
    } catch (err) {
      problems.push(`quirk (${what}): ${message(err)}`);
    }
  }
}

// ---------------------------------------------------------------- 3. refusals

function checkRules(): void {
  const event = (body: string) => `// event procedure 0\n${body}\nreturn;`;
  const loops = (n: number, inner: string) => `${'repeat (2) {\n'.repeat(n)}${inner}\n${'}\n'.repeat(n)}`;
  const refused: [string, string, string][] = [
    ['anim op in the command state', event('anim_play(1, 2, 3);'), 'line 2: anim_play runs only in the anim state, between anim_begin() and anim_end()'],
    ['move op in the anim state', event('anim_begin();\nmove_step();'), 'line 3: move_step runs only in the move state, between move_begin() and move_end()'],
    ['SCD command in the anim state', event('anim_begin();\nset(FG_ROOM, 1, 0);'), 'line 3: SCD command set runs only in the command state; end the anim state with anim_end() first'],
    ['command op in the move state', event('move_begin();\nset_entity(ENT_PLAYER, 0);'), 'line 3: set_entity runs only in the command state; end the move state with move_end() first'],
    ['scd block in the move state', event('move_begin();\nscd {\nreturn;\n}'), 'line 3: an scd block runs only in the command state'],
    ['loop that changes state', event('repeat (2) {\nanim_begin();\n}'), 'began in the command state and ends in the anim state'],
    ['do without a yield', event('do {\nevt_nop();\n} while (ck(FG_ROOM, 1, 1));'), 'line 2: a do block must yield(), sleep() or wait_voice() inside'],
    ['do closed like repeat', event('do {\nyield();\n}'), 'line 4: a do block closes with "} while (...);"'],
    ['repeat closed like do', event('repeat (2) {\nyield();\n} while (ck(FG_ROOM, 1, 1));'), 'line 4: a repeat block closes with "}"'],
    ['unclosed repeat', '// event procedure 0\nrepeat (2) {\nyield();', 'line 2: repeat block is never closed'],
    ['loops 5 deep', event(loops(5, 'yield();')), 'line 6: repeat and do blocks nest at most 4 deep'],
    ['sleep inside 4 loops', event(loops(4, 'sleep(2);')), 'line 6: sleep needs a free stack entry, and 4 loops are open'],
    ['sleep(65537)', event('sleep(65537);'), 'line 2: sleep operand 1 is 65537, expected 1..65536'],
    ['sleep(0)', event('sleep(0);'), 'line 2: sleep operand 1 is 0, expected 1..65536'],
    ['repeat (0)', event('repeat (0) {\nyield();\n}'), 'line 2: repeat count is 0, expected 1..65536'],
    ['short look_at with a position mode', event('anim_begin();\nanim_look_at(19);'), 'line 3: anim_look_at takes 1 operand when the low 4 bits of its flags are 0'],
    ['move_speed out of range', event('move_begin();\nmove_speed(200, 0, 0);'), 'line 3: move_speed operand 1 is 200, expected -128..127'],
    ['wrong operand count', event('set_entity(ENT_PLAYER);'), 'line 2: set_entity takes 2 operands, got 1'],
    ['if outside an scd block', event('if (ck(FG_ROOM, 1, 1)) {\nyield();\n}'), 'line 2: an if block runs as SCD: put it inside scd { ... }'],
    ['statement after raw', '// event procedure 0\nraw(0x42);\nreturn;', 'line 3: raw(...) on line 2 must be the last statement'],
    ['unknown instruction', event('dance();'), 'line 2: unknown instruction dance'],
    ['empty procedure', '// event procedure 0\n// event procedure 1\nreturn;', 'event procedure 0 is empty'],
    ['bad SCD inside a block', event('scd {\nset(FG_ROOM, 1, 3);\n}'), 'line 3: set mode is 3'],
    ['evt_kill slot 8', event('evt_kill(8);'), 'line 2: evt_kill slot is 8; g_ScdEventTable has slots 0-7'],
    ['misspelled header', '// event procdure 0\nreturn;', 'line 1: "// event procdure 0" looks like a procedure header'],
  ];
  for (const [what, text, reason] of refused) {
    try {
      assembleScd1(text);
      problems.push(`refused (${what}): assembled`);
    } catch (err) {
      if (!message(err).includes(reason)) problems.push(`refused (${what}): got "${message(err)}", want "${reason}"`);
    }
  }
  const taken: [string, string][] = [
    ['a procedure that runs on into the next', '// event procedure 0\nsleep(2);\n// event procedure 1\nreturn;'],
    ['long look_at', '// event procedure 0\nanim_begin();\nanim_look_at(147, 1, 2, 0, 0, 0);\nanim_end();'],
    ['loops 4 deep', `// event procedure 0\n${loops(4, 'yield();')}`],
    ['events next to init and main', '// init procedure 0\nreturn;\n// event procedure 0\nreturn;\n// main procedure 0\nreturn;'],
  ];
  for (const [what, text] of taken) {
    try {
      assembleScd1(text);
    } catch (err) {
      problems.push(`taken (${what}): ${message(err)}`);
    }
  }
}

// ---------------------------------------------------------------- 4 and 5. retail rooms

interface Totals {
  rooms: number;
  events: number;
  instructions: number;
  raw: number;
  scdBytes: number;
  blockBytes: number;
  /** Instructions of 4 bytes or more at an odd offset from their script's start. */
  odd: number;
}

function checkRoundTrip(room: RoomFile, totals: Totals): void {
  const rdt = parseRdt1(room.bytes);
  const section = rdt.sections.find((s) => s.name === 'events.scd');
  if (!section) {
    problems.push(`${room.name}: no events section`);
    return;
  }
  totals.events += rdt.events.length;
  for (const e of rdt.events) {
    for (const ins of e.instructions) if (ins.kind !== 'raw' && ins.size >= 4 && (ins.offset - e.offset) % 2) totals.odd++;
  }
  for (const ins of rdt.events.flatMap((e) => e.instructions)) {
    totals.instructions++;
    if (ins.kind === 'raw') totals.raw++;
    if (ins.kind === 'scd_bytes') totals.scdBytes++;
    if (ins.kind === 'scd_block_bytes') totals.blockBytes++;
  }
  const assembled = assembleScd1(formatScripts(rdt)).event;
  const diff = firstDifference(room.bytes.subarray(section.offset, section.offset + section.size), encodeEventSection(assembled));
  if (diff) problems.push(`${room.name} events.scd @0x${section.offset.toString(16)}: ${diff}`);
}

/** Check the writer on one room. Returns false when the headroom guard refused it. */
function checkWriter(room: RoomFile): boolean {
  const fail = (what: string) => problems.push(`${room.name} writer: ${what}`);
  const before = parseRdt1(room.bytes);
  const bodies = before.events.map((e) => room.bytes.subarray(e.offset, e.offset + evtLength(e.instructions)));
  // An event script that runs on into the next one keeps its padding, so take the stored bytes up to the next start.
  const stored = before.events.map((e) => room.bytes.subarray(e.offset, e.offset + e.size));
  const same = replaceRdtSectionsSafe(room.bytes, stored);
  if (same && firstDifference(room.bytes, same)) fail('unchanged events changed the file');

  const added = Uint8Array.of(0xff);
  const written = replaceRdtSectionsSafe(room.bytes, [...bodies, added]);
  if (!written) return false;
  const after = parseRdt1(written);
  const dv = new DataView(written.buffer, written.byteOffset, written.byteLength);
  const odv = new DataView(room.bytes.buffer, room.bytes.byteOffset, room.bytes.byteLength);
  const vb0 = odv.getUint32(VB_POINTER_AT, true);
  const vbSize = before.sections.find((s) => s.offset === vb0)?.size ?? 0;
  const vbWasLast = vb0 + vbSize === room.bytes.length;
  const vb1 = dv.getUint32(VB_POINTER_AT, true);
  const events = after.sections.find((s) => s.name === 'events.scd');
  if (!events || events.offset % 4 !== 0 || events.offset < (vbWasLast ? vb0 : room.bytes.length) || events.offset + events.size > vb1) {
    fail('events.scd not written behind the old data, aligned and before snd.vb');
  }
  if (vb1 + vbSize !== written.length) fail('snd.vb is not the last data in the file');
  if (firstDifference(room.bytes.subarray(vb0, vb0 + vbSize), written.subarray(vb1, vb1 + vbSize))) fail('snd.vb data changed');
  const text = (r: typeof before) => r.events.map((e) => formatEvt1(e.instructions));
  const old = text(before);
  const now = text(after);
  if (now.length !== old.length + 1 || now.slice(0, -1).join('\n--\n') !== old.join('\n--\n') || now.at(-1) !== 'return;') {
    fail('event scripts do not read back as the old ones plus the added one');
  }
  if (formatScripts({ ...after, events: [] }) !== formatScripts({ ...before, events: [] })) fail('init or main scripts differ');
  for (let i = 0; i < room.bytes.length; i++) {
    const pointer = (at: number) => i >= at && i < at + 4;
    if (!pointer(EVENTS_POINTER_AT) && !pointer(VB_POINTER_AT) && !(vbWasLast && i >= vb0) && room.bytes[i] !== written[i]) {
      fail(`byte 0x${i.toString(16)} of the original changed`);
      break;
    }
  }
  return true;
}

/** replaceRdtSections with new event bodies, or null when its headroom guard refuses the room. */
function replaceRdtSectionsSafe(bytes: Uint8Array, event: Uint8Array[]): Uint8Array | null {
  try {
    return replaceRdtSections(bytes, { event });
  } catch (err) {
    if (message(err).includes('room buffer')) return null;
    throw err;
  }
}

checkSyntheticRoom();
checkQuirks();
checkRules();

const targets = process.argv.slice(2).length
  ? process.argv.slice(2)
  : (process.env.RAE_ROOMS ?? '').split(path.delimiter).filter(Boolean);
const totals: Totals = { rooms: 0, events: 0, instructions: 0, raw: 0, scdBytes: 0, blockBytes: 0, odd: 0 };
let writerRooms = 0;
let refusedRooms = 0;
for (const target of targets) {
  const files = [...roomFiles(target)].filter((f) => f.bytes.length >= MIN_ROOM);
  const guard = (room: RoomFile, work: () => void) => {
    try {
      work();
    } catch (err) {
      problems.push(`${room.name}: ${message(err)}`);
    }
  };
  for (const room of files) {
    totals.rooms++;
    guard(room, () => checkRoundTrip(room, totals));
  }
  // Spread the writer sample evenly over the target; a refused room gives way to the next one along.
  const step = Math.max(1, Math.floor(files.length / WRITER_SAMPLE));
  const candidates = files.map((room, i) => ({ room, i })).sort((a, b) => (a.i % step) - (b.i % step) || a.i - b.i);
  let sampled = 0;
  for (const { room } of candidates) {
    if (sampled >= WRITER_SAMPLE) break;
    guard(room, () => {
      if (checkWriter(room)) {
        sampled++;
        writerRooms++;
      } else {
        refusedRooms++;
      }
    });
  }
}

for (const problem of problems) console.log(problem);
if (targets.length === 0) {
  console.log('skipped the retail round trip: pass disc images or directories of .RDT files, or set RAE_ROOMS');
} else {
  console.log(
    `${totals.rooms} rooms, ${totals.events} event scripts, ${totals.instructions} instructions ` +
      `(${totals.raw} raw tails, ${totals.scdBytes} scd_bytes, ${totals.blockBytes} scd_block_bytes, ` +
      `${totals.odd} of 4 bytes or more at an odd offset), ` +
      `${writerRooms} rooms through the writer (${refusedRooms} skipped for headroom)`,
  );
}
console.log(`${problems.length} problems`);
if (problems.length) process.exit(1);
console.log(targets.length ? 'ok: every event script round-trips byte for byte' : 'ok: synthetic room, quirks and rules');
