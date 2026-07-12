## Why

Today the app drops straight into an empty explorer and you must re-open and re-navigate a disc image every session. It also has no identity or distribution story: no icon, no README/user guide, not even a git repo with an ignore file, no way to ship signed cross-platform builds, and no in-app updates. This change makes the app usable day-to-day (a home screen with recent files) and shippable (icon, docs, git hygiene, auto-update, and a tag-triggered CI that builds macOS/Windows/Linux).

## What Changes

- Add a **home screen** shown when no archive is mounted: a list of recently opened files (name, path, last-opened time) that reopen on click, plus an "Open image" button. Selecting or reopening a file enters the explorer; a control returns to home.
- **Persist recent files** in the main process (userData JSON), pruning missing files and capping the list; expose add/list/remove/clear over the IPC bridge.
- Add **Electron auto-update** via `electron-updater`, checking a GitHub Releases feed on launch and notifying the user when an update is downloaded.
- Add a **release pipeline**: initialize git with a correct `.gitignore`, a documented "tag = version" flow that keeps `package.json` version in sync with the git tag, and a **GitHub Actions** workflow that, on pushing a `v*` tag, builds and publishes macOS, Windows, and Linux artifacts with `electron-builder`.
- Add **branding**: a modern "disk exploration" app icon (multi-resolution `.ico`/`.icns`/`.png`) wired into `electron-builder` and the window.
- Add **documentation**: a proper `README.md` and a `docs/USER_GUIDE.md` with screenshots.

## Capabilities

### New Capabilities
- `recent-files`: Track, persist, and present recently opened files, and the home-screen shell that lists them with an open-new-file action.
- `auto-update`: In-app update checking and notification via a GitHub Releases feed.
- `release-pipeline`: Git hygiene, tag/version synchronization, and tag-triggered cross-platform CI builds.
- `branding-and-docs`: Application icon, README, and illustrated user guide.

### Modified Capabilities
<!-- None: main specs are not yet synced; all behavior here is introduced as new capabilities. -->

## Impact

- `electron/`: recent-files store + IPC handlers, updater wiring in `main.ts`, icon in window/build config.
- `shared/ipc.ts`, `shared/types.ts`: new recent-files channels and `RecentFile` type.
- `src/`: new `HomeScreen` component and app routing between home and explorer; `useIPC` recents hooks.
- Repo root: `.gitignore`, `.github/workflows/release.yml`, `build/` icon assets, `electron-builder` publish/icon config, `README.md`, `docs/USER_GUIDE.md`.
- Dependencies: add `electron-updater`; dev tooling for icon generation.
- Requires a GitHub repository and release permissions for publishing; no secrets needed beyond the default `GITHUB_TOKEN` for public releases.
