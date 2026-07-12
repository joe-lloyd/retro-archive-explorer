import type { ParsedAsset, VirtualNode } from '../shared/types';
import { ImageReader } from './parsers/imageReader';
import { mountImage, type NodeDescriptor } from './parsers/isoParser';
import { parseTim } from './parsers/timParser';
import { parseModel } from './parsers/tmdParser';
import { parseAudio } from './parsers/audio/psxAudio';
import { interpretRe1, identifiedSummary } from './parsers/re1/registry';

/** How to physically locate a node's bytes. */
type Descriptor =
  | ({ kind: 'disc' } & NodeDescriptor)
  | { kind: 'sub'; parentId: string; offset: number; size: number };

const MODEL_EXT = new Set(['tmd', 'emd', 'ivm', 'dor']);
const AUDIO_EXT = new Set(['vag', 'vab', 'xa', 'vb', 'vh', 'wav', 'snd', 'adp']);

/** Holds the state for one mounted disc image. */
export class MountSession {
  private reader: ImageReader;
  private descriptors = new Map<string, Descriptor>();
  private nodes = new Map<string, VirtualNode>();
  readonly root: VirtualNode;

  constructor(filePath: string) {
    const { root, descriptors } = mountImage(filePath);
    this.root = root;
    this.reader = new ImageReader(filePath);
    for (const [id, d] of descriptors) {
      this.descriptors.set(id, { kind: 'disc', ...d });
    }
    this.index(root);
  }

  private index(node: VirtualNode): void {
    this.nodes.set(node.id, node);
    node.children?.forEach((c) => this.index(c));
  }

  /** Read a node's raw bytes on demand (disc file or container sub-file). */
  readNodeBytes(nodeId: string): Buffer {
    const desc = this.descriptors.get(nodeId);
    if (!desc) throw new Error(`unknown node: ${nodeId}`);
    if (desc.kind === 'disc') {
      return this.reader.readLogical(desc.lba, desc.size);
    }
    const parent = this.readNodeBytes(desc.parentId);
    return parent.subarray(desc.offset, desc.offset + desc.size);
  }

  /** Register container sub-file entries so they can be read/parsed on demand. */
  private registerEntries(parentId: string, node: VirtualNode, entries: VirtualNode[]): void {
    for (const entry of entries) {
      this.descriptors.set(entry.id, {
        kind: 'sub',
        parentId,
        offset: entry.offset ?? 0,
        size: entry.size,
      });
      this.nodes.set(entry.id, entry);
    }
    node.children = entries;
  }

  /** Parse a node into a viewer-ready asset. */
  parseAsset(nodeId: string): ParsedAsset {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`unknown node: ${nodeId}`);
    const ext = node.extension?.toLowerCase();
    const bytes = this.readNodeBytes(nodeId);

    if (ext === 'tim') return parseTim(bytes);
    if (ext && MODEL_EXT.has(ext)) {
      try {
        return parseModel(bytes, ext);
      } catch (err) {
        // Graceful fallback: show identified info + the reason instead of a hard
        // error (notably EMD, whose skeleton container we don't fully assemble yet).
        const info = identifiedSummary(new Uint8Array(bytes), ext);
        return {
          ...info,
          summary: `${info.summary} (could not build geometry: ${err instanceof Error ? err.message : String(err)})`,
        };
      }
    }
    if (ext && AUDIO_EXT.has(ext)) return parseAudio(bytes, ext);

    // RE1 engine formats (RDT/DAT/camera/STF/...): structured or archive.
    const re1 = interpretRe1(ext, node, new Uint8Array(bytes));
    if (re1) {
      if (re1.kind === 'archive') this.registerEntries(nodeId, node, re1.entries);
      return re1;
    }

    // Fallback: raw bytes for the text/hex viewer.
    return { kind: 'text', bytes: new Uint8Array(bytes) };
  }

  dispose(): void {
    this.reader.close();
    this.descriptors.clear();
    this.nodes.clear();
  }
}
