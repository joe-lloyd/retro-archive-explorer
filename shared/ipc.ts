// The IPC contract: the single source of truth for channel names and the
// request/response shapes that flow across the context-isolated bridge.

import type { ParsedAsset, Result, VirtualNode } from './types';

/** Named channels. The preload bridge exposes only these; nothing else is reachable. */
export const IpcChannels = {
  mountArchive: 'archive:mount',
  readNode: 'node:read',
  parseAsset: 'asset:parse',
} as const;

export interface MountArchiveRequest {
  /** Absolute path to the disc image chosen via a native dialog. */
  filePath: string;
}

export interface ReadNodeRequest {
  nodeId: string;
}

export interface ParseAssetRequest {
  nodeId: string;
}

/** The typed API surface exposed on `window.retro` in the renderer. */
export interface RetroBridge {
  /** Prompt for a disc image and mount it, returning the virtual tree root. */
  openArchive(): Promise<Result<VirtualNode>>;
  /** Read a node's raw bytes (used by the hex/text fallback). */
  readNode(req: ReadNodeRequest): Promise<Result<Uint8Array>>;
  /** Parse a node into a viewer-ready asset. */
  parseAsset(req: ParseAssetRequest): Promise<Result<ParsedAsset>>;
}

declare global {
  interface Window {
    retro: RetroBridge;
  }
}
