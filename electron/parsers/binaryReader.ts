/** Cursor over a Buffer with bounds checks so a malformed asset fails loudly. */
export class BinaryReader {
  private pos = 0;
  constructor(private readonly buf: Buffer) {}

  get offset(): number {
    return this.pos;
  }

  get length(): number {
    return this.buf.length;
  }

  get remaining(): number {
    return this.buf.length - this.pos;
  }

  seek(pos: number): void {
    if (pos < 0 || pos > this.buf.length) {
      throw new RangeError(`seek out of bounds: ${pos} (len ${this.buf.length})`);
    }
    this.pos = pos;
  }

  skip(n: number): void {
    this.seek(this.pos + n);
  }

  private ensure(n: number): void {
    if (this.pos + n > this.buf.length) {
      throw new RangeError(
        `read past end: need ${n} at ${this.pos} (len ${this.buf.length})`,
      );
    }
  }

  u8(): number {
    this.ensure(1);
    return this.buf[this.pos++];
  }

  u16(): number {
    this.ensure(2);
    const v = this.buf.readUInt16LE(this.pos);
    this.pos += 2;
    return v;
  }

  i16(): number {
    this.ensure(2);
    const v = this.buf.readInt16LE(this.pos);
    this.pos += 2;
    return v;
  }

  u32(): number {
    this.ensure(4);
    const v = this.buf.readUInt32LE(this.pos);
    this.pos += 4;
    return v;
  }

  i32(): number {
    this.ensure(4);
    const v = this.buf.readInt32LE(this.pos);
    this.pos += 4;
    return v;
  }

  bytes(n: number): Buffer {
    this.ensure(n);
    const slice = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return slice;
  }
}
