// PSX .STR video decoder: demux CD-STR sectors, decode MDEC (BS v2/v3) frames.
// Reference: the well-documented PSX MDEC bitstream (jPSXdec, nocash PSX specs).

const SECTOR = 2048;
const STR_HEADER = 32; // per-sector STR sub-header
const DATA_PER_SECTOR = SECTOR - STR_HEADER;

export interface StrFrame {
  frameNum: number;
  width: number;
  height: number;
  bs: Buffer; // assembled BS bitstream for this frame
}

/** Split a raw .STR file into frames by demuxing its video sectors. */
export function demuxStr(buffer: Buffer): StrFrame[] {
  const frames: StrFrame[] = [];
  let cur: { frameNum: number; width: number; height: number; parts: Buffer[] } | null = null;
  for (let off = 0; off + SECTOR <= buffer.length + 1 && off + STR_HEADER <= buffer.length; off += SECTOR) {
    if (buffer.readUInt16LE(off) !== 0x0160 || buffer.readUInt16LE(off + 2) !== 0x8001) continue;
    const frameNum = buffer.readUInt32LE(off + 8);
    const width = buffer.readUInt16LE(off + 16);
    const height = buffer.readUInt16LE(off + 18);
    const data = buffer.subarray(off + STR_HEADER, Math.min(off + SECTOR, buffer.length));
    if (!cur || cur.frameNum !== frameNum) {
      if (cur) frames.push({ frameNum: cur.frameNum, width: cur.width, height: cur.height, bs: Buffer.concat(cur.parts) });
      cur = { frameNum, width, height, parts: [] };
    }
    cur.parts.push(data.subarray(0, DATA_PER_SECTOR));
  }
  if (cur) frames.push({ frameNum: cur.frameNum, width: cur.width, height: cur.height, bs: Buffer.concat(cur.parts) });
  return frames;
}

// --- MDEC constants ---

// zig-zag scan order.
const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6,
  7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31,
  39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];

// Standard PSX MDEC quantization matrix.
const QUANT = [
  2, 16, 19, 22, 26, 27, 29, 34, 16, 16, 22, 24, 27, 29, 34, 37, 19, 22, 26, 27, 29, 34, 34, 38, 22, 22,
  26, 27, 29, 34, 37, 40, 22, 26, 27, 29, 32, 35, 40, 48, 26, 27, 29, 32, 35, 40, 48, 58, 26, 27, 29, 34,
  38, 46, 56, 69, 27, 29, 35, 38, 46, 56, 69, 83,
];

/** MDEC AC coefficient VLC table entries: [codeString, run, level]. */
const AC_VLC: [string, number, number][] = [
  ['11', 0, 1], ['011', 1, 1], ['0100', 0, 2], ['0101', 2, 1], ['00101', 0, 3], ['00110', 4, 1],
  ['00111', 3, 1], ['000100', 7, 1], ['000101', 6, 1], ['000110', 1, 2], ['000111', 5, 1],
  ['0000100', 2, 2], ['0000101', 9, 1], ['0000110', 0, 4], ['0000111', 8, 1], ['00100000', 13, 1],
  ['00100001', 0, 6], ['00100010', 12, 1], ['00100011', 11, 1], ['00100100', 3, 2], ['00100101', 1, 3],
  ['00100110', 0, 5], ['00100111', 10, 1], ['0000001000', 16, 1], ['0000001001', 5, 2],
  ['0000001010', 0, 7], ['0000001011', 2, 3], ['0000001100', 1, 4], ['0000001101', 15, 1],
  ['0000001110', 14, 1], ['0000001111', 4, 2], ['000000010000', 0, 11], ['000000010001', 8, 2],
  ['000000010010', 4, 3], ['000000010011', 0, 10], ['000000010100', 2, 4], ['000000010101', 7, 2],
  ['000000010110', 21, 1], ['000000010111', 20, 1], ['000000011000', 0, 9], ['000000011001', 19, 1],
  ['000000011010', 18, 1], ['000000011011', 1, 5], ['000000011100', 3, 3], ['000000011101', 0, 8],
  ['000000011110', 6, 2], ['000000011111', 17, 1], ['0000000010000', 10, 2], ['0000000010001', 9, 2],
  ['0000000010010', 5, 3], ['0000000010011', 3, 4], ['0000000010100', 2, 5], ['0000000010101', 1, 7],
  ['0000000010110', 1, 6], ['0000000010111', 0, 15], ['0000000011000', 0, 14], ['0000000011001', 0, 13],
  ['0000000011010', 0, 12], ['0000000011011', 26, 1], ['0000000011100', 25, 1], ['0000000011101', 24, 1],
  ['0000000011110', 23, 1], ['0000000011111', 22, 1],
];
const EOB = '10';
const ESCAPE = '000001';

/** Bit reader over 16-bit little-endian words, MSB-first. */
class BitReader {
  private word = 0;
  private bits = 0;
  private pos = 0;
  constructor(private buf: Buffer, start: number) {
    this.pos = start;
  }
  read1(): number {
    if (this.bits === 0) {
      if (this.pos + 1 >= this.buf.length) return 0;
      // NOTE: bitstream endianness/DC coding still under investigation — the
      // demux is correct but the block VLC desyncs after the first MB row.
      this.word = this.buf.readUInt16LE(this.pos);
      this.pos += 2;
      this.bits = 16;
    }
    this.bits--;
    return (this.word >> this.bits) & 1;
  }
  readN(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | this.read1();
    return v;
  }
  get bytePos(): number {
    return this.pos;
  }
}

// Build a prefix lookup for the AC table.
const AC_MAP = new Map<string, [number, number]>();
for (const [code, run, level] of AC_VLC) AC_MAP.set(code, [run, level]);
const AC_MAXLEN = Math.max(...AC_VLC.map((e) => e[0].length), ESCAPE.length, EOB.length);

interface AcCode { run: number; level: number; eob: boolean }

function readAc(br: BitReader): AcCode | null {
  let code = '';
  for (let i = 0; i < AC_MAXLEN + 6; i++) {
    code += br.read1();
    if (code === EOB) return { run: 0, level: 0, eob: true };
    if (code === ESCAPE) {
      const run = br.readN(6);
      let level = br.readN(10);
      if (level & 0x200) level -= 0x400; // sign-extend 10-bit
      return { run, level, eob: false };
    }
    const hit = AC_MAP.get(code);
    if (hit) {
      const sign = br.read1();
      return { run: hit[0], level: sign ? -hit[1] : hit[1], eob: false };
    }
  }
  return null; // desync
}

function idct8(block: Float64Array): void {
  // Separable 2D IDCT (rows then columns).
  const tmp = new Float64Array(64);
  const C = (u: number) => (u === 0 ? Math.SQRT1_2 : 1);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let s = 0;
      for (let u = 0; u < 8; u++) s += C(u) * block[y * 8 + u] * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
      tmp[y * 8 + x] = s * 0.5;
    }
  }
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      let s = 0;
      for (let v = 0; v < 8; v++) s += C(v) * tmp[v * 8 + x] * Math.cos(((2 * y + 1) * v * Math.PI) / 16);
      block[y * 8 + x] = s * 0.5;
    }
  }
}

/** Decode one 8x8 block from the bitstream into spatial samples (-128..127-ish). */
function decodeBlock(br: BitReader, qScale: number): Float64Array | null {
  const coeffs = new Float64Array(64);
  // DC: first code is (run, level); level is the DC value, dequantized by QUANT[0].
  const dc = readAc(br);
  if (!dc || dc.eob) return coeffs; // empty block
  coeffs[0] = dc.level * QUANT[0];
  let idx = 0;
  let cur = dc;
  // The first readAc already gave the DC as run/level starting at position 0.
  // Continue reading AC coefficients until EOB.
  // (DC used run as 0 offset.)
  idx += cur.run; // for DC run should be 0
  for (;;) {
    cur = readAc(br) as AcCode;
    if (!cur) return null;
    if (cur.eob) break;
    idx += cur.run + 1;
    if (idx >= 64) break;
    const zz = ZIGZAG[idx];
    coeffs[zz] = (cur.level * QUANT[zz] * qScale) / 8;
  }
  idct8(coeffs);
  return coeffs;
}

/** Decode an MDEC BS frame into an RGBA image. */
export function decodeMdecFrame(bs: Buffer, width: number, height: number): Uint8ClampedArray | null {
  if (bs.length < 8 || bs.readUInt16LE(2) !== 0x3800) return null;
  const qScale = bs.readUInt16LE(4);
  const br = new BitReader(bs, 8);

  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  const mbW = Math.ceil(width / 16);
  const mbH = Math.ceil(height / 16);

  for (let my = 0; my < mbH; my++) {
    for (let mx = 0; mx < mbW; mx++) {
      // Block order: Cr, Cb, Y0, Y1, Y2, Y3.
      const cr = decodeBlock(br, qScale);
      const cb = decodeBlock(br, qScale);
      const y0 = decodeBlock(br, qScale);
      const y1 = decodeBlock(br, qScale);
      const y2 = decodeBlock(br, qScale);
      const y3 = decodeBlock(br, qScale);
      if (!cr || !cb || !y0 || !y1 || !y2 || !y3) return rgba; // stop on desync, keep what we have
      const yBlocks = [y0, y1, y2, y3];
      for (let by = 0; by < 16; by++) {
        for (let bx = 0; bx < 16; bx++) {
          const q = (by >> 3) * 2 + (bx >> 3);
          const Y = yBlocks[q][(by & 7) * 8 + (bx & 7)] + 128;
          const cIdx = (by >> 1) * 8 + (bx >> 1);
          const Cr = cr[cIdx];
          const Cb = cb[cIdx];
          const r = Y + 1.402 * Cr;
          const g = Y - 0.344 * Cb - 0.714 * Cr;
          const b = Y + 1.772 * Cb;
          const px = my * 16 + by;
          const pxX = mx * 16 + bx;
          if (px < height && pxX < width) {
            const o = (px * width + pxX) * 4;
            rgba[o] = r;
            rgba[o + 1] = g;
            rgba[o + 2] = b;
          }
        }
      }
    }
  }
  return rgba;
}
