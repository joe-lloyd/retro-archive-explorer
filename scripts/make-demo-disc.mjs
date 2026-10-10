// Builds a small ISO-9660 demo disc with one file of each kind the app can
// open: an RE1 room, a TIM texture, a VAG sound, a TMD model and a PS-X EXE.
// Every byte is generated here, so the disc holds no game data. Needs macOS
// (hdiutil). Run: node scripts/make-demo-disc.mjs out/demo.iso
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = process.argv[2];
if (!out?.toLowerCase().endsWith('.iso')) {
  // hdiutil appends .iso to any other name, so the file would not land at <out>.
  console.error('usage: node scripts/make-demo-disc.mjs <out.iso>');
  process.exit(1);
}

const le16 = (v) => [v & 0xff, (v >> 8) & 0xff];
const le32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
const be32 = (v) => le32(v).reverse();

// 64x64 16-bit TIM: an eight-wedge red and white badge on black.
function tim() {
  const w = 64;
  const h = 64;
  const px = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - 31.5;
      const dy = y - 31.5;
      const r = Math.hypot(dx, dy);
      const wedge = Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * 8) % 2;
      // PS1 15-bit color: 5 bits each of red, green, blue, low bits first.
      const [cr, cg, cb] = r > 30 ? [0, 0, 0] : r > 28 ? [31, 31, 31] : wedge ? [28, 2, 2] : [31, 31, 31];
      px.push(...le16(cr | (cg << 5) | (cb << 10)));
    }
  }
  return [...le32(0x10), ...le32(0x02), ...le32(12 + px.length), ...le16(0), ...le16(0), ...le16(w), ...le16(h), ...px];
}

// Two-note chime as a VAG, encoded with SPU-ADPCM filter 0 and a per-block shift.
function vag() {
  const rate = 22050;
  const pcm = [];
  for (const [freq, secs] of [[880, 0.18], [1320, 0.45]]) {
    const n = Math.round(rate * secs);
    for (let i = 0; i < n; i++) pcm.push(Math.sin((2 * Math.PI * freq * i) / rate) * 12000 * Math.exp((-4 * i) / n));
  }
  while (pcm.length % 28) pcm.push(0);
  const data = Array(16).fill(0);
  for (let b = 0; b < pcm.length; b += 28) {
    const block = pcm.slice(b, b + 28);
    const peak = Math.max(...block.map(Math.abs));
    let shift = 12;
    while (shift > 0 && 7 * (4096 >> shift) < peak) shift--;
    const step = 4096 >> shift;
    const nibs = block.map((s) => Math.max(-8, Math.min(7, Math.round(s / step))) & 0x0f);
    const flags = b + 28 >= pcm.length ? 1 : 0;
    data.push(shift, flags);
    for (let i = 0; i < 28; i += 2) data.push(nibs[i] | (nibs[i + 1] << 4));
  }
  data.push(0, 7, ...Array(14).fill(0));
  const name = [...Buffer.from('CHIME'), ...Array(11).fill(0)];
  return [...Buffer.from('VAGp'), ...be32(0x20), ...be32(0), ...be32(data.length), ...be32(rate), ...Array(12).fill(0), ...name, ...data];
}

// TMD cube with one gouraud-shaded quad per face and a color per corner.
function tmd() {
  const s = 400;
  const corners = [];
  for (const z of [-s, s]) for (const y of [-s, s]) for (const x of [-s, s]) corners.push([x, y, z]);
  const color = (i) => [i & 1 ? 230 : 40, i & 2 ? 200 : 30, i & 4 ? 220 : 50];
  const faces = [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 6, 2], [1, 5, 3, 7], [4, 5, 0, 1], [2, 3, 6, 7]];
  const verts = corners.flatMap(([x, y, z]) => [...le16(x), ...le16(y), ...le16(z), 0, 0]);
  // olen, ilen (words after the tag), flag, mode 0x38 = polygon, gouraud, quad.
  const prims = faces.flatMap((f) => [8, 6, 0, 0x38, ...f.flatMap((v) => [...color(v), 0x38]), ...f.flatMap(le16)]);
  const vertTop = 28;
  const primTop = vertTop + verts.length;
  const table = [vertTop, corners.length, primTop, 0, primTop, faces.length, 0].flatMap(le32);
  return [...le32(0x41), ...le32(0), ...le32(1), ...table, ...verts, ...prims];
}

// PS-X EXE with a short MIPS routine: write to a hardware register, call a
// function, and return through a stack frame.
function exe() {
  const code = [
    0x27bdffe8, // addiu sp, sp, -24
    0xafbf0014, // sw    ra, 20(sp)
    0x3c081f80, // lui   t0, 0x1f80
    0x24091234, // addiu t1, zero, 0x1234
    0xad091810, // sw    t1, 0x1810(t0)
    0x0c004040, // jal   0x80010100
    0x00000000, // nop
    0x8fbf0014, // lw    ra, 20(sp)
    0x03e00008, // jr    ra
    0x27bd0018, // addiu sp, sp, 24
  ].flatMap(le32);
  while (code.length % 2048) code.push(0);
  const header = Array(2048).fill(0);
  header.splice(0, 8, ...Buffer.from('PS-X EXE'));
  header.splice(0x10, 4, ...le32(0x80010000));
  header.splice(0x18, 4, ...le32(0x80010000));
  header.splice(0x1c, 4, ...le32(code.length));
  header.splice(0x30, 4, ...le32(0x801ffff0));
  return [...header, ...code];
}

// The room comes from the verifier, which writes it under os.tmpdir().
function room(scratch) {
  const verifier = path.join(path.dirname(fileURLToPath(import.meta.url)), 'verify-rdt1.mjs');
  execFileSync(process.execPath, [verifier], { env: { ...process.env, TMPDIR: scratch }, stdio: 'ignore' });
  const dir = readdirSync(scratch).find((d) => d.startsWith('rdt1-'));
  if (!dir) throw new Error('verify-rdt1 did not write a room');
  return path.join(scratch, dir, 'ROOM1000.RDT');
}

const scratch = mkdtempSync(path.join(tmpdir(), 'demo-disc-'));
try {
  const root = path.join(scratch, 'disc');
  const files = {
    'SYSTEM.CNF': Buffer.from('BOOT = cdrom:\\DEMO.EXE;1\r\nTCB = 4\r\nEVENT = 10\r\nSTACK = 801FFFF0\r\n'),
    'DEMO.EXE': exe(),
    'PSX/DATA/BADGE.TIM': tim(),
    'PSX/SOUND/CHIME.VAG': vag(),
    'PSX/MODEL/CUBE.TMD': tmd(),
  };
  for (const [name, bytes] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), Buffer.from(bytes));
  }
  mkdirSync(path.join(root, 'PSX/STAGE1'), { recursive: true });
  copyFileSync(room(scratch), path.join(root, 'PSX/STAGE1/ROOM1000.RDT'));
  mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  rmSync(out, { force: true });
  execFileSync('hdiutil', ['makehybrid', '-iso', '-default-volume-name', 'RAE_DEMO', '-o', out, root], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  console.log(`wrote ${out}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
