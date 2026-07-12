import type { VirtualNode } from '../../shared/types';

/**
 * Unpack a `.RDT`/`.DAT` room container by following the table of 32-bit
 * offset pointers declared in its header. Each pointer marks the start of a
 * sub-file (background layers, sound tables, item parameters, ...); a sub-file's
 * size is the gap to the next valid pointer (or end of file).
 *
 * Formats vary between engines, so this is deliberately tolerant: a header word
 * is treated as a pointer only when it lands inside the file and past the header.
 */

/** Conventional slot names for the leading offsets in RE-style RDT headers. */
const SLOT_NAMES = [
  'sound_table',
  'sound_bank',
  'background_layer',
  'collision',
  'camera',
  'lighting',
  'item_params',
  'model_group',
];

export interface UnpackOptions {
  /** Number of leading u32 words to interpret as the offset table. */
  tableCount?: number;
  /** Prefix for generated node ids so they stay unique within the tree. */
  idPrefix: string;
  /** Virtual path of the container node these entries live under. */
  parentPath: string;
}

export function unpackContainer(
  buffer: Buffer,
  { tableCount = 8, idPrefix, parentPath }: UnpackOptions,
): VirtualNode[] {
  const fileSize = buffer.length;
  const headerBytes = tableCount * 4;
  if (fileSize < headerBytes) return [];

  // Collect candidate pointers that fall within the payload region.
  const pointers: { index: number; offset: number }[] = [];
  for (let i = 0; i < tableCount; i++) {
    const offset = buffer.readUInt32LE(i * 4);
    if (offset >= headerBytes && offset < fileSize) {
      pointers.push({ index: i, offset });
    }
  }
  if (pointers.length === 0) return [];

  // Sort by offset so gaps between consecutive pointers give sub-file sizes.
  const sorted = [...pointers].sort((a, b) => a.offset - b.offset);
  const nodes: VirtualNode[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const { index, offset } = sorted[i];
    const end = i + 1 < sorted.length ? sorted[i + 1].offset : fileSize;
    const size = end - offset;
    if (size <= 0) continue;
    const label = SLOT_NAMES[index] ?? `part_${index}`;
    const name = `${label}.bin`;
    nodes.push({
      id: `${idPrefix}:${index}`,
      name,
      path: `${parentPath}/${name}`,
      type: 'file',
      extension: 'bin',
      size,
      offset, // relative to the start of the container
    });
  }
  return nodes;
}
