## Context

RE1 assets are decoded in the isolated main process and previewed via a tabbed viewer; a headless analyzer (`pnpm analyze`) reads the user's disc for evidence, and reevengi is the format reference. `.STF` currently routes through `interpretStf` in `re1/registry.ts`, which only keeps printable-ASCII bytes — so custom-encoded text is garbled. This change replaces that with a real structural + character-map decode.

## Goals / Non-Goals

**Goals:**
- Decode `.STF` via its offset table + payload.
- Map bytes through a checked-in RE1 character set to correct text.
- Show decoded text in the existing structured viewer.

**Non-Goals:**
- A general font-rendering system or glyph images.
- Editing/re-encoding STF.
- Perfect coverage of every rare control code — unknown bytes degrade gracefully.
- A new UI toggle: the existing Preview/Hex/Text tabs already cover raw-vs-decoded.

## Decisions

**Evidence-driven layout, not a fixed spec.** Rather than hardcode assumptions (e.g. "u32 at 0x00 is the count"), confirm the STF framing by dumping real files with the analyzer and checking against reevengi. The likely shape is a leading string count/offset table followed by the string payload; the decoder reads offsets, then bytes until a terminator. Exact field sizes/terminator are fixed once during implementation from the evidence and encoded as named constants.

**Character map derived once, checked in.** RE1 uses a custom byte→glyph mapping. Derive it from the game's font/charset (via the analyzer and reference material) and store it as a small checked-in module (`re1/stfCharset.ts` or a JSON imported by it). This keeps the app self-contained (no external file at runtime) and versioned. Alternative — mandating a Ghidra dump into an external JSON — rejected as a hard prerequisite: we prefer an in-repo map produced however is most reliable, verified against real strings (e.g. the known staff-roll credits).

**Decode in main, reuse StructuredAsset.** The decoder lives in `re1/stf.ts` and returns the existing `StructuredAsset` with its `text` field populated (and optionally per-string sections). `registry.ts` routes `.STF` to it. No new asset kind or IPC change; the renderer already renders structured text and offers Hex/Text tabs.

**Graceful degradation.** Unknown bytes map to a placeholder; a file that doesn't match the expected structure returns a descriptive summary plus raw bytes rather than throwing, consistent with the other RE1 parsers.

## Risks / Trade-offs

- **Character map completeness** → verify decoded output against a known string (the staff roll); fill gaps iteratively; placeholder unknown bytes so partial maps still read.
- **STF structural variance across files** → validate offsets in-bounds; fall back to the raw view on mismatch.
- **Deriving the map is the hard part** → use the analyzer + reference; if a full font-table dump isn't feasible, seed the map from observed strings and refine.

## Open Questions

- Exact STF header/offset-table layout and string terminator for this RE1 release (resolve via analyzer).
- The precise source of the character table (font file vs executable table) and how much is needed beyond ASCII-range glyphs.
