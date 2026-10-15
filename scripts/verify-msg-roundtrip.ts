// Round-trip proof for the message codec and the room message writer, run
// against real rooms.
//
//   node scripts/verify-msg-roundtrip.mjs <image | dir> [<image | dir> ...]
//
// For every room it checks that, for each message, encodeMessage(decoded text)
// equals the bytes stored in the file. Then, for a sample of rooms per target,
// it rewrites the room through replaceRdtMessages and checks that
//   1. every message decodes to the same text, and a message added at the end
//      decodes to the text given,
//   2. the new section is 4-byte aligned and sits past the old end of file or,
//      when snd.vb was the last section, where snd.vb started; snd.vb is the
//      last section afterwards, with the same data and the 0x90 pointer moved,
//   3. every byte of the original is unchanged except the 0x74 and 0x90
//      pointers (0x60-0x67 as well with scripts) and the old snd.vb region,
//   4. the header, cameras, camera switches and every other section parse to
//      the same values, and
//   5. the same holds when replaceRdtSections adds a procedure to main as well,
//      in either order, and the two writes together leave one snd.vb, not two.
// A room whose engine headroom the writer refuses to shrink is skipped and the
// next room along is used.
// Exits 1 on any mismatch.
import { roomFiles, type RoomFile } from './disc';
import { formatScripts, parseRdt1, readRdtMessages, replaceRdtMessages, replaceRdtSections, type Rdt1 } from '../electron/parsers/re1/rdt1';
import { decodeMessage, encodeMessage, MAX_MESSAGES, MessageError, readMessageSection } from '../electron/parsers/re1/msg1';
import { encodeScd1, formatScd1 } from '../electron/parsers/re1/scd1';

const MIN_ROOM = 0x94;
const WRITER_SAMPLE = 20;
/** `end(0)`: an empty procedure that just returns. */
const ADDED_PROCEDURE = Uint8Array.of(0x00, 0x00);
const MESSAGE_POINTER_AT = 0x74;
const VB_POINTER_AT = 0x90;
const SCRIPT_TABLE_FROM = 0x60;
const SCRIPT_TABLE_TO = 0x68;
const ADDED = 'New line, \\oquoted" (a/b)?\\n\\p{30}\\t{2}Red\\t{0} \\i\\c\\xF9\\x1C\\d{45}';

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Hand-written pairs whose bytes are known, so a codec that agrees with itself but not the engine fails. */
const KNOWN: [string, string][] = [
  ['Hello', '24 41 48 48 4b 01 00'],
  ['A\\nB', '1d 02 1e 01 00'],
  ['Open? "yes".\\d{70}', '2b 4c 41 4a 1b 00 19 55 41 4f 19 79 01 46'],
  ['\\s{0}\\n\\s{2}\\d{70}', '04 00 02 04 02 01 46'],
  ['Wait\\p{0}Go\\p{60}', '33 3d 45 50 03 00 23 4b 03 3c 01 00'],
  ['Take the \\i.', '30 3d 47 41 00 50 44 41 00 05 01 06 00 05 00 79 01 00'],
  ['\\t{2}\\m{5}\\r\\c\\q\\oX\\x09\\xF8\\x1C', '05 02 06 05 07 08 0a 78 34 09 f8 1c 01 00'],
  ['\\s{0}\\x01\\x03\\s{0}', '04 00 01 03 04 00 01 00'],
];

/** Texts the encoder must refuse, with the 0-based character index of the fault. */
const REFUSED: [string, number][] = [
  ['bad ~ char', 4],
  ['\\z', 0],
  ['abc\\', 3],
  ['\\p', 0],
  ['\\p{256}', 0],
  ['\\p{}', 0],
  ['\\xZZ', 0],
  ['\\x0', 0],
  ['\\x01', 0],
  ['\\x05', 0],
  ['\\xF8', 4],
  ['\\xF8\\x1', 4],
  ['\\d{5}tail', 5],
  ['\\s{0}text', 9],
  ['\\s{0}\\p{5}\\s{1}', 5],
  ['\\s{0}\\d{5}', 5],
  ['line\nbreak', 4],
];

function checkKnown(problems: string[]): void {
  for (const [text, want] of KNOWN) {
    let got: string;
    try {
      got = hex(encodeMessage(text));
    } catch (err) {
      problems.push(`known ${JSON.stringify(text)}: ${message(err)}`);
      continue;
    }
    if (got !== want) problems.push(`known ${JSON.stringify(text)}: want ${want}, got ${got}`);
    const back = decodeMessage(encodeMessage(text), 0).text;
    if (back !== text) problems.push(`known ${JSON.stringify(text)}: decodes to ${JSON.stringify(back)}`);
  }
  for (const [text, position] of REFUSED) {
    try {
      problems.push(`refused ${JSON.stringify(text)}: encoded to ${hex(encodeMessage(text))}`);
    } catch (err) {
      if (!(err instanceof MessageError)) problems.push(`refused ${JSON.stringify(text)}: ${message(err)}`);
      else if (err.position !== position) problems.push(`refused ${JSON.stringify(text)}: position ${err.position}, want ${position}`);
    }
  }
  const truncated: [string, number[]][] = [
    ['no end marker', [0x24, 0x25]],
    ['operand cut off', [0x24, 0x05]],
    ['end marker without frames', [0x24, 0x01]],
    ['unclosed span', [0x04, 0x00, 0x02, 0x01, 0x00]],
  ];
  for (const [what, bytes] of truncated) {
    try {
      problems.push(`truncated (${what}): decoded to ${decodeMessage(Uint8Array.from(bytes), 0).text}`);
    } catch (err) {
      if (!(err instanceof MessageError)) problems.push(`truncated (${what}): ${message(err)}`);
    }
  }
  if (readMessageSection(Uint8Array.from([0, 0, 0, 0])).length !== 0) problems.push('a zero table is not an empty message list');
  try {
    readMessageSection(Uint8Array.from([0x03, 0x00, 0x01, 0x00]));
    problems.push('odd offset table accepted');
  } catch (err) {
    if (!(err instanceof MessageError)) problems.push(`odd offset table: ${message(err)}`);
  }
}

/** Each message re-encodes to the bytes the file stores. */
function checkMessages(room: RoomFile, problems: string[]): number {
  const messages = readRdtMessages(room.bytes);
  messages.forEach((m, k) => {
    const got = encodeMessage(m.text);
    if (hex(got) !== hex(m.bytes)) {
      problems.push(`${room.name} message ${k} ${JSON.stringify(m.text)}: stored ${hex(m.bytes)}, encoded ${hex(got)}`);
    }
  });
  return messages.length;
}

/** Messages whose bytes reach past the end of the message section (retail ROOM5140 has one). */
function messageOverruns(room: RoomFile): number {
  const section = parseRdt1(room.bytes).sections.find((s) => s.name === 'message.msg');
  if (!section) return 0;
  return readRdtMessages(room.bytes).filter((m) => m.offset + m.bytes.length > section.size).length;
}

const texts = (bytes: Uint8Array) => readRdtMessages(bytes).map((m) => m.text);

/** What parseRdt1 reports about everything but messages and script placement. */
function shape(r: Rdt1): string {
  return JSON.stringify({ header: r.header, cameras: r.cameras, switches: r.cameraSwitches, events: r.events.map((e) => e.name) });
}

function scriptText(r: Rdt1): string {
  return [...r.init, ...r.main].map((p) => formatScd1(p.instructions)).join('\n--\n');
}

/** Rewrite one room and prove the result is the same room with only its messages changed. */
type Order = 'messages' | 'scripts+messages' | 'messages+scripts';

/** 'refused' when the writer's headroom guard turns the room down, which is not a failure. */
function checkWriter(room: RoomFile, order: Order, problems: string[]): 'checked' | 'refused' {
  const fail = (what: string) => problems.push(`${room.name} writer (${order}): ${what}`);
  const before = parseRdt1(room.bytes);
  const old = texts(room.bytes);
  const next = old.length < MAX_MESSAGES ? [...old, ADDED] : old;
  const bodies = (procs: Rdt1['init']) => procs.map((p) => encodeScd1(p.instructions));
  // An added procedure makes the scripts differ, so replaceRdtSections writes main.scd (and leaves init.scd).
  const scripts = { init: bodies(before.init), main: [...bodies(before.main), ADDED_PROCEDURE] };

  let written: Uint8Array;
  let sectionsOnly = 0;
  let messagesOnly = 0;
  try {
    messagesOnly = replaceRdtMessages(room.bytes, next).length;
    sectionsOnly = replaceRdtSections(room.bytes, scripts).length;
    if (order === 'messages') written = replaceRdtMessages(room.bytes, next);
    else if (order === 'scripts+messages') written = replaceRdtMessages(replaceRdtSections(room.bytes, scripts), next);
    else written = replaceRdtSections(replaceRdtMessages(room.bytes, next), scripts);
  } catch (err) {
    if (message(err).includes('room buffer')) return 'refused';
    throw err;
  }
  if (order === 'messages' && hex(written) === hex(room.bytes)) {
    return 'checked'; // the messages are already stored exactly so; nothing is written
  }
  const after = parseRdt1(written);
  const withScripts = order !== 'messages';

  const got = texts(written);
  if (got.length !== next.length || got.some((t, i) => t !== next[i])) fail('messages read back differ from the ones written');
  if (next.length > old.length && got[old.length] !== ADDED) fail('the added message did not read back as written');
  // snd.vb must end up last, with the same data, so the engine's scratch area starts past the new sections.
  const dv = new DataView(written.buffer, written.byteOffset, written.byteLength);
  const odv = new DataView(room.bytes.buffer, room.bytes.byteOffset, room.bytes.byteLength);
  const vb0 = odv.getUint32(VB_POINTER_AT, true);
  const vbSize = before.sections.find((s) => s.offset === vb0)?.size ?? 0;
  const vbWasLast = vb0 + vbSize === room.bytes.length;
  const vb1 = dv.getUint32(VB_POINTER_AT, true);
  // Both writers use one layout, so a composed write adds the two sections once and keeps a single snd.vb.
  const bare = (vbWasLast ? Math.ceil(vb0 / 4) * 4 : Math.ceil(room.bytes.length / 4) * 4) + vbSize;
  if (order !== 'messages' && written.length !== sectionsOnly + messagesOnly - bare) {
    fail(`${written.length} bytes, want ${sectionsOnly + messagesOnly - bare}: a snd.vb copy was left behind`);
  }
  if (vb1 + vbSize !== written.length) fail('snd.vb is not the last data in the file');
  if (hex(written.subarray(vb1, vb1 + vbSize)) !== hex(room.bytes.subarray(vb0, vb0 + vbSize))) fail('snd.vb data changed');

  const section = after.sections.find((s) => s.name === 'message.msg');
  const firstFree = vbWasLast ? vb0 : room.bytes.length;
  if (!section || section.offset % 4 !== 0 || section.offset < firstFree || section.offset + section.size > vb1) {
    fail('message section not written behind the old data, aligned and before snd.vb');
  }
  if (section && dv.getUint32(MESSAGE_POINTER_AT, true) !== section.offset) fail('0x74 does not point at the message section');

  // Only the pointers for what moved, and the old snd.vb region when it was overwritten, may differ.
  for (let i = 0; i < room.bytes.length; i++) {
    const pointer = (at: number) => i >= at && i < at + 4;
    const moved = pointer(MESSAGE_POINTER_AT) || pointer(VB_POINTER_AT);
    const movedScript = withScripts && i >= SCRIPT_TABLE_FROM && i < SCRIPT_TABLE_TO;
    const overwritten = vbWasLast && i >= vb0;
    if (!moved && !movedScript && !overwritten && room.bytes[i] !== written[i]) {
      fail(`byte 0x${i.toString(16)} of the original changed`);
      break;
    }
  }

  if (shape(after) !== shape(before)) fail('header, cameras, switches or events differ');
  if (withScripts) {
    const main = after.main.slice(0, -1);
    if (after.main.length !== before.main.length + 1 || scriptText({ ...after, init: after.init, main }) !== scriptText(before)) {
      fail('decoded scripts are not the old ones plus the added procedure');
    }
  } else if (formatScripts(after) !== formatScripts(before)) {
    fail('script text differs');
  }
  for (const s of before.sections) {
    const rewritten = s.name === 'message.msg' || s.name === 'offsets.tbl' || s.offset === vb0;
    if (rewritten || (withScripts && (s.name === 'init.scd' || s.name === 'main.scd'))) continue;
    const there = after.sections.find((a) => a.offset === s.offset);
    if (!there || there.name !== s.name) fail(`section ${s.name}@${s.offset} lost or renamed`);
    else if (there.size < s.size) fail(`section ${s.name}@${s.offset} shrank`);
    else if (hex(written.subarray(s.offset, s.offset + s.size)) !== hex(room.bytes.subarray(s.offset, s.offset + s.size))) {
      fail(`section ${s.name}@${s.offset} bytes differ`);
    }
  }
  return 'checked';
}

const ORDERS = ['messages', 'scripts+messages', 'messages+scripts'] as const;

let rooms = 0;
let skipped = 0;
let messages = 0;
let overruns = 0;
let writerRooms = 0;
let writerRuns = 0;
let refusedRooms = 0;
const problems: string[] = [];
checkKnown(problems);

for (const target of process.argv.slice(2)) {
  const files = [...roomFiles(target)].filter((f) => {
    if (f.bytes.length >= MIN_ROOM) return true;
    skipped++;
    return false;
  });
  files.forEach((room) => {
    rooms++;
    try {
      messages += checkMessages(room, problems);
      overruns += messageOverruns(room);
    } catch (err) {
      problems.push(`${room.name}: ${message(err)}`);
    }
  });
  // Rewrite WRITER_SAMPLE rooms spread evenly over the target. The guard on
  // engine headroom turns some rooms down; the next room along takes their place.
  const step = Math.max(1, Math.floor(files.length / WRITER_SAMPLE));
  const candidates = files.map((room, i) => ({ room, i })).sort((a, b) => (a.i % step) - (b.i % step) || a.i - b.i);
  let sampled = 0;
  for (const { room } of candidates) {
    if (sampled >= WRITER_SAMPLE) break;
    try {
      const results = ORDERS.map((order) => checkWriter(room, order, problems));
      writerRuns += results.filter((r) => r === 'checked').length;
      if (results.includes('checked')) {
        sampled++;
        writerRooms++;
      }
      if (results.includes('refused')) refusedRooms++;
    } catch (err) {
      problems.push(`${room.name}: ${message(err)}`);
    }
  }
}

if (rooms === 0) {
  console.error('usage: node scripts/verify-msg-roundtrip.mjs <image | dir> ...');
  process.exit(1);
}
for (const problem of problems) console.log(problem);
console.log(
  `${rooms} rooms (${skipped} empty slots skipped), ${messages} messages, ` +
    `${overruns} messages run past the end of their section, ` +
    `${writerRooms} rooms through the writer (${writerRuns} rewrites, ${refusedRooms} rooms had a write refused for headroom), ` +
    `${problems.length} problems`,
);
if (problems.length) process.exit(1);
console.log('ok: every message round-trips byte for byte');
