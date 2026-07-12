import type { TextureAsset } from '../../shared/types';
import { BinaryReader } from './binaryReader';

// TIM magic: first byte 0x10, version byte 0x00 -> reads as u32 LE 0x00000010.
// (The spec refers to this signature in big-endian notation as 0x10000000.)
const TIM_MAGIC = 0x00000010;

const PMODE_4BIT = 0;
const PMODE_8BIT = 1;
const PMODE_16BIT = 2;
const PMODE_24BIT = 3;
const CLUT_FLAG = 0x08;

/** Convert a 16-bit A1B5G5R5 PSX color to an RGBA tuple written into `out`. */
function writeColor16(color: number, out: Uint8ClampedArray, at: number): void {
  const r = (color & 0x1f) << 3;
  const g = ((color >> 5) & 0x1f) << 3;
  const b = ((color >> 10) & 0x1f) << 3;
  // Fully-zero entries are treated as transparent (common TIM convention).
  const a = color === 0 ? 0 : 255;
  out[at] = r | (r >> 5);
  out[at + 1] = g | (g >> 5);
  out[at + 2] = b | (b >> 5);
  out[at + 3] = a;
}

/**
 * Parse a `.TIM` texture into RGBA pixel data ready for a Canvas 2D blit.
 * Supports 4-bit and 8-bit paletted images plus 16-bit and 24-bit direct color.
 */
export function parseTim(buffer: Buffer): TextureAsset {
  const r = new BinaryReader(buffer);
  if (r.u32() !== TIM_MAGIC) {
    throw new Error('invalid TIM signature');
  }
  const flag = r.u32();
  const pmode = flag & 0x07;
  const hasClut = (flag & CLUT_FLAG) !== 0;

  // Optional CLUT block.
  let palette: Uint8ClampedArray | null = null;
  if (hasClut) {
    const bnum = r.u32();
    r.skip(4); // clut framebuffer x,y
    const cw = r.u16();
    const ch = r.u16();
    const colorCount = cw * ch;
    palette = new Uint8ClampedArray(colorCount * 4);
    for (let i = 0; i < colorCount; i++) {
      writeColor16(r.u16(), palette, i * 4);
    }
    // Defensive: honor the declared block length if we under/over-read.
    void bnum;
  }

  // Image data block.
  r.u32(); // image block byte length
  r.skip(4); // image framebuffer x,y
  const stride = r.u16(); // width in 16-bit words
  const height = r.u16();

  let width: number;
  switch (pmode) {
    case PMODE_4BIT:
      width = stride * 4;
      break;
    case PMODE_8BIT:
      width = stride * 2;
      break;
    case PMODE_16BIT:
      width = stride;
      break;
    case PMODE_24BIT:
      width = Math.floor((stride * 2) / 3);
      break;
    default:
      throw new Error(`unsupported TIM pixel mode ${pmode}`);
  }

  const pixels = new Uint8ClampedArray(width * height * 4);

  const paletteColor = (index: number): [number, number, number, number] => {
    if (!palette) return [index, index, index, 255];
    const p = index * 4;
    return [palette[p], palette[p + 1], palette[p + 2], palette[p + 3]];
  };

  const total = width * height;
  if (pmode === PMODE_4BIT) {
    for (let i = 0; i < total; i++) {
      const byte = r.u8();
      const idxLo = byte & 0x0f;
      const idxHi = (byte >> 4) & 0x0f;
      const [r0, g0, b0, a0] = paletteColor(idxLo);
      pixels.set([r0, g0, b0, a0], i * 4);
      i++;
      if (i >= total) break;
      const [r1, g1, b1, a1] = paletteColor(idxHi);
      pixels.set([r1, g1, b1, a1], i * 4);
    }
  } else if (pmode === PMODE_8BIT) {
    for (let i = 0; i < total; i++) {
      pixels.set(paletteColor(r.u8()), i * 4);
    }
  } else if (pmode === PMODE_16BIT) {
    for (let i = 0; i < total; i++) {
      writeColor16(r.u16(), pixels, i * 4);
    }
  } else {
    // 24-bit direct RGB.
    for (let i = 0; i < total; i++) {
      pixels[i * 4] = r.u8();
      pixels[i * 4 + 1] = r.u8();
      pixels[i * 4 + 2] = r.u8();
      pixels[i * 4 + 3] = 255;
    }
  }

  const bitDepth = pmode === PMODE_4BIT ? 4 : pmode === PMODE_8BIT ? 8 : pmode === PMODE_16BIT ? 16 : 24;
  return { kind: 'texture', width, height, pixels, bitDepth };
}
