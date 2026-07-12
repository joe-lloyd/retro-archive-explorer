import type { VirtualNode } from '../../shared/types';
import { ImageReader } from './imageReader';

/** Where a file's data physically lives, used for lazy reads. */
export interface NodeDescriptor {
  /** Logical block address of the file's first sector. */
  lba: number;
  size: number;
}

export interface MountResult {
  root: VirtualNode;
  /** id -> physical descriptor, for on-demand byte-range reads. */
  descriptors: Map<string, NodeDescriptor>;
}

const SECTOR = 2048;
const FLAG_DIRECTORY = 0x02;
const MAX_DEPTH = 32;

function extension(name: string): string | undefined {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : undefined;
}

/** Strip the ISO-9660 version suffix (";1") and normalize casing. */
function cleanName(raw: string): string {
  const semi = raw.indexOf(';');
  return (semi >= 0 ? raw.slice(0, semi) : raw).trim();
}

/**
 * Mount an ISO-9660 (or raw MODE2/2352 `.bin`) image and build the directory
 * tree. Only directory sectors are read here; file payloads stay on disk until
 * a node is explicitly requested.
 */
export function mountImage(filePath: string): MountResult {
  const reader = new ImageReader(filePath);
  try {
    const pvd = reader.readLogical(16, SECTOR);
    if (pvd.length < SECTOR || pvd[0] !== 0x01) {
      throw new Error('not a valid ISO-9660 image (missing primary volume descriptor)');
    }
    // Root directory record lives at offset 156 within the PVD.
    const rootLba = pvd.readUInt32LE(156 + 2);
    const rootSize = pvd.readUInt32LE(156 + 10);

    const descriptors = new Map<string, NodeDescriptor>();
    let counter = 0;
    const nextId = () => `n${counter++}`;

    const root: VirtualNode = {
      id: nextId(),
      name: '/',
      path: '/',
      type: 'directory',
      size: rootSize,
      children: [],
    };

    const readDirectory = (
      parent: VirtualNode,
      lba: number,
      size: number,
      depth: number,
    ): void => {
      if (depth > MAX_DEPTH) return;
      const data = reader.readLogical(lba, size);
      let pos = 0;
      while (pos < data.length) {
        const recLen = data[pos];
        if (recLen === 0) {
          // Records do not cross sector boundaries; jump to the next sector.
          const next = (Math.floor(pos / SECTOR) + 1) * SECTOR;
          if (next <= pos || next >= data.length) break;
          pos = next;
          continue;
        }
        const childLba = data.readUInt32LE(pos + 2);
        const childSize = data.readUInt32LE(pos + 10);
        const flags = data[pos + 25];
        const nameLen = data[pos + 32];
        const rawName = data.subarray(pos + 33, pos + 33 + nameLen).toString('latin1');
        pos += recLen;

        // Skip "." (0x00) and ".." (0x01) self/parent entries.
        if (nameLen === 1 && (rawName.charCodeAt(0) === 0 || rawName.charCodeAt(0) === 1)) {
          continue;
        }
        const isDir = (flags & FLAG_DIRECTORY) !== 0;
        const name = cleanName(rawName);
        const path = parent.path === '/' ? `/${name}` : `${parent.path}/${name}`;
        const node: VirtualNode = {
          id: nextId(),
          name,
          path,
          type: isDir ? 'directory' : 'file',
          size: childSize,
          extension: isDir ? undefined : extension(name),
          offset: reader.logicalToAbsolute(childLba),
        };
        descriptors.set(node.id, { lba: childLba, size: childSize });
        if (isDir) {
          node.children = [];
          readDirectory(node, childLba, childSize, depth + 1);
        }
        parent.children!.push(node);
      }
    };

    readDirectory(root, rootLba, rootSize, 0);
    return { root, descriptors };
  } finally {
    reader.close();
  }
}
