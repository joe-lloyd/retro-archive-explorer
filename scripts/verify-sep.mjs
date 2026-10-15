// Builds a tiny RE1 music file (.HSB: a VAB header, a SEP, then one sample)
// from the documented layout, parses it, and checks the literal result. This
// proves the parser follows the layout; `rae music` on a retail disc is the
// check that the layout is RE1's. Run: node scripts/verify-sep.mjs
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Bundled first, as cli.mjs does, so it runs on Node 20 too.
const out = path.join(tmpdir(), `verify-sep-${process.pid}.mjs`);
await build({ entryPoints: [path.join(path.dirname(fileURLToPath(import.meta.url)), '../electron/parsers/audio/psxSeq.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'warning' });
const { adpcmLoop, parseHsb, sequenceToMidi } = await import(pathToFileURL(out).href);
rmSync(out, { force: true });

const u16le = (v) => [v & 0xff, v >> 8];
const be = (v, n) => Array.from({ length: n }, (_, i) => (v >> (8 * (n - 1 - i))) & 0xff);

// VAB header: one program (3) with one tone, one 48-byte sample.
const vab = new Array(32 + 2048 + 512 + 512).fill(0);
vab.splice(0, 4, ...[...'pBAV'].map((c) => c.charCodeAt(0)));
vab.splice(0x12, 2, ...u16le(1)); // programs
vab.splice(0x16, 2, ...u16le(1)); // samples
vab[0x18] = 100; // master volume
vab[0x19] = 64;
vab.splice(32 + 3 * 16, 5, 1, 90, 0, 0, 70); // program 3: 1 tone, volume 90, pan 70
const tone = 32 + 2048;
vab.splice(tone, 8, 0, 0, 120, 60, 62, 5, 10, 90); // volume, pan, centre, fine, min and max key
vab.splice(tone + 0x0c, 2, 2, 2); // bend range
vab.splice(tone + 0x10, 8, ...u16le(0x80ff), ...u16le(0x5fc0), ...u16le(3), ...u16le(1));
vab.splice(32 + 2048 + 512 + 2, 2, ...u16le(6)); // sample 1: 6 * 8 bytes

// One sequence: program 3; two notes, the second by running status; one
// closed by a note-off, one by velocity 0; the loop markers; end of track.
const events = [
  0x00, 0xb0, 99, 20,
  0x00, 0xc0, 3,
  0x00, 0x90, 60, 100,
  0x00, 64, 90,
  0x30, 0x80, 60, 0,
  0x30, 0x90, 64, 0,
  0x60, 0xb0, 99, 30,
  0x00, 0xff, 0x2f, 0x00,
];
const sep = [...[...'pQES'].map((c) => c.charCodeAt(0)), 0, 0, ...be(0, 2), ...be(48, 2), ...be(500000, 3), 4, 2, ...be(events.length, 4), ...events];

// The sample: a loop start block, a plain block, and an end block that repeats.
const sample = [0, 4, ...Array(14).fill(0), 0, 0, ...Array(14).fill(0), 0, 3, ...Array(14).fill(0)];
const le32 = (v) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24];
const trailer = [...le32(vab.length + sep.length), ...le32(vab.length), 0, 0, 0, 0];
const hsb = parseHsb(Uint8Array.from([...vab, ...sep, ...sample, ...trailer]));

assert.deepEqual(hsb.bank.programs, [
  {
    index: 3, volume: 90, pan: 70,
    tones: [{ program: 3, minKey: 10, maxKey: 90, center: 62, fine: 5, volume: 120, pan: 60, sample: 0, adsr1: 0x80ff, adsr2: 0x5fc0, bendMin: 2, bendMax: 2 }],
  },
]);
assert.deepEqual(hsb.samples, [{ offset: vab.length + sep.length, size: 48 }]);
assert.deepEqual(hsb.sequences, [
  {
    id: 0, ppq: 48, usPerQuarter: 500000, beats: 4, beatUnit: 4, ticks: 192, loop: { start: 0, end: 192 },
    events: [
      { tick: 0, kind: 'program', channel: 0, program: 3 },
      { tick: 0, kind: 'note', channel: 0, key: 60, velocity: 100, length: 48 },
      { tick: 0, kind: 'note', channel: 0, key: 64, velocity: 90, length: 96 },
    ],
  },
]);
assert.deepEqual(adpcmLoop(Uint8Array.from(sample)), { start: 0, end: 84 });
assert.equal(adpcmLoop(Uint8Array.from([0, 0, ...Array(14).fill(0), 0, 7, ...Array(14).fill(0)])), undefined);
assert.equal(adpcmLoop(Uint8Array.from([0, 4, ...Array(14).fill(0), 0, 1, ...Array(14).fill(0)])), undefined);

const midi = sequenceToMidi(hsb.sequences[0]);
assert.equal(String.fromCharCode(...midi.subarray(0, 4)), 'MThd');
assert.deepEqual([...midi.subarray(12, 14)], [0, 48]);
assert.equal(String.fromCharCode(...midi.subarray(14, 18)), 'MTrk');
assert.deepEqual([...midi.subarray(-3)], [0xff, 0x2f, 0]);

// A zero-length note's off follows its on; a key struck again where its last
// note ends is released before the new on.
const plain = { id: 0, ppq: 48, usPerQuarter: 500000, beats: 4, beatUnit: 4, ticks: 96, loop: undefined };
const retriggered = sequenceToMidi({
  ...plain,
  events: [
    { tick: 0, kind: 'note', channel: 0, key: 60, velocity: 100, length: 0 },
    { tick: 0, kind: 'note', channel: 0, key: 62, velocity: 100, length: 48 },
    { tick: 48, kind: 'note', channel: 0, key: 62, velocity: 90, length: 48 },
  ],
});
assert.deepEqual([...retriggered.subarray(22 + 15)], [
  0x00, 0x90, 60, 100,
  0x00, 0x80, 60, 0,
  0x00, 0x90, 62, 100,
  0x30, 0x80, 62, 0,
  0x00, 0x90, 62, 90,
  0x30, 0x80, 62, 0,
  0x00, 0xff, 0x2f, 0,
]);

// 20,000 notes make a 160,019-byte track, more than a call takes as arguments.
const long = sequenceToMidi({
  ...plain,
  ticks: 80000,
  events: Array.from({ length: 20000 }, (_, i) => ({ tick: i * 4, kind: 'note', channel: 0, key: 60, velocity: 100, length: 2 })),
});
assert.equal(long.length, 22 + 15 + 20000 * 8 + 4);
assert.deepEqual([...long.subarray(18, 22)], [0x00, 0x02, 0x71, 0x13]);
console.log('verify-sep: ok');
