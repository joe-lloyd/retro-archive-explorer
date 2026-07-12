## Context

Retro-engine game discs pack proprietary asset formats behind an ISO-9660 or raw-sector filesystem, sometimes with a second layer of `.RDT`/`.DAT` sub-containers. There is no single tool to browse and preview these safely. The application is greenfield: Electron for a cross-platform desktop shell, React for the renderer, TypeScript throughout, `pnpm` as the package manager, Vite for the renderer dev/build pipeline, and `electron-builder` for packaging. Because the input is untrusted third-party binary data, security isolation is a first-class constraint rather than an afterthought.

## Goals / Non-Goals

**Goals:**

- Mount large disc images and browse their contents lazily, keeping memory bounded.
- Decode the core formats (`.TIM`, `.TMD`/`.EMD`, `.RDT`) into sanitized, serializable structures.
- Render each asset type in a context-aware workspace (texture canvas, Three.js viewport, audio, text/hex, archive list).
- Guarantee that binary parsing runs in the main process and never with Node privileges in the renderer.

**Non-Goals:**

- Editing, re-packing, or writing back to disc images (read-only for this change).
- Exhaustive coverage of every retro format — scope is the formats named in the proposal.
- Emulation or execution of any game code.
- Network features, cloud sync, or telemetry.

## Decisions

**Two-process split with parsing in main.** All binary parsers live in `electron/parsers/` and run in the Node main process. Rationale: parsing untrusted binaries is the highest-risk operation; keeping it out of the renderer means a parser bug cannot combine with renderer privileges. Alternative considered: parsing in the renderer via `fs` — rejected because it forces `nodeIntegration` and widens the attack surface.

**Context-isolated preload bridge.** `preload.ts` uses `contextBridge.exposeInMainWorld` to expose a small, explicitly typed API (e.g. `mountArchive(path)`, `readNode(nodeId)`, `parseAsset(nodeId)`). Rationale: a narrow, named surface is auditable and prevents the renderer from reaching arbitrary `ipcRenderer` channels. Alternative: exposing `ipcRenderer` directly — rejected as too broad.

**Lazy virtual tree.** `isoParser` reads only directory records up front and records each file's `offset`/`size`; byte ranges are read on demand when a node is requested. Rationale: satisfies the memory-bounded requirement for multi-hundred-megabyte images. Alternative: full extraction to a temp dir — rejected for disk/memory cost and cleanup complexity.

**Typed IPC via a shared contract + `useIPC` hook.** A shared TypeScript type module defines request/response shapes; the renderer consumes them through a `useIPC` hook. Rationale: compile-time safety across the process boundary and a single place to model loading/error states.

**Serializable parser output only.** Parsers emit plain objects and typed arrays (`Float32Array`, `Uint8ClampedArray`). Rationale: these structured-clone cleanly across IPC and carry no live handles; viewers consume them directly (canvas `ImageData`, Three.js `BufferGeometry`).

**Three.js for 3D, raw Canvas 2D for textures.** Models need a WebGL scene with camera controls; textures are a straight pixel blit and don't warrant a 3D engine. Rationale: right-sized tools per viewer.

## Risks / Trade-offs

- **Malformed/hostile binaries crash a parser** → Wrap each parser in bounds-checked reads and try/catch; surface a parse error to the UI instead of throwing across IPC. Parsing stays in main, so a crash there does not expose renderer privileges.
- **Large images degrade responsiveness** → Lazy reads plus offloading parse work to async main-process handlers; renderer shows loading state and stays interactive.
- **Format assumptions may be incomplete** (variants of `.TIM`/`.TMD` exist) → Validate magic signatures and known fields; fail gracefully to the hex viewer for unrecognized data.
- **WebGL resource leaks in the model viewer** → Explicitly dispose geometries, materials, and the renderer on unmount.
- **Dependency version drift** (Electron/Three/Vite move fast) → Pin ranges in `package.json` and rely on `pnpm-lock.yaml` for reproducible installs.

## Migration Plan

Greenfield; no data migration. Rollout is standard packaging: Vite builds the renderer, `electron-builder` produces installers. Rollback is simply not shipping the build — no persistent state or external system is affected.

## Open Questions

- Which specific audio formats (e.g. `.VAB`/`.XA`/`ADPCM`) are in scope for the first audio viewer implementation?
- Should the archive/model viewers support exporting decoded assets (PNG/OBJ) in a later change?
- Is `.IVM` model support required in this change or deferred (proposal lists it under core libraries but not as a named parser)?
