// Builds a tiny synthetic RE1 room file from the documented layout, runs the
// CLI's `room` and `script` commands on it, and checks the literal output.
// This proves the decoder follows the documented layout; it does not prove the
// layout matches retail discs. Run: node scripts/verify-rdt1.mjs
import { execFileSync } from 'node:child_process';
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
const mainOps = [0x01, 0, 0x04, 7, 5, 1, ...door, 0x02, 0, 0x0e, 0, 0x03, 0, 0x00, 0];
const container = (ops) => [...u16(ops.length + 2), ...ops, ...u16(0)];

const CAMERAS_AT = 0x94;
const ZONE_AT = CAMERAS_AT + 44;
const zone = [...u16(0), ...u16(1), ...Array(16).fill(0), ...u16(0xffff), ...u16(0xffff), ...Array(16).fill(0)];
const INIT_AT = ZONE_AT + zone.length;
const init = container(initOps);
const MAIN_AT = INIT_AT + init.length;
const main = container(mainOps);

const bytes = new Uint8Array(MAIN_AT + main.length);
bytes.set(u8(0, 1, 0, 0, 1, 0), 0);
const table = Array(19).fill(0);
table[0] = ZONE_AT;
table[6] = INIT_AT;
table[7] = MAIN_AT;
table.forEach((v, i) => bytes.set(u32(v), 0x48 + i * 4));
const camera = [0, 0, 1000, -2000, 3000, 0, 0, 0, 0, 0, 0].flatMap((v) => u32(v));
bytes.set(camera, CAMERAS_AT);
bytes.set(zone, ZONE_AT);
bytes.set(init, INIT_AT);
bytes.set(main, MAIN_AT);

const dir = mkdtempSync(path.join(tmpdir(), 'rdt1-'));
const file = path.join(dir, 'ROOM1000.RDT');
writeFileSync(file, bytes);

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cli.mjs');
const run = (cmd) => execFileSync(process.execPath, [cli, cmd, file], { encoding: 'utf8' });

const expectRoom = [
  'cameras',
  '  0: from (1000, -2000, 3000) to (0, 0, 0)',
  'camera switch zones: 1',
  '  enemy #3  Zombie (Groundskeeper) [0] at (100, 0, -200) facing 1024',
  '  item  #1  Beretta x15 at (300, 400)',
  '  door  #2  -> ROOM_203 at (10, 20), arrive (1, 2, 3), lock 0',
];
const expectScript = `// init procedure 0 @ 0x${INIT_AT.toString(16)}
enemy(0 /* Zombie (Groundskeeper) */, 0, 0, 0, 0, 0, 0, 1024, 0, 0, 100, 0, -200, 3, 0, 0, 0);
item_aot_set(1, 300, 400, 500, 500, 2 /* Beretta */, 15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
return;

// main procedure 0 @ 0x${MAIN_AT.toString(16)}
if (ck(FG_ITEM, 5, 1)) {
    door_aot_set(2, 10, 20, 30, 40, 0, 0, 0, 0, 0, ROOM_203, 1, 2, 3, 0, UNLOCKED, 0);
} else {
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
if (failed) process.exit(1);
console.log('ok: room and script output match');
