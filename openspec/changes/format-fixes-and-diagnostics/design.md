## Context

The app parses RE1 assets in the isolated main process and previews them via a tabbed viewer. Several formats are wrong or missing, and — critically — the RE1 container formats (EMD, DOR, HED) are only partially documented, so fixing them reliably requires reading the *actual bytes* on the user's disc. This change adds a headless analyzer to close that evidence loop, then fixes the models, audio, and adds DOR/HED, plus keyboard navigation. The user's ISO is available on disk and I can run tooling against it directly.

## Goals / Non-Goals

**Goals:**
- Evidence-driven format work via a headless analyzer (`pnpm analyze`).
- Keyboard navigation of the file tree.
- Correct model orientation; skeleton-assembled EMD characters; no false "no TMD blocks" errors.
- Audio that actually plays (correct WAV/duration).
- Structured `.HED`; parsed/animated `.DOR`.
- A findings report on `.EXE`/FMV before committing to a viewer.

**Non-Goals:**
- Full skeletal animation playback for EMD characters (static assembled pose is enough here).
- Cycle-accurate STR/XA FMV decoding (investigate first; implement later if warranted).
- Editing/repacking.

## Decisions

**Headless analyzer as the primary loop.** `scripts/analyze.mjs` reuses the existing `ImageReader`/`mountImage` and parsers to: (a) list files by extension, and (b) dump one file's magic, size, detected structure, parser result/error, and a hex window to `diagnostics/<name>.json`. Because I have shell + filesystem access, I run it against the user's ISO, read the JSON, and adjust the parsers — no app round-trip. `diagnostics/` is git-ignored and never packaged. Alternative (in-app export panel) — deferred; slower loop, more surface area.

**EMD reconstruction from container + skeleton.** RE1 EMD is a directory of sections (skeleton/armature, animation, and mesh group), not a bare TMD. The stacking bug is because the current code scans for TMD magic and drops every part at the origin. New approach: read the EMD directory to find the mesh-group and skeleton sections; walk the skeleton hierarchy accumulating each bone's relative offset; place each mesh part at its bone's cumulative translation. Exact offsets/counts come from the analyzer against real EMDs. This also replaces the fragile magic-scan (fixing "no TMD blocks found"). Fallback: if the structure can't be validated, keep a guarded TMD-scan path but report a specific error.

**Orientation normalization at the viewer.** PSX uses Y-down; three.js is Y-up, so models appear inverted. Rather than mutate vertex data per-parser, apply a single corrective rotation (flip Y, and the observed IVM 90° about the appropriate axis) on the model group in `ModelViewer`, keeping parsers pure. If IVM needs a different correction than TMD/EMD, key it off the source extension carried on the asset.

**Audio: fix the WAV, prefer Web Audio playback.** The waveform proves `decodeAudioData` succeeds, yet `<audio>` reports 0s — a malformed/loosely-headed WAV or a blob/duration issue. Fix the WAV header (sizes, byte/block align, streaming-safe `data` length) and, to be robust, drive playback through a small Web Audio player (AudioBufferSourceNode) with a derived duration from sample count, so duration/seek don't depend on the element sniffing the stream.

**HED/VAB header parsing.** `.HED` is the VAB header (program/tone/sample tables). Parse its documented fields into a `StructuredAsset`; where a sibling `.VB` (body) exists, note the pairing. Full instrument synthesis is out of scope; structured info + enabling VB playback is the goal.

**DOR parsing + animation.** `.DOR` bundles door geometry and transition animation. Parse geometry (TMD-like) plus keyframe/transform data; the viewer plays keyframes on a clock with basic controls. Exact layout via the analyzer; static fallback when animation data is absent/unclear.

**Keyboard navigation via a flattened visible list.** The tree computes its visible (expanded) node order; Up/Down move an index, Left/Right collapse/expand or step to parent/child, Enter opens. Selection stays the single source of truth shared with mouse clicks. `roving tabindex` on the focused row for accessibility and scroll-into-view.

## Risks / Trade-offs

- **RE1 EMD/DOR/HED layouts are only partly documented** → the analyzer de-risks this; each parser validates magic/bounds and reports a specific error rather than emitting garbage. Guarded fallbacks retained.
- **Orientation correction may differ per format** → drive it off the asset's source extension; verify IVM vs EMD vs TMD individually against real files.
- **Audio duration from sample count assumes the decoded rate is right** → carry the rate from the VAG/HED header; note assumptions when guessed.
- **.EXE/FMV scope creep** → gated behind an investigation step; no decoder until the analyzer confirms what the files are.
- **Analyzer drift from app parsers** → it imports the same parser modules, so they can't diverge.

## Open Questions

- The user's ISO path (needed to run the analyzer).
- Exact EMD section-directory layout and skeleton record size for this specific RE1 release (resolve via analyzer).
- Whether `.EXE` entries are the game binary or renamed FMV containers (resolve via analyzer before deciding on a movie viewer).
- Whether `.HED` pairs 1:1 with `.VB` by name/location in this disc layout.
