## Why

Legacy retro-engine game discs (ISO/BIN images) bundle proprietary asset formats — `.TIM` textures, `.TMD`/`.EMD` models, `.RDT` room archives — that no mainstream tool can browse or preview. Modders, preservationists, and researchers currently need a patchwork of one-off CLI extractors and hex editors. This change delivers a single cross-platform desktop application that safely mounts these archives and renders their assets in-place.

## What Changes

- Introduce a new Electron + React + TypeScript desktop application (`retro-viewer`) managed with `pnpm`.
- Add a hardened main-process layer that opens a disc image, walks its filesystem, and exposes a read-only virtual file tree without loading the full multi-hundred-megabyte archive into memory.
- Add binary parsers for the core formats: ISO-9660 / raw `.BIN` sectors, `.TIM` textures (CLUT + 4/8/16-bit), `.TMD`/`.EMD` meshes, and `.RDT` nested sub-container unpacking.
- Add a renderer workspace: a file-tree sidebar plus a context-aware viewer container that dispatches to texture, 3D model, audio, text/hex, and archive viewers based on file type.
- Add a typed, one-way IPC bridge (`contextIsolation: true`, `nodeIntegration: false`) so untrusted binary parsing never runs with Node privileges in the renderer.
- **BREAKING**: N/A — greenfield application, no existing behavior is removed.

## Capabilities

### New Capabilities
- `archive-extraction`: Mount a disc image (ISO/BIN) or nested container (RDT/DAT) and produce a lazily-populated virtual file tree with per-node offset/size metadata.
- `asset-parsing`: Main-process binary decoders that turn raw buffers into sanitized, serializable structures (texture pixel data, mesh geometry, unpacked sub-files).
- `secure-ipc`: Context-isolated preload bridge exposing explicit, typed, async request/response channels between renderer and main.
- `asset-workspace`: Renderer UI — sidebar file browser plus a context-aware viewer container that selects the correct viewer per file type.
- `format-viewers`: The individual viewers (texture canvas, Three.js model viewport, audio waveform/playback, text/hex, nested archive list).

### Modified Capabilities
<!-- None — greenfield application. -->

## Impact

- **New codebase**: `electron/` (main, preload, parsers) and `src/` (React renderer, components, hooks).
- **Dependencies**: `electron`, `electron-builder`, `vite`, `react`/`react-dom`, `three`, `lucide-react`, `typescript`; package manager `pnpm`.
- **Security surface**: parses untrusted third-party binaries — mitigated by strict process isolation and a narrow IPC contract.
- **Build/distribution**: Vite dev server for the renderer; `electron-builder` for packaged installers.
