import { closeSync, openSync, readSync, statSync } from 'node:fs';

/**
 * Sector geometry of a disc image.
 * - Plain `.iso`: 2048-byte logical sectors, no gaps (dataOffset 0, stride 2048).
 * - Raw `.bin` (MODE2/2352): 2352-byte sectors carrying 2048 user bytes at offset 24.
 */
export interface Geometry {
  /** Total bytes per physical sector on disk. */
  stride: number;
  /** Offset of user data within a physical sector. */
  dataOffset: number;
  /** Usable user bytes per sector. */
  userSize: number;
}

const RAW_SYNC = Buffer.from([
  0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00,
]);

const ISO_GEOMETRY: Geometry = { stride: 2048, dataOffset: 0, userSize: 2048 };
// MODE2/FORM1: 12 sync + 4 header + 8 subheader = 24 bytes before user data.
const RAW_GEOMETRY: Geometry = { stride: 2352, dataOffset: 24, userSize: 2048 };

/**
 * Reads byte ranges from a disc image on demand without loading the whole file.
 * A single file descriptor stays open for the life of a mount session.
 */
export class ImageReader {
  private readonly fd: number;
  readonly size: number;
  readonly geometry: Geometry;

  constructor(filePath: string) {
    this.fd = openSync(filePath, 'r');
    this.size = statSync(filePath).size;
    this.geometry = ImageReader.detectGeometry(this.fd);
  }

  private static detectGeometry(fd: number): Geometry {
    const head = Buffer.alloc(12);
    readSync(fd, head, 0, 12, 0);
    return head.equals(RAW_SYNC) ? RAW_GEOMETRY : ISO_GEOMETRY;
  }

  /** Read an arbitrary absolute byte range straight from disk. */
  readAbsolute(offset: number, length: number): Buffer {
    if (offset < 0 || length < 0 || offset + length > this.size) {
      throw new RangeError(
        `read out of bounds: offset=${offset} length=${length} size=${this.size}`,
      );
    }
    const buf = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const n = readSync(this.fd, buf, read, length - read, offset + read);
      if (n <= 0) break;
      read += n;
    }
    return read === length ? buf : buf.subarray(0, read);
  }

  /**
   * Read `length` logical bytes starting at logical block address `lba`,
   * hopping across physical sectors and skipping inter-sector gaps for raw images.
   */
  readLogical(lba: number, length: number): Buffer {
    const { stride, dataOffset, userSize } = this.geometry;
    const out = Buffer.alloc(length);
    let written = 0;
    let sector = lba;
    while (written < length) {
      const chunk = Math.min(userSize, length - written);
      const abs = sector * stride + dataOffset;
      if (abs + chunk > this.size) break;
      const part = this.readAbsolute(abs, chunk);
      part.copy(out, written);
      written += part.length;
      if (part.length < chunk) break;
      sector += 1;
    }
    return written === length ? out : out.subarray(0, written);
  }

  /** Absolute byte offset of the start of a logical block's user data. */
  logicalToAbsolute(lba: number): number {
    return lba * this.geometry.stride + this.geometry.dataOffset;
  }

  close(): void {
    closeSync(this.fd);
  }
}
