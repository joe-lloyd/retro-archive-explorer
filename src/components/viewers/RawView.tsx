import { useMemo } from 'react';

const BYTES_PER_ROW = 16;
const MAX_ROWS = 8192; // guard against multi-megabyte dumps freezing the UI

function toHex(n: number, width: number): string {
  return n.toString(16).padStart(width, '0');
}

function buildHexDump(bytes: Uint8Array): string {
  const rows: string[] = [];
  const limit = Math.min(bytes.length, MAX_ROWS * BYTES_PER_ROW);
  for (let off = 0; off < limit; off += BYTES_PER_ROW) {
    const slice = bytes.subarray(off, off + BYTES_PER_ROW);
    const hex: string[] = [];
    let ascii = '';
    for (let i = 0; i < BYTES_PER_ROW; i++) {
      if (i < slice.length) {
        const b = slice[i];
        hex.push(toHex(b, 2));
        ascii += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.';
      } else {
        hex.push('  ');
      }
    }
    rows.push(`${toHex(off, 8)}  ${hex.join(' ')}  ${ascii}`);
  }
  if (bytes.length > limit) rows.push(`… ${bytes.length - limit} more bytes`);
  return rows.join('\n');
}

/** Renders raw bytes as either a hex dump or decoded text. */
export function RawView({ bytes, mode }: { bytes: Uint8Array; mode: 'hex' | 'text' }) {
  const content = useMemo(() => {
    if (mode === 'text') {
      return new TextDecoder('latin1').decode(bytes.subarray(0, MAX_ROWS * BYTES_PER_ROW));
    }
    return buildHexDump(bytes);
  }, [bytes, mode]);

  return <pre className="text-content">{content}</pre>;
}
