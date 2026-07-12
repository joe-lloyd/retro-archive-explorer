// The IPC contract: the single source of truth for channel names and the
// request/response shapes that flow across the context-isolated bridge.

import type { ParsedAsset, RecentFile, Result, VirtualNode } from './types';

/** Named channels. The preload bridge exposes only these; nothing else is reachable. */
export const IpcChannels = {
  mountArchive: 'archive:mount',
  openRecent: 'archive:open-recent',
  closeArchive: 'archive:close',
  readNode: 'node:read',
  parseAsset: 'asset:parse',
  recentList: 'recent:list',
  recentRemove: 'recent:remove',
  recentClear: 'recent:clear',
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

export interface OpenRecentRequest {
  filePath: string;
}

export interface RemoveRecentRequest {
  filePath: string;
}

/** The typed API surface exposed on `window.retro` in the renderer. */
export interface RetroBridge {
  /** Prompt for a disc image and mount it, returning the virtual tree root. */
  openArchive(): Promise<Result<VirtualNode>>;
  /** Mount a previously opened file by path (no dialog). */
  openRecent(req: OpenRecentRequest): Promise<Result<VirtualNode>>;
  /** Dispose the mounted archive and return to the home screen. */
  closeArchive(): Promise<Result<void>>;
  /** Read a node's raw bytes (used by the hex/text fallback). */
  readNode(req: ReadNodeRequest): Promise<Result<Uint8Array>>;
  /** Parse a node into a viewer-ready asset. */
  parseAsset(req: ParseAssetRequest): Promise<Result<ParsedAsset>>;
  /** List persisted recent files (missing files pruned). */
  recentList(): Promise<Result<RecentFile[]>>;
  /** Remove a single recent entry by path. */
  recentRemove(req: RemoveRecentRequest): Promise<Result<RecentFile[]>>;
  /** Clear the entire recent-files list. */
  recentClear(): Promise<Result<RecentFile[]>>;
}

declare global {
  interface Window {
    retro: RetroBridge;
  }
}
