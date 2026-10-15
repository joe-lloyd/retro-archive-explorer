// Builds a tiny synthetic RE1 room file from the documented layout, runs the
// CLI's `room`, `script`, `asm`, `msg` and `msg-set` commands on it, and checks
// the literal output.
// This proves the decoder follows the documented layout; it does not prove the
// layout matches retail discs. Run: node scripts/verify-rdt1.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const u8 = (...b) => b;
const s16 = (v) => [v & 0xff, (v >> 8) & 0xff];
const u16 = s16;
const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];

// enemy: type, state, killId, 4 unknown, facing, 2 unknown, x, y, z, id, 3 unknown (22 bytes)
const enemy = [0x1b, 0, 0, 0, 0, 0, 0, 0, ...s16(1024), 0, 0, ...s16(100), ...s16(0), ...s16(-200), 3, 0, 0, 0];
// item_aot_set: id, x, z, w, d, type, amount, 14 more (26 bytes)
const item = [0x18, 1, ...s16(300), ...s16(400), ...s16(500), ...s16(500), 2, 15, ...Array(14).fill(0)];
// door_aot_set: id, x, z, w, d, 5 bytes, target room, next x/y/z/d, lock type, free (26 bytes)
const door = [0x0c, 2, ...s16(10), ...s16(20), ...u16(30), ...u16(40), 0, 0, 0, 0, 0, (2 << 5) | 3, ...s16(1), ...s16(2), ...s16(3), ...s16(0), 0, 0];

const initOps = [...enemy, ...item, 0x00, 0x00];
// if (ck) { door } else { bgm_play(3) } return. RE1 closes an else block at the
// offset its length byte gives (else + bgm_play = 4 bytes), with no endif.
const mainOps = [0x01, 0, 0x04, 7, 5, 1, ...door, 0x02, 4, 0x15, 3, 0x00, 0];
const container = (ops) => [...u16(ops.length + 2), ...ops, ...u16(0)];

const CAMERAS_AT = 0x94;
const ZONE_AT = CAMERAS_AT + 44;
const zone = [...u16(0), ...u16(1), ...Array(16).fill(0), ...u16(0xffff), ...u16(0xffff), ...Array(16).fill(0)];
const INIT_AT = ZONE_AT + zone.length;
const init = container(initOps);
const MAIN_AT = INIT_AT + init.length;
const main = container(mainOps);
// One message, "Hi": the offset table, then H, i and the end marker 01 00.
const MESSAGES_AT = MAIN_AT + main.length;
const messages = [...u16(2), 0x24, 0x45, 0x01, 0x00];
// The writers keep snd.vb last; its bytes are never read here.
const VB_AT = MESSAGES_AT + messages.length;
const vb = Array(16).fill(0);

const bytes = new Uint8Array(VB_AT + vb.length);
bytes.set(u8(0, 1, 0, 0, 1, 0), 0);
const table = Array(19).fill(0);
table[0] = ZONE_AT;
table[6] = INIT_AT;
table[7] = MAIN_AT;
table[11] = MESSAGES_AT;
table[18] = VB_AT;
table.forEach((v, i) => bytes.set(u32(v), 0x48 + i * 4));
const camera = [0, 0, 1000, -2000, 3000, 0, 0, 0, 0, 0, 0].flatMap((v) => u32(v));
bytes.set(camera, CAMERAS_AT);
bytes.set(zone, ZONE_AT);
bytes.set(init, INIT_AT);
bytes.set(main, MAIN_AT);
bytes.set(messages, MESSAGES_AT);
bytes.set(vb, VB_AT);

const dir = mkdtempSync(path.join(tmpdir(), 'rdt1-'));
const file = path.join(dir, 'ROOM1000.RDT');
writeFileSync(file, bytes);

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cli.mjs');
const runOn = (...args) => execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
const run = (cmd) => runOn(cmd, file);
/** The CLI's error output for a command that must fail. */
const runFailing = (...args) => {
  const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  return r.status === 0 ? `exited 0:\n${r.stdout}` : r.stderr;
};
const write = (name, text) => {
  const at = path.join(dir, name);
  writeFileSync(at, text);
  return at;
};

const expectRoom = [
  'cameras',
  '  0: from (1000, -2000, 3000) to (0, 0, 0)',
  'camera switch zones: 1',
  '  enemy #3  Zombie (White Coat) [0] at (100, 0, -200) facing 1024',
  '  item  #1  Beretta x15 at (300, 400)',
  '  door  #2  -> ROOM_203 at (10, 20), arrive (1, 2, 3), lock 0',
];
const expectInit = `// init procedure 0 @ 0x${INIT_AT.toString(16)}
enemy(0 /* Zombie (White Coat) */, 0, 0, 0, 0, 0, 0, 1024, 0, 0, 100, 0, -200, 3, 0, 0, 0);
item_aot_set(1, 300, 400, 500, 500, 2 /* Beretta */, 15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
return;
`;
const expectScript = `${expectInit}
// main procedure 0 @ 0x${MAIN_AT.toString(16)}
if (ck(FG_ITEM, 5, 1)) {
    door_aot_set(2, 10, 20, 30, 40, 0, 0, 0, 0, 0, ROOM_203, 1, 2, 3, 0, UNLOCKED, 0);
} else {
    bgm_play(3);
}
return;
`;

let failed = 0;
const room = run('room');
for (const line of expectRoom) {
  if (!room.split('\n').includes(line)) {
    failed++;
    console.error(`room: missing line\n  ${line}`);
  }
}
const script = run('script');
if (script !== expectScript) {
  failed++;
  console.error(`script: mismatch\n--- expected\n${expectScript}--- actual\n${script}`);
}

// msg-set reads the room back by bytes, so spellings that decode to a shorter
// form (\x1D is A, \d{0} is the default end, \t{1}\m{0}\t{0} is \i) are written.
const msgOut = path.join(dir, 'MSG.RDT');
const spellings = write('messages.txt', '0: \\x1D\\d{0}\n1: \\t{1}\\m{0}\\t{0} found\n2: Hi\\d{30}\n');
const msgSet = spawnSync(process.execPath, [cli, 'msg-set', spellings, file, msgOut], { encoding: 'utf8' });
const expectMsg = '0: A\n1: \\i found\n2: Hi\\d{30}\n';
const gotMsg = msgSet.status === 0 ? runOn('msg', msgOut) : `msg-set failed: ${msgSet.stderr}`;
if (gotMsg !== expectMsg) {
  failed++;
  console.error(`msg-set: mismatch\n--- expected\n${expectMsg}--- actual\n${gotMsg}`);
}

// asm drops block comments that span lines, a header inside one included.
const asmOut = path.join(dir, 'ASM.RDT');
const commented = write('commented.scd', [
  '/* Notes on this room.',
  '// main procedure 1',
  'bgm_play(9);',
  '*/',
  '// main procedure 0',
  'bgm_play(3); /* first */',
  '/* a note that',
  '   runs over lines */ bgm_play(4);',
  'return;',
  '',
].join('\n'));
const asmRun = spawnSync(process.execPath, [cli, 'asm', commented, file, asmOut], { encoding: 'utf8' });
// snd.vb is the file's last section, so the new main.scd starts where it did, on a 4-byte boundary.
const expectAsm = `${expectInit}
// main procedure 0 @ 0x${(Math.ceil(VB_AT / 4) * 4).toString(16)}
bgm_play(3);
bgm_play(4);
return;
`;
const gotAsm = asmRun.status === 0 ? runOn('script', asmOut) : `asm failed: ${asmRun.stderr}`;
if (gotAsm !== expectAsm) {
  failed++;
  console.error(`asm: mismatch\n--- expected\n${expectAsm}--- actual\n${gotAsm}`);
}

// Errors after a block comment name the right line, and an unclosed one is refused.
const asmErrors = [
  ['// main procedure 0\n/* two\n   lines */\nbogus\n', 'line 4: cannot parse: bogus'],
  ['// main procedure 0\nreturn; /* never\nclosed\n', 'line 2: block comment "/*" is never closed by "*/"'],
];
asmErrors.forEach(([text, want], k) => {
  const got = runFailing('asm', write(`bad${k}.scd`, text), file, asmOut);
  if (!got.includes(want)) {
    failed++;
    console.error(`asm error ${k}: expected ${JSON.stringify(want)}, got\n${got}`);
  }
});

if (failed) process.exit(1);
console.log('ok: room, script, asm and msg-set output match');
