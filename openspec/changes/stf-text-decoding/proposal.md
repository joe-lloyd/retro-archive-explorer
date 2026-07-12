## Why

`.STF` files hold RE1's text (staff roll, messages), but the current viewer only shows the printable-ASCII bytes via `interpretStf`, so anything using the game's custom character encoding comes out garbled. Decoding STF properly means reading its actual structure (string offset table + payload) and mapping its bytes through RE1's character set, so the text reads correctly in the viewer.

## What Changes

- Reverse-engineer the `.STF` layout (string count/offset table + payload framing) using the diagnostics analyzer against the user's disc, cross-referenced with the reevengi format reference — same evidence-driven approach used for EMD/DOR.
- Establish the RE1 character map (byte → character). Source it from the game's font/charset (derived via analysis) and store it as a checked-in map in the repo; no external/user-supplied file required at runtime.
- Replace the printable-ASCII `interpretStf` with a real decoder in the main-process parser layer that walks the offset table and decodes each string through the character map into proper text.
- Surface the decoded strings in the existing structured viewer; the tabbed **Preview / Hex / Text** viewer already lets the user switch to raw bytes, so no new UI toggle is needed.

## Capabilities

### Modified Capabilities
- `re1-formats`: `.STF` gains a real structural + character-map decoder producing correct text, replacing the printable-ASCII fallback.
- `format-viewers`: the structured viewer shows the decoded STF strings (raw bytes remain available on the Hex/Text tabs).

## Impact

- `electron/parsers/re1/`: new STF decoder + a checked-in RE1 character map; `registry.ts` routes `.STF` to it.
- `scripts/analyze.*`: probes to confirm the STF offset table and to help derive the character map.
- `shared/types.ts`: reuses the existing `StructuredAsset` (decoded text field); no new asset kind required.
- Reference: reevengi format docs / RE1 disc bytes; no new runtime dependencies (Node `Buffer` only).
