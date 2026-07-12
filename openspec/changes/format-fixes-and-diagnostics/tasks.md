## 1. Diagnostics analyzer (build first)

- [x] 1.1 Add `scripts/analyze.mjs` (+ `pnpm analyze`) that mounts an ISO via the existing reader/parsers
- [x] 1.2 List mode: enumerate files by extension with paths + sizes
- [x] 1.3 Analyze mode: dump magic, size, detected format, parser result/error, and a hex window to `diagnostics/<name>.json`
- [x] 1.4 Git-ignore `diagnostics/` and keep tooling out of packaged builds
- [x] 1.5 Run the analyzer against the user's ISO for sample EMD/IVM/DOR/HED/VB/EXE files and record findings (EMD in /PSXUSA/ENEMY, HED+VB pairs in /PSXUSA/SOUND, movies are .STR in /PSXUSA/ZMOVIE, .EXE are code overlays)

## 2. Keyboard navigation

- [x] 2.1 Compute the tree's visible-node order and give the tree a focusable, roving-tabindex row model
- [x] 2.2 Up/Down move selection (scroll into view); Left/Right collapse/expand or step to parent/child; Enter opens
- [x] 2.3 Keep keyboard and mouse selection unified (single selected-node source of truth)

## 3. Model orientation

- [x] 3.1 Apply an up-axis (Y-down→Y-up) correction on the model group in `ModelViewer` (scoped to IVM to avoid regressing TMD/EMD)
- [x] 3.2 Add the IVM-specific rotation fix, keyed off the asset's source extension (exact angles to confirm visually)

## 4. EMD reconstruction (evidence-driven) — SOLVED via container directory

- [x] 4.1 Mapped the EMD directory: 4 LE offsets at `filesize-16` → [skeleton, animation, mesh, texture] (source: pmandin/reevengi-tools wiki)
- [x] 4.2 Skeleton hierarchy decoded (armature = humanoid child tree) — but NOT needed for rest pose: mesh vertices are pre-positioned in world space
- [x] 4.3 Mesh located precisely at offset[2] (TMD `0x41` for chars, id-less `[length,unknown,nobj]` for enemies); texture at offset[3]; parts assemble with distinct symmetric centroids
- [x] 4.4 Replaced the false-positive TMD scan with directory parsing (no more "no TMD blocks"); graceful fallback retained
- [x] 4.5 Verified on CHAR10 (16 parts), EM1000 (15 parts, previously failed), EM100E (1 part) — all parse + textured (in-app visual confirmation pending)

## 5. Audio playback fix

- [x] 5.1 Correct the WAV header (chunk sizes, byte/block align, data length) from the decoded PCM + rate
- [x] 5.2 Play via a Web Audio player with duration derived from the decoded buffer; transport + click-to-seek on the waveform
- [x] 5.3 Verify `.VB`/VAG samples play with a non-zero duration (in-app confirmation pending)

## 6. HED sound headers

- [x] 6.1 Parse `.HED` fields into a `StructuredAsset`; note the paired `.VB`
- [x] 6.2 Route `.HED` through the registry to the structured viewer

## 7. DOR door animations

- [x] 7.1 Parse `.DOR` geometry (renders: 12 objects / 697 tris, textured); animation/keyframe data not yet decoded
- [ ] 7.2 Add a `DoorViewer` that plays the transition animation (currently renders statically in the model viewer)
- [x] 7.3 Route `.DOR` to the model viewer

## 7b. HSB sound files (added)

- [ ] 7b.1 Analyze `.HSB` sound files and determine their format/relationship to HED/VB
- [ ] 7b.2 Interpret/play `.HSB` (structured info at minimum, playback if feasible)

## 8. EXE / FMV investigation

- [x] 8.1 Determined via analyzer: `.EXE` are "PS-X EXE" code overlays; the FMVs are `.STR` (MDEC/XA) in /PSXUSA/ZMOVIE
- [x] 8.2 Reported: identify EXE/STR in the registry; an MDEC STR video decoder is a separate future change

## 9. Verification

- [x] 9.1 Typecheck, lint, and production build pass
- [ ] 9.2 Parser unit tests updated/added (EMD assembly, WAV header, HED) — deferred with EMD
- [ ] 9.3 Manual: arrow-key nav works; IVM upright; EMD assembled; audio plays; HED structured; DOR animates
