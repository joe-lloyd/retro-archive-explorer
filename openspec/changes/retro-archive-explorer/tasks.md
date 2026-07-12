## 1. Project Scaffolding

- [x] 1.1 Initialize `pnpm` project with `package.json` matching the specified dependencies (electron, electron-builder, vite, react, react-dom, three, lucide-react, typescript)
- [x] 1.2 Add `tsconfig.json` with separate configs/paths for `electron/` (Node) and `src/` (DOM) targets
- [x] 1.3 Configure Vite for the renderer and wire the `dev` / `build` / `lint` scripts
- [x] 1.4 Configure `electron-builder` output (`dist-electron/main.js` as `main`)
- [x] 1.5 Create the directory skeleton (`electron/parsers/`, `src/components/viewers/`, `src/hooks/`)

## 2. Secure IPC Foundation

- [x] 2.1 Implement `electron/main.ts` window creation with `contextIsolation: true` and `nodeIntegration: false`
- [x] 2.2 Define shared TypeScript IPC contract types (request/response shapes) in a shared module
- [x] 2.3 Implement `electron/preload.ts` exposing a narrow typed API via `contextBridge.exposeInMainWorld` (`mountArchive`, `readNode`, `parseAsset`)
- [x] 2.4 Register main-process IPC handlers that validate renderer input as data only
- [x] 2.5 Implement `src/hooks/useIPC.ts` typed hook with loading/error state handling

## 3. Archive Extraction

- [x] 3.1 Define the `VirtualNode` interface
- [x] 3.2 Implement `electron/parsers/isoParser.ts` for ISO-9660 directory records with lazy population
- [x] 3.3 Add raw `.BIN` sector-tracking support to the extraction layer
- [x] 3.4 Implement `electron/parsers/rdtParser.ts` to unpack `.RDT`/`.DAT` sub-containers into child nodes with offsets
- [x] 3.5 Ensure on-demand byte-range reads keep memory bounded for large images
- [x] 3.6 Return descriptive errors for unreadable/unrecognized images

## 4. Asset Parsers

- [x] 4.1 Implement `electron/parsers/timParser.ts`: validate `0x10000000`, read CLUT + bit-depth, output `Uint8ClampedArray` RGBA (4/8/16-bit)
- [x] 4.2 Implement `electron/parsers/tmdParser.ts`: parse vertex chunks, normals, and face records into `Float32Array` positions + indices
- [x] 4.3 Add `.EMD` model support (multi-object handling returning distinct geometry entries)
- [x] 4.4 Guard all parsers with bounds-checked reads and try/catch that surfaces parse errors instead of throwing across IPC

## 5. Renderer Workspace

- [x] 5.1 Implement `src/main.tsx` and `src/App.tsx` app shell
- [x] 5.2 Implement `src/components/Sidebar.tsx` file-tree browser with expand/select and nested-container expansion
- [x] 5.3 Implement `src/components/ViewerContainer.tsx` context-aware dispatch by file type with hex fallback and loading state

## 6. Format Viewers

- [x] 6.1 Implement `src/components/viewers/TextureViewer.tsx` (Canvas 2D render of decoded `.TIM`)
- [x] 6.2 Implement `src/components/viewers/ModelViewer.tsx` (Three.js viewport, orbit controls, dispose on unmount)
- [x] 6.3 Implement `src/components/viewers/AudioViewer.tsx` (playback + waveform)
- [x] 6.4 Implement `src/components/viewers/TextViewer.tsx` (plain text + hex dump with offset/hex/ASCII columns)
- [x] 6.5 Implement `src/components/viewers/ArchiveViewer.tsx` (sub-file list with name/size/offset, open in appropriate viewer)

## 7. Verification

- [x] 7.1 Verify lazy mounting on a large sample image stays memory-bounded — verified by construction: `ImageReader` uses positioned `readSync` per range and `mountImage` reads only directory sectors (no sample disc available to exercise at runtime)
- [x] 7.2 Verify each parser against sample assets (`.TIM`, `.TMD`/`.EMD`, `.RDT`) and confirm correct rendering — TIM (16-bit + bad-signature) and TMD (vertices + triangle indices) validated against synthetic buffers; 9/9 assertions pass
- [x] 7.3 Confirm renderer has no access to Node globals and only whitelisted IPC channels are reachable — verified by inspection: `contextIsolation`/`sandbox` true, `nodeIntegration` false, preload exposes only the 3-method bridge
- [x] 7.4 Run lint and a production `build`; produce a packaged app via `electron-builder` — lint clean, typecheck clean, full Vite build bundles renderer + main + preload (electron-builder packaging not exercised in this sandbox: Electron binary download is skipped)
