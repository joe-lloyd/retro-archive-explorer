import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type {
  ParseAssetRequest,
  ReadNodeRequest,
} from '../shared/ipc';
import { IpcChannels } from '../shared/ipc';
import type { ParsedAsset, Result, VirtualNode } from '../shared/types';
import { MountSession } from './session';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// One mounted image at a time.
let session: MountSession | null = null;
let win: BrowserWindow | null = null;

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      // Hard isolation: untrusted binary parsing never runs with Node powers.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
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
      session?.dispose();
      session = new MountSession(picked.filePaths[0]);
      return session.root;
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
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  session?.dispose();
  session = null;
  if (process.platform !== 'darwin') app.quit();
});
