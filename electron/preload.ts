import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels } from '../shared/ipc';
import type {
  OpenRecentRequest,
  ParseAssetRequest,
  ReadNodeRequest,
  RemoveRecentRequest,
  RetroBridge,
} from '../shared/ipc';
import type { ParsedAsset, RecentFile, Result, VirtualNode } from '../shared/types';

// Only these named methods are ever reachable from the renderer. Each is a
// one-way request the main process answers; the renderer cannot reach any other
// ipcRenderer channel or Node capability.
const bridge: RetroBridge = {
  openArchive(): Promise<Result<VirtualNode>> {
    return ipcRenderer.invoke(IpcChannels.mountArchive);
  },
  openRecent(req: OpenRecentRequest): Promise<Result<VirtualNode>> {
    return ipcRenderer.invoke(IpcChannels.openRecent, req);
  },
  closeArchive(): Promise<Result<void>> {
    return ipcRenderer.invoke(IpcChannels.closeArchive);
  },
  readNode(req: ReadNodeRequest): Promise<Result<Uint8Array>> {
    return ipcRenderer.invoke(IpcChannels.readNode, req);
  },
  parseAsset(req: ParseAssetRequest): Promise<Result<ParsedAsset>> {
    return ipcRenderer.invoke(IpcChannels.parseAsset, req);
  },
  recentList(): Promise<Result<RecentFile[]>> {
    return ipcRenderer.invoke(IpcChannels.recentList);
  },
  recentRemove(req: RemoveRecentRequest): Promise<Result<RecentFile[]>> {
    return ipcRenderer.invoke(IpcChannels.recentRemove, req);
  },
  recentClear(): Promise<Result<RecentFile[]>> {
    return ipcRenderer.invoke(IpcChannels.recentClear);
  },
};

contextBridge.exposeInMainWorld('retro', bridge);
