// Disc and room-file access shared by the CLI and the verify scripts.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { VirtualNode } from '../shared/types';
import { ImageReader } from '../electron/parsers/imageReader';
import { mountImage } from '../electron/parsers/isoParser';

export interface DiscFile {
  node: VirtualNode;
  lba: number;
  size: number;
}

/** A mounted disc: its files plus one open reader for byte reads. */
export interface Disc {
  files: DiscFile[];
  reader: ImageReader;
}

/** Stop with a message. The top level prints it and sets the exit code. */
export function fail(message: string): never {
  throw new Error(message);
}

export function openDisc(image: string): Disc {
  const { root, descriptors } = mountImage(image);
  const files: DiscFile[] = [];
  const walk = (node: VirtualNode) => {
    const desc = descriptors.get(node.id);
    if (node.type === 'file' && desc) files.push({ node, lba: desc.lba, size: desc.size });
    node.children?.forEach(walk);
  };
  walk(root);
  return { files, reader: new ImageReader(image) };
}

export function readFile(disc: Disc, file: DiscFile): Buffer {
  const bytes = disc.reader.readLogical(file.lba, file.size);
  if (bytes.length !== file.size) {
    throw new Error(`${file.node.path}: image ends after ${bytes.length} of ${file.size} bytes`);
  }
  return bytes;
}

export function findFile(disc: Disc, query: string): DiscFile {
  const q = query.toLowerCase();
  const hit =
    disc.files.find((f) => f.node.path.toLowerCase() === q) ??
    disc.files.find((f) => f.node.path.toLowerCase().endsWith(q));
  if (!hit) fail(`file not found on disc: ${query}`);
  return hit;
}

export interface RoomFile {
  /** Path on the disc, or relative to the directory. */
  name: string;
  bytes: Uint8Array;
}

function* walkDir(dir: string, rel = ''): Generator<string> {
  for (const entry of readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const child = path.join(rel, entry.name);
    if (entry.isDirectory()) yield* walkDir(dir, child);
    else yield child;
  }
}

/** Every `.RDT` in a disc image or a directory tree, or the one file given. */
export function* roomFiles(target: string): Generator<RoomFile> {
  const isRdt = (name: string) => name.toLowerCase().endsWith('.rdt');
  const stat = statSync(target, { throwIfNoEntry: false });
  if (!stat) fail(`no such file or directory: ${target}`);
  if (stat.isDirectory()) {
    for (const rel of walkDir(target)) if (isRdt(rel)) yield { name: rel, bytes: readFileSync(path.join(target, rel)) };
    return;
  }
  if (isRdt(target)) {
    yield { name: path.basename(target), bytes: readFileSync(target) };
    return;
  }
  const disc = openDisc(target);
  try {
    for (const file of disc.files.filter((f) => f.node.extension === 'rdt')) {
      yield { name: file.node.path, bytes: new Uint8Array(readFile(disc, file)) };
    }
  } finally {
    disc.reader.close();
  }
}
