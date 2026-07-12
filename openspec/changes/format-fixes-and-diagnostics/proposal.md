## Why

The viewer now opens RE1 discs and previews several formats, but a batch of real-world issues remain: navigating the file tree needs the mouse; `.IVM` models render upside-down/rotated; `.EMD` characters render as broken stacked geometry (or fail with "no TMD blocks found"); decoded audio shows a waveform but won't actually play; and `.DOR`, `.HED`, and `.EXE` files aren't interpreted. Fixing the model/audio formats correctly needs to be driven by the *actual bytes* on the user's disc, so this change also adds a headless diagnostics tool that lets us inspect real files and reconstruct the formats from evidence rather than guesswork.

## What Changes

- Add **keyboard navigation** to the file tree: Up/Down move the selection, Left/Right collapse/expand (and step into containers), Enter opens.
- Add a **headless diagnostics analyzer**: a Node CLI that mounts an ISO, locates a file by path, and dumps its magic, size, detected structure, parse attempt, and a hex window to `diagnostics/*.json` — so parser work is evidence-driven.
- **Fix `.IVM`/model orientation**: normalize the up-axis and rotation so IVM items are right-side-up.
- **Reconstruct `.EMD` properly**: parse the real EMD container (directory + skeleton hierarchy) and position each mesh by its bone offset instead of scanning for TMD blocks and stacking them at the origin; eliminates the "no TMD blocks found" failure.
- **Fix audio playback**: make decoded VAG/SPU‑ADPCM produce a WAV the `<audio>` element actually plays (correct duration/headers), so `.VB` samples play, not just visualize.
- **Interpret `.HED`**: read the VAB/sound header so `.HED` shows structured info (and pairs with `.VB` where possible) instead of hex-only.
- **Parse `.DOR` door data** and play the door transition **animation** in a viewer where the data allows.
- **Investigate `.EXE`/FMV**: use the analyzer to determine what these actually are (game binary vs STR/XA video) and report findings; implement a viewer only if warranted.

## Capabilities

### New Capabilities
- `keyboard-navigation`: Arrow-key navigation and expand/collapse in the file tree.
- `diagnostics-tools`: A headless ISO/file analyzer for evidence-driven format work.

### Modified Capabilities
- `asset-parsing`: Correct EMD skeleton reconstruction, model orientation normalization, `.DOR` and `.HED` parsing, and a playable audio fix.
- `format-viewers`: Working audio playback, a door-animation viewer, and structured `.HED` display.

## Impact

- `electron/parsers/`: rewritten/added EMD (skeleton), model orientation, `.DOR`, `.HED`/VAB, audio WAV fix; `re1/registry.ts` routing.
- New `scripts/analyze.mjs` (+ `pnpm analyze`) and a `diagnostics/` output dir (git-ignored).
- `src/components/Sidebar.tsx`: keyboard handlers; new `DoorViewer`; `AudioViewer`/`ModelViewer` tweaks.
- `shared/types.ts`: new asset shapes (door animation, HED info, skeleton-positioned meshes).
- Requires the user's ISO path to run the analyzer against real files.
