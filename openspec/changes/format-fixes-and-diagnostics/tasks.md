## 1. Diagnostics analyzer (build first)

- [x] 1.1 Add `scripts/analyze.mjs` (+ `pnpm analyze`) that mounts an ISO via the existing reader/parsers
- [x] 1.2 List mode: enumerate files by extension with paths + sizes
- [x] 1.3 Analyze mode: dump magic, size, detected format, parser result/error, and a hex window to `diagnostics/<name>.json`
- [x] 1.4 Git-ignore `diagnostics/` and keep tooling out of packaged builds
- [x] 1.5 Run the analyzer against the user's ISO for sample EMD/IVM/DOR/HED/VB/EXE files and record findings (EMD in /PSXUSA/ENEMY, HED+VB pairs in /PSXUSA/SOUND, movies are .STR in /PSXUSA/ZMOVIE, .EXE are code overlays)

## 2. Keyboard navigation

- [ ] 2.1 Compute the tree's visible-node order and give the tree a focusable, roving-tabindex row model
- [ ] 2.2 Up/Down move selection (scroll into view); Left/Right collapse/expand or step to parent/child; Enter opens
- [ ] 2.3 Keep keyboard and mouse selection unified (single selected-node source of truth)

## 3. Model orientation

- [ ] 3.1 Apply an up-axis (Y-down→Y-up) correction on the model group in `ModelViewer`
- [ ] 3.2 Add the IVM-specific rotation fix, keyed off the asset's source extension; verify IVM/EMD/TMD upright against real files

## 4. EMD reconstruction (evidence-driven)

- [ ] 4.1 From diagnostics, map the EMD section directory (skeleton + mesh-group offsets)
- [ ] 4.2 Parse the skeleton hierarchy and accumulate per-bone offsets
- [ ] 4.3 Position each mesh part at its bone offset; retain colors/texture; assemble the character
- [ ] 4.4 Replace the TMD-magic scan; emit a specific error when structure is invalid (no more generic "no TMD blocks found")
- [ ] 4.5 Re-run the analyzer/app on several EMDs to confirm correct assembly

## 5. Audio playback fix

- [ ] 5.1 Correct the WAV header (chunk sizes, byte/block align, data length) from the decoded PCM + rate
- [ ] 5.2 Play via a Web Audio player with duration derived from sample count; wire transport/seek to the waveform
- [ ] 5.3 Verify `.VB`/VAG samples play with a non-zero duration

## 6. HED sound headers

- [ ] 6.1 Parse `.HED` (VAB header) fields into a `StructuredAsset`; note any paired `.VB`
- [ ] 6.2 Route `.HED` through the registry to the structured viewer

## 7. DOR door animations

- [ ] 7.1 Parse `.DOR` geometry and animation/keyframe data (layout confirmed via analyzer)
- [ ] 7.2 Add a `DoorViewer` that plays the transition animation with basic controls; static fallback when no animation
- [ ] 7.3 Route `.DOR` through the registry to the door viewer

## 8. EXE / FMV investigation

- [ ] 8.1 Use the analyzer to determine what `.EXE`/FMV files are (game binary vs STR/XA video)
- [ ] 8.2 Report findings and recommend whether to add a movie viewer (implement only if warranted)

## 9. Verification

- [ ] 9.1 Typecheck, lint, and production build pass
- [ ] 9.2 Parser unit tests updated/added (EMD assembly, WAV header, HED) pass
- [ ] 9.3 Manual: arrow-key nav works; IVM upright; EMD assembled; audio plays; HED structured; DOR animates
