import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type {
  DisassembleRequest,
  OpenRecentRequest,
  ParseAssetRequest,
  ReadNodeRequest,
  RemoveRecentRequest,
} from '../shared/ipc';
import { IpcChannels } from '../shared/ipc';
import { disassembleExe } from './parsers/exe/mipsDisasm';
import type { ParsedAsset, RecentFile, Result, VirtualNode } from '../shared/types';
import { MountSession } from './session';
import { RecentFilesStore } from './recentFiles';
import { initAutoUpdate } from './updater';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// electron-vite layout: this file is out/main/, siblings are out/preload/ and
// out/renderer/; the icon lives at the repo/app root under build/.
const ICON_PATH = path.join(__dirname, '../../build/icon.png');

// One mounted image at a time.
let session: MountSession | null = null;
let win: BrowserWindow | null = null;
let recents: RecentFilesStore | null = null;

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#1e1e1e',
    // macOS uses the bundle icon; Windows/Linux take a window icon when present.
    ...(process.platform !== 'darwin' && existsSync(ICON_PATH) ? { icon: ICON_PATH } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.cjs'),
      // Hard isolation: untrusted binary parsing never runs with Node powers.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // electron-vite serves the renderer over HTTP in dev; loads the built file otherwise.
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

/** Run a handler and convert any throw into a serializable error Result. */
async function guard<T>(fn: () => T | Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Mount a file, replacing any current session, and record it in recents. */
function mountFile(filePath: string): VirtualNode {
  session?.dispose();
  session = new MountSession(filePath);
  recents?.add(filePath);
  return session.root;
}

function registerIpc(): void {
  ipcMain.handle(IpcChannels.mountArchive, async (): Promise<Result<VirtualNode>> =>
    guard(async () => {
      const picked = await dialog.showOpenDialog(win!, {
        title: 'Open disc image',
        properties: ['openFile'],
        filters: [
          { name: 'Disc images', extensions: ['iso', 'bin', 'img'] },
          { name: 'All files', extensions: ['*'] },
        ],
      });
      if (picked.canceled || picked.filePaths.length === 0) {
        throw new Error('no file selected');
      }
      return mountFile(picked.filePaths[0]);
    }),
  );

  ipcMain.handle(
    IpcChannels.openRecent,
    async (_e, req: OpenRecentRequest): Promise<Result<VirtualNode>> =>
      guard(() => {
        if (typeof req?.filePath !== 'string') throw new Error('invalid path');
        if (!existsSync(req.filePath)) {
          recents?.remove(req.filePath);
          throw new Error('file no longer exists');
        }
        return mountFile(req.filePath);
      }),
  );

  ipcMain.handle(IpcChannels.closeArchive, async (): Promise<Result<void>> =>
    guard(() => {
      session?.dispose();
      session = null;
    }),
  );

  ipcMain.handle(
    IpcChannels.readNode,
    async (_e, req: ReadNodeRequest): Promise<Result<Uint8Array>> =>
      guard(() => {
        if (!session) throw new Error('no archive mounted');
        // Validate input as pure data: it only selects a known node id.
        if (typeof req?.nodeId !== 'string') throw new Error('invalid nodeId');
        return new Uint8Array(session.readNodeBytes(req.nodeId));
      }),
  );

  ipcMain.handle(
    IpcChannels.parseAsset,
    async (_e, req: ParseAssetRequest): Promise<Result<ParsedAsset>> =>
      guard(() => {
        if (!session) throw new Error('no archive mounted');
        if (typeof req?.nodeId !== 'string') throw new Error('invalid nodeId');
        return session.parseAsset(req.nodeId);
      }),
  );

  ipcMain.handle(
    IpcChannels.disassemble,
    async (_e, req: DisassembleRequest): Promise<Result<string>> =>
      guard(() => {
        if (!session) throw new Error('no archive mounted');
        if (typeof req?.nodeId !== 'string') throw new Error('invalid nodeId');
        return disassembleExe(session.readNodeBytes(req.nodeId));
      }),
  );

  ipcMain.handle(IpcChannels.recentList, async (): Promise<Result<RecentFile[]>> =>
    guard(() => recents!.list()),
  );

  ipcMain.handle(
    IpcChannels.recentRemove,
    async (_e, req: RemoveRecentRequest): Promise<Result<RecentFile[]>> =>
      guard(() => {
        if (typeof req?.filePath !== 'string') throw new Error('invalid path');
        return recents!.remove(req.filePath);
      }),
  );

  ipcMain.handle(IpcChannels.recentClear, async (): Promise<Result<RecentFile[]>> =>
    guard(() => recents!.clear()),
  );
}

app.whenReady().then(() => {
  recents = new RecentFilesStore();
  registerIpc();
  createWindow();
  initAutoUpdate(() => win);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  session?.dispose();
  session = null;
  if (process.platform !== 'darwin') app.quit();
});
