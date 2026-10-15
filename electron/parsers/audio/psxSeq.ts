// PlayStation sequenced music: the VAB sound bank's instruments and the SEP
// multi-sequence that plays them. RE1 keeps each room group's music as one
// .HSB file: the bank header (VH), then the SEP, then the bank's samples (VB).
//
// Layouts follow Sony's libsnd formats (VabHdr, ProgAtr, VagAtr; SEP is
// "pQES", a 2-byte version, then per sequence: id, resolution, tempo, rhythm
// and a length-prefixed MIDI event stream with running status). Loop points
// are libsnd's NRPN markers: controller 99 set to 20 at the loop start and to
// 30 at its end.

export interface VabTone {
  readonly program: number;
  readonly minKey: number;
  readonly maxKey: number;
  /** The key at which the sample plays at its own rate (44.1 kHz on the SPU). */
  readonly center: number;
  /** Fine tune above `center`, in 1/128 semitones. */
  readonly fine: number;
  readonly volume: number;
  readonly pan: number;
  /** Index into the bank's samples, from 0. */
  readonly sample: number;
  readonly adsr1: number;
  readonly adsr2: number;
  readonly bendMin: number;
  readonly bendMax: number;
}

export interface VabProgram {
  readonly index: number;
  readonly volume: number;
  readonly pan: number;
  readonly tones: readonly VabTone[];
}

export interface VabBank {
  readonly volume: number;
  readonly pan: number;
  readonly programs: readonly VabProgram[];
  /** Byte size of each sample in the body, in order. */
  readonly sampleSizes: readonly number[];
  /** Header size: where the next part of the file starts. */
  readonly headerSize: number;
}

export type SeqEvent =
  | { readonly tick: number; readonly kind: 'note'; readonly channel: number; readonly key: number; readonly velocity: number; readonly length: number }
  | { readonly tick: number; readonly kind: 'program'; readonly channel: number; readonly program: number }
  | { readonly tick: number; readonly kind: 'control'; readonly channel: number; readonly control: number; readonly value: number }
  | { readonly tick: number; readonly kind: 'bend'; readonly channel: number; readonly value: number }
  | { readonly tick: number; readonly kind: 'tempo'; readonly usPerQuarter: number };

export interface Sequence {
  readonly id: number;
  /** Ticks per quarter note. */
  readonly ppq: number;
  readonly usPerQuarter: number;
  readonly beats: number;
  readonly beatUnit: number;
  /** The tick of the end-of-track marker. */
  readonly ticks: number;
  readonly loop?: { readonly start: number; readonly end: number };
  /** In tick order. Notes carry their length; note-offs are folded in. */
  readonly events: readonly SeqEvent[];
}

export interface Hsb {
  readonly bank: VabBank;
  readonly sequences: readonly Sequence[];
  /** Each sample's place in the file. */
  readonly samples: readonly { readonly offset: number; readonly size: number }[];
}

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
const u16le = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8);
const u32le = (b: Uint8Array, at: number) => (u16le(b, at) | (u16le(b, at + 2) << 16)) >>> 0;
const u16be = (b: Uint8Array, at: number) => (b[at]! << 8) | b[at + 1]!;
const u24be = (b: Uint8Array, at: number) => (b[at]! << 16) | (b[at + 1]! << 8) | b[at + 2]!;
const u32be = (b: Uint8Array, at: number) => ((u16be(b, at) << 16) | u16be(b, at + 2)) >>> 0;

/** The bank header ("pBAV"): programs, their tones and the sample sizes. */
export function parseVab(b: Uint8Array): VabBank {
  if (ascii(b, 0, 4) !== 'pBAV') throw new Error('not a VAB bank: no pBAV');
  const programCount = u16le(b, 0x12);
  const sampleCount = u16le(b, 0x16);
  const toneAt = 32 + 128 * 16;
  const sizesAt = toneAt + programCount * 16 * 32;
  const headerSize = sizesAt + 512;
  if (sampleCount > 254 || headerSize > b.length) throw new Error(`bad VAB header: ${programCount} programs, ${sampleCount} samples`);

  const tones: VabTone[] = [];
  for (let i = 0; i < programCount * 16; i++) {
    const t = toneAt + i * 32;
    const sample = u16le(b, t + 0x16);
    if (sample === 0) continue; // an unused tone slot
    tones.push({
      program: u16le(b, t + 0x14),
      minKey: b[t + 6]!,
      maxKey: b[t + 7]!,
      center: b[t + 4]!,
      fine: b[t + 5]!,
      volume: b[t + 2]!,
      pan: b[t + 3]!,
      sample: sample - 1,
      adsr1: u16le(b, t + 0x10),
      adsr2: u16le(b, t + 0x12),
      bendMin: b[t + 0x0c]!,
      bendMax: b[t + 0x0d]!,
    });
  }
  const programs: VabProgram[] = [];
  for (let p = 0; p < 128; p++) {
    const at = 32 + p * 16;
    if (b[at] === 0) continue;
    programs.push({ index: p, volume: b[at + 1]!, pan: b[at + 4]!, tones: tones.filter((t) => t.program === p) });
  }
  const sampleSizes = Array.from({ length: sampleCount }, (_, i) => u16le(b, sizesAt + (i + 1) * 2) * 8);
  return { volume: b[0x18]!, pan: b[0x19]!, programs, sampleSizes, headerSize };
}

function vlq(b: Uint8Array, at: number): [value: number, next: number] {
  let v = 0;
  for (;;) {
    const x = b[at++];
    if (x === undefined) throw new Error('sequence ends inside a delta time');
    v = (v << 7) | (x & 0x7f);
    if (x < 0x80) return [v, at];
  }
}

/** One sequence's MIDI stream, from its first delta time to end of track. */
function parseEvents(b: Uint8Array): { events: SeqEvent[]; ticks: number; loop?: { start: number; end: number } } {
  const events: SeqEvent[] = [];
  const open = new Map<number, { tick: number; velocity: number }[]>();
  let at = 0;
  let tick = 0;
  let status = 0;
  let loopStart: number | undefined;
  let loop: { start: number; end: number } | undefined;
  const close = (channel: number, key: number) => {
    const started = open.get(channel * 128 + key)?.shift();
    if (started) events.push({ tick: started.tick, kind: 'note', channel, key, velocity: started.velocity, length: tick - started.tick });
  };
  while (at < b.length) {
    const [delta, next] = vlq(b, at);
    at = next;
    tick += delta;
    if (b[at]! & 0x80) status = b[at++]!;
    const channel = status & 0x0f;
    switch (status & 0xf0) {
      case 0x80:
      case 0x90: {
        const key = b[at]!;
        const velocity = b[at + 1]!;
        at += 2;
        if ((status & 0xf0) === 0x90 && velocity > 0) {
          const k = channel * 128 + key;
          open.set(k, [...(open.get(k) ?? []), { tick, velocity }]);
        } else close(channel, key);
        break;
      }
      case 0xa0:
        at += 2;
        break;
      case 0xb0: {
        const control = b[at]!;
        const value = b[at + 1]!;
        at += 2;
        if (control === 99 && value === 20) loopStart = tick;
        else if (control === 99 && value === 30 && loopStart !== undefined && !loop) loop = { start: loopStart, end: tick };
        else events.push({ tick, kind: 'control', channel, control, value });
        break;
      }
      case 0xc0:
        events.push({ tick, kind: 'program', channel, program: b[at++]! });
        break;
      case 0xd0:
        at += 1;
        break;
      case 0xe0:
        events.push({ tick, kind: 'bend', channel, value: ((b[at + 1]! << 7) | b[at]!) - 8192 });
        at += 2;
        break;
      case 0xf0: {
        if (status !== 0xff) throw new Error(`unknown status 0x${status.toString(16)} at ${at}`);
        const type = b[at]!;
        if (type === 0x2f) {
          for (const [k, notes] of open) for (let i = notes.length; i > 0; i--) close(Math.floor(k / 128), k % 128);
          events.sort((x, y) => x.tick - y.tick);
          return { events, ticks: tick, loop };
        }
        // libsnd writes tempo as FF 51 with no length byte.
        if (type === 0x51) {
          events.push({ tick, kind: 'tempo', usPerQuarter: u24be(b, at + 1) });
          at += 4;
          break;
        }
        throw new Error(`unknown meta event 0x${type.toString(16)} at ${at}`);
      }
      default:
        throw new Error(`no running status at ${at}`);
    }
  }
  throw new Error('sequence has no end of track');
}

/** A SEP multi-sequence ("pQES", version 0): every sequence in it. */
export function parseSep(b: Uint8Array): Sequence[] {
  if (ascii(b, 0, 4) !== 'pQES' || u16be(b, 4) !== 0) throw new Error('not a SEP: no pQES with version 0');
  const out: Sequence[] = [];
  let at = 6;
  while (at + 13 <= b.length) {
    const usPerQuarter = u24be(b, at + 4);
    const length = u32be(b, at + 9);
    if (usPerQuarter === 0 || length === 0 || at + 13 + length > b.length) break; // padding to the bank's samples
    const { events, ticks, loop } = parseEvents(b.subarray(at + 13, at + 13 + length));
    out.push({ id: u16be(b, at), ppq: u16be(b, at + 2), usPerQuarter, beats: b[at + 7]!, beatUnit: 2 ** b[at + 8]!, ticks, loop, events });
    at += 13 + length;
  }
  return out;
}

/**
 * RE1's .HSB: a bank header, a SEP, the bank's samples, and a 12-byte
 * trailer giving where the samples and the SEP start (then a zero word).
 */
export function parseHsb(b: Uint8Array): Hsb {
  const bank = parseVab(b);
  const bodyAt = u32le(b, b.length - 12);
  const sepAt = u32le(b, b.length - 8);
  if (sepAt !== bank.headerSize || bodyAt < sepAt || bodyAt > b.length - 12) throw new Error(`bad HSB trailer: SEP at ${sepAt}, samples at ${bodyAt}`);
  const sequences = parseSep(b.subarray(sepAt, bodyAt));
  let offset = bodyAt;
  const samples = bank.sampleSizes.map((size) => {
    if (offset + size > b.length - 12) throw new Error('the samples run past the trailer');
    const s = { offset, size };
    offset += size;
    return s;
  });
  return { bank, sequences, samples };
}

/**
 * Where an SPU-ADPCM sample loops, in decoded samples (28 per 16-byte block),
 * from its block flags: bit 2 marks the loop start, and an end block (bit 0)
 * with bit 1 repeats. A lone block flagged 7 is RE1's silent end of a one-shot.
 */
export function adpcmLoop(data: Uint8Array): { start: number; end: number } | undefined {
  let start = 0;
  for (let i = 0; i + 16 <= data.length; i += 16) {
    const flags = data[i + 1]!;
    if (flags === 7) return undefined;
    if (flags & 4) start = (i / 16) * 28;
    if (flags & 1) return flags & 2 ? { start, end: (i / 16 + 1) * 28 } : undefined;
  }
  return undefined;
}

/** A standard MIDI file (format 0) of one sequence, so any player or editor can open its notes. */
export function sequenceToMidi(seq: Sequence): Uint8Array {
  const out: number[] = [];
  const vlqBytes = (v: number) => {
    const bytes = [v & 0x7f];
    while ((v >>= 7)) bytes.unshift((v & 0x7f) | 0x80);
    return bytes;
  };
  type Raw = { tick: number; order: number; bytes: number[] };
  const raw: Raw[] = [
    { tick: 0, order: 0, bytes: [0xff, 0x51, 3, (seq.usPerQuarter >> 16) & 0xff, (seq.usPerQuarter >> 8) & 0xff, seq.usPerQuarter & 0xff] },
    { tick: 0, order: 0, bytes: [0xff, 0x58, 4, seq.beats, Math.log2(seq.beatUnit), 24, 8] },
  ];
  for (const e of seq.events) {
    switch (e.kind) {
      case 'note':
        raw.push({ tick: e.tick, order: 2, bytes: [0x90 | e.channel, e.key, e.velocity] });
        raw.push({ tick: e.tick + e.length, order: 1, bytes: [0x80 | e.channel, e.key, 0] });
        break;
      case 'program':
        raw.push({ tick: e.tick, order: 0, bytes: [0xc0 | e.channel, e.program] });
        break;
      case 'control':
        raw.push({ tick: e.tick, order: 0, bytes: [0xb0 | e.channel, e.control, e.value] });
        break;
      case 'bend': {
        const v = e.value + 8192;
        raw.push({ tick: e.tick, order: 0, bytes: [0xe0 | e.channel, v & 0x7f, v >> 7] });
        break;
      }
      case 'tempo':
        raw.push({ tick: e.tick, order: 0, bytes: [0xff, 0x51, 3, (e.usPerQuarter >> 16) & 0xff, (e.usPerQuarter >> 8) & 0xff, e.usPerQuarter & 0xff] });
        break;
    }
  }
  if (seq.loop) {
    raw.push({ tick: seq.loop.start, order: 0, bytes: [0xff, 0x06, 9, ...[...'loopStart'].map((c) => c.charCodeAt(0))] });
    raw.push({ tick: seq.loop.end, order: 3, bytes: [0xff, 0x06, 7, ...[...'loopEnd'].map((c) => c.charCodeAt(0))] });
  }
  raw.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const track: number[] = [];
  let last = 0;
  for (const r of raw) {
    track.push(...vlqBytes(r.tick - last), ...r.bytes);
    last = r.tick;
  }
  track.push(...vlqBytes(Math.max(0, seq.ticks - last)), 0xff, 0x2f, 0);
  const be32 = (v: number) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
  out.push(...[...'MThd'].map((c) => c.charCodeAt(0)), ...be32(6), 0, 0, 0, 1, (seq.ppq >> 8) & 0xff, seq.ppq & 0xff);
  out.push(...[...'MTrk'].map((c) => c.charCodeAt(0)), ...be32(track.length), ...track);
  return Uint8Array.from(out);
}
