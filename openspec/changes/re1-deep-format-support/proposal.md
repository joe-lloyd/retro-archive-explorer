## Why

The initial viewer mounts an RE1 disc and previews generic formats, but the Resident Evil 1 engine files are the point of the tool and they currently read poorly: EMD/TMD models render as scrambled, colorless geometry (the primitive decoder misreads normal indices as vertex indices and never reads embedded color/UV data); PSX audio (VAG/ADPCM/XA) shows as hex because the browser cannot play it; and engine containers (RDT, DAT, camera.bin, STF, …) fall through to a raw hex dump with no indication of what they actually are. Users also want the interpreted preview shown by default, with hex/text always one click away.

## What Changes

- Rewrite the TMD/EMD model decoder to correctly walk PSX primitive packets (color/UV preamble → normals+vertices tail) for flat/gouraud, textured/untextured, tri/quad primitives, producing correct geometry and **per-vertex/per-face colors**.
- Add best-effort **EMD texturing**: locate an embedded/adjacent TIM, emit UVs, and render a real texture in Three.js (fall back to neutral color when the palette cannot be resolved).
- Add a **PSX audio decoder** (VAG/SPU-ADPCM → PCM → WAV) so sounds play in the audio viewer; detect and label formats that are not yet decodable (XA).
- Add an **RE1 format registry** that identifies each engine extension (`.RDT`, `.DAT`, `.EMD`, `.IVM`, `.DOR`, `.PIX`, `.ESP`, `.EMW`, `.STF`, plus `camera.bin`) and produces a structured "what this is" interpretation (named sections, offset tables, record listings, decoded text).
- Restructure the viewer into a **tabbed Preview / Hex / Text** surface with **Preview selected by default**, so every file opens on its best interpretation while hex/text stay available. **BREAKING**: the renderer viewer contract changes (internal only).

## Capabilities

### New Capabilities
- `re1-formats`: Identification and structured interpretation of RE1 engine file types.
- `tabbed-viewer`: A Preview/Hex/Text tabbed viewer shell that defaults to the interpreted preview.

### Modified Capabilities
- `asset-parsing`: Correct TMD/EMD primitive decoding with color/UV/texture; PSX audio decoding to a playable format.
- `format-viewers`: Model viewer renders vertex colors and textures; audio viewer plays decoded PSX audio; new structured viewer for engine formats.

## Impact

- `electron/parsers/`: rewritten `tmdParser`, new `audio/` and `re1/` decoders, extended `timParser`.
- `electron/session.ts`: extension-aware dispatch into the RE1 registry and audio decoder.
- `src/components/`: new tabbed `ViewerContainer`, `StructuredViewer`, split Hex/Text views, updated `ModelViewer`/`AudioViewer`.
- `shared/types.ts`: richer `MeshObject` (colors/uvs/texture), new `StructuredAsset`.
