## 1. Recent files (main + IPC)

- [ ] 1.1 Add a `RecentFile` type and recent-files IPC channels to `shared/types.ts` / `shared/ipc.ts`
- [ ] 1.2 Implement a recent-files store in `electron/` (JSON in `userData`): add, list (prune missing), remove, clear, capped + de-duplicated
- [ ] 1.3 Record a recent entry on every successful mount (dialog and reopen)
- [ ] 1.4 Add `openRecent(path)` and `closeArchive` IPC handlers; expose all recent-files methods on the preload bridge

## 2. Home screen (renderer)

- [ ] 2.1 Add recents hooks to `src/hooks/useIPC.ts` (list/open/remove/clear, open-new, close)
- [ ] 2.2 Implement `src/components/HomeScreen.tsx`: recent-files list (name, path, last-opened) + "Open image" button + per-entry remove and clear-all
- [ ] 2.3 Route `App` between home and explorer on mount state; add a "home" control in the toolbar

## 3. Auto-update

- [ ] 3.1 Add `electron-updater`; wire `checkForUpdatesAndNotify()` on `whenReady` guarded by `app.isPackaged`
- [ ] 3.2 Handle `update-downloaded` with a restart/later prompt; handle errors quietly
- [ ] 3.3 Configure `electron-builder` `publish` (GitHub provider)

## 4. Icon + branding

- [ ] 4.1 Author a modern disk-exploration SVG icon and rasterize to `build/icon.png` (1024²)
- [ ] 4.2 Add an icon-generation step for `.ico` (`png-to-ico`); rely on electron-builder for `.icns`
- [ ] 4.3 Wire the icon into `electron-builder` config and the `BrowserWindow`

## 5. Git + release pipeline

- [ ] 5.1 Initialize git and confirm `.gitignore` excludes `node_modules/`, `dist/`, `dist-electron/`, release output; commit baseline
- [ ] 5.2 Document/enable the `pnpm version` → `v*` tag → push flow keeping `package.json` in sync
- [ ] 5.3 Add `.github/workflows/release.yml`: `v*`-tag trigger, macOS/Windows/Linux matrix, pnpm install, `electron-builder --publish always` with `GITHUB_TOKEN`
- [ ] 5.4 Ensure published releases include updater metadata (`latest*.yml`, blockmaps)

## 6. Documentation

- [ ] 6.1 Write `README.md`: purpose, supported formats, run-from-source, and release process
- [ ] 6.2 Write `docs/USER_GUIDE.md`: open a disc, home/recents, file tree, Preview/Hex/Text viewers
- [ ] 6.3 Capture screenshots into `docs/img/` and embed them (placeholders if no disc available)

## 7. Verification

- [ ] 7.1 Typecheck, lint, and production build pass
- [ ] 7.2 Recent-files store unit-tested (add/dedupe/cap/prune/remove/clear)
- [ ] 7.3 Manual: home screen lists recents and reopens; "home" returns from explorer; workflow validates (dry run / act or lint) and README release steps are accurate
