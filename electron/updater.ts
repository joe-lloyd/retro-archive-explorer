import { app, dialog, type BrowserWindow } from 'electron';

/**
 * Wire up GitHub-Releases auto-update. Only runs in packaged builds; failures
 * are swallowed so a missing/unreachable feed never disrupts startup.
 *
 * `electron-updater` is imported dynamically inside the packaged-only guard so
 * it is never loaded (and can never crash) during development.
 */
export async function initAutoUpdate(getWindow: () => BrowserWindow | null): Promise<void> {
  if (!app.isPackaged) return;

  try {
    const electronUpdater = await import('electron-updater');
    const { autoUpdater } = electronUpdater.default;

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('error', () => {
      // Quiet: update problems must not interrupt normal use.
    });

    autoUpdater.on('update-downloaded', async (info) => {
      const win = getWindow();
      if (!win) return;
      const { response } = await dialog.showMessageBox(win, {
        type: 'info',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
        message: `Update ${info.version} is ready`,
        detail: 'Restart Retro Archive Explorer to install the update.',
      });
      if (response === 0) autoUpdater.quitAndInstall();
    });

    await autoUpdater.checkForUpdates();
  } catch {
    // Ignore: offline, no releases yet, or updater unavailable.
  }
}
