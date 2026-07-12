import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels } from '../shared/ipc';
import type {
  ParseAssetRequest,
  ReadNodeRequest,
  RetroBridge,
} from '../shared/ipc';
import type { ParsedAsset, Result, VirtualNode } from '../shared/types';

// Only these three async methods are ever reachable from the renderer. Each is
// a one-way request the main process answers; the renderer cannot reach any
// other ipcRenderer channel or Node capability.
const bridge: RetroBridge = {
  openArchive(): Promise<Result<VirtualNode>> {
    return ipcRenderer.invoke(IpcChannels.mountArchive);
  },
  readNode(req: ReadNodeRequest): Promise<Result<Uint8Array>> {
    return ipcRenderer.invoke(IpcChannels.readNode, req);
  },
  parseAsset(req: ParseAssetRequest): Promise<Result<ParsedAsset>> {
    return ipcRenderer.invoke(IpcChannels.parseAsset, req);
  },
};

contextBridge.exposeInMainWorld('retro', bridge);
