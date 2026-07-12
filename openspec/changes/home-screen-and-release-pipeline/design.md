## Context

The app is an Electron/React/TypeScript disc-asset explorer built with Vite + `vite-plugin-electron`, packaged by `electron-builder`, using `pnpm`. It currently opens straight into the explorer via a file dialog and has no persistence, branding, docs, or release automation. This change adds a home screen, recent-files persistence, auto-update, an icon, docs, and a tag-driven CI release — all standard Electron distribution concerns layered onto the existing IPC-bridged architecture.

## Goals / Non-Goals

**Goals:**
- Home screen listing persisted recent files with reopen + open-new actions.
- In-app auto-update from GitHub Releases (packaged builds only).
- One-command version/tag bump and a `v*`-tag-triggered CI that builds macOS/Windows/Linux and publishes a release the updater can consume.
- Modern disk-exploration icon and proper README + illustrated user guide.

**Non-Goals:**
- Code signing / notarization (documented as a follow-up; unsigned artifacts for now).
- Auto-update on unsigned macOS builds (unsupported by the OS; Windows/Linux work unsigned).
- Delta updates, staged rollouts, or a custom update server.

## Decisions

**Recent files persisted in main, exposed via IPC.** A small JSON file in `app.getPath('userData')` holds `RecentFile[]` (path, name, lastOpened). The main process owns it because only main touches disk; the renderer gets `recent:list/remove/clear` plus an `openRecent(path)` channel. Recording happens on any successful mount (dialog or recent). Alternative: `localStorage` in the renderer — rejected because the renderer is sandboxed and shouldn't own persistence or validate file existence.

**Home vs explorer is renderer routing on mount state.** `App` shows `HomeScreen` when no tree is mounted and the explorer when one is; a "home" control calls a new `closeArchive` channel that disposes the main session and clears renderer state. Keeps a single window with no router dependency.

**Auto-update via `electron-updater` + GitHub provider.** `autoUpdater.checkForUpdatesAndNotify()` runs on `whenReady` guarded by `app.isPackaged`; `update-downloaded` prompts a restart. The GitHub provider reads the same releases the CI publishes. Alternative providers (S3, generic) — rejected; GitHub Releases is where CI already publishes and needs no extra secrets for public repos.

**Tag drives version.** `package.json` version is bumped with `pnpm version <x.y.z>` (which also creates the `v<x.y.z>` tag); pushing the tag triggers CI. `electron-builder` stamps artifacts from `package.json`, so tag and build version stay aligned. A short README section documents the flow.

**CI: matrix build, publish on tag.** `.github/workflows/release.yml` triggers on `push` tags `v*`, runs a `macos-latest` / `windows-latest` / `ubuntu-latest` matrix, installs via pnpm, and runs `electron-builder --publish always` with the default `GITHUB_TOKEN`. Linux targets AppImage + deb, Windows NSIS, macOS dmg/zip. Publishing includes `latest*.yml`/`*.blockmap` so the updater can detect releases.

**Icon from one master.** A hand-authored SVG (disk + explorer/scan motif, modern gradient) is rasterized to `build/icon.png` (1024²); `electron-builder` derives macOS `.icns` and, with a small generate step (`png-to-ico`), Windows `.ico`. Linux uses the PNG. Keeps a single source of truth.

**Docs.** `README.md` (purpose, formats, run-from-source, release flow) and `docs/USER_GUIDE.md` (walkthrough with screenshots under `docs/img/`). Screenshots are captured from the running app.

## Risks / Trade-offs

- **Unsigned builds** → macOS Gatekeeper warnings and no macOS auto-update. Mitigation: document the manual-open step; ship signing later via secrets. Windows/Linux auto-update works unsigned.
- **CI without secrets** → only the default `GITHUB_TOKEN`; fine for public releases, insufficient for signing. Documented.
- **Screenshots need a real disc + display** → cannot be produced in headless CI; captured locally during implementation, with placeholders if a disc is unavailable.
- **Recent path points at moved/deleted media** → prune-on-load and remove-on-open-failure keep the list honest.
- **Icon `.icns`/`.ico` generation tooling** → keep to `png-to-ico` + electron-builder's built-in conversion to avoid native image deps.

## Migration Plan

Additive. Initialize git (repo is not yet versioned) and commit the baseline before adding the workflow. First release: `pnpm version 1.0.0` → `git push --follow-tags` → CI publishes. Rollback: delete the tag/release; no runtime migration.

## Open Questions

- Final GitHub `owner/repo` slug for the `electron-builder` `publish` config and updater feed.
- Whether to pursue code signing certificates now or defer.
- Exact Linux target set (AppImage/deb/rpm) to publish.
