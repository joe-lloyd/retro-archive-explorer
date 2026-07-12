## 1. Shared types

- [x] 1.1 Extend `MeshObject` (non-indexed positions, optional `colors`/`uvs`), add optional model `texture`, and add `StructuredAsset` + registry types to `shared/types.ts`

## 2. Model decoder (correct + colored + textured)

- [x] 2.1 Rewrite `tmdParser` primitive decoding with mode/flag-driven, self-consistency layout selection extracting correct vertices
- [x] 2.2 Extract flat/gouraud per-vertex colors and emit expanded (non-indexed) geometry
- [x] 2.3 Extract UVs + CLUT/TPage for textured primitives
- [x] 2.4 EMD: locate embedded TIM, decode to RGBA, attach texture + UVs; gray fallback when absent
- [x] 2.5 Unit-test the decoder against synthetic flat, gouraud, and textured packets

## 3. PSX audio decoder

- [x] 3.1 Implement VAG/SPU-ADPCM → PCM16 decoder in `electron/parsers/audio/`
- [x] 3.2 Wrap PCM as WAV; return playable `AudioAsset`; detect + report XA/undecodable codecs
- [x] 3.3 Unit-test ADPCM decode against a synthetic VAG block

## 4. RE1 format registry

- [x] 4.1 Add `electron/parsers/re1/formats.ts` mapping extensions to name/description/decoder
- [x] 4.2 RDT/DAT: structured named-section interpretation (offset table with labels)
- [x] 4.3 `camera.bin` / RDT camera: record interpretation
- [x] 4.4 `.STF`: text decode; identified-summary fallback for other RE1 types

## 5. Session dispatch

- [x] 5.1 Route `parseAsset` by extension into model/audio/RE1-registry/texture/structured, with structured identification fallback

## 6. Tabbed viewer + viewers

- [x] 6.1 Restructure `ViewerContainer` into Preview/Hex/Text tabs, Preview default, lazy hex/text via `readNode`
- [x] 6.2 Split raw view into Hex and Text; keep both always available
- [x] 6.3 Update `ModelViewer` to render vertex colors and textures (dispose textures on unmount)
- [x] 6.4 Update `AudioViewer` for decoded WAV; add `StructuredViewer` for RE1 interpretations

## 7. Verification

- [x] 7.1 Typecheck, lint, and production build all pass
- [x] 7.2 Parser unit tests (model + audio) pass
- [x] 7.3 Manual: models render colored/correct, audio plays, RE1 files show structured previews, Preview is default
