## 1. Reverse-engineer STF structure

- [x] 1.1 Investigated: only ONE `.STF` on the disc — `/PSXUSA/DATA/STAFFDS.STF` (credits). It is NOT charset text: no ASCII/text runs, offset 0x00 = 0x7fff7fff (not a count), 44% of 16-bit words are 0x0001, renders as noise as a raw 16-bit image. reevengi lists PSX `.STF` as "Unknown". RE1 in-game message text lives in RDT "message" sections, not standalone STF. => premise mismatch, paused for direction.
- [ ] 1.2 Cross-check the layout against the reevengi reference; encode field sizes/terminator as named constants

## 2. RE1 character map

- [ ] 2.1 Derive the RE1 byte→character map from the game's font/charset (analyzer + reference)
- [ ] 2.2 Store it as a checked-in module (`re1/stfCharset.ts` or JSON imported by it); no external runtime file
- [ ] 2.3 Verify the map against a known string (e.g. the staff-roll credits)

## 3. Decoder

- [ ] 3.1 Implement `re1/stf.ts`: read the offset table, walk each string to its terminator, map bytes via the charset, concatenate
- [ ] 3.2 Handle unknown bytes with a placeholder; return a descriptive result + keep raw bytes on structural mismatch
- [ ] 3.3 Route `.STF` in `registry.ts` to the new decoder (replace `interpretStf`), returning a `StructuredAsset` with decoded text
- [ ] 3.4 Unit-test the decoder on a synthetic STF + the sample charset

## 4. Viewer

- [ ] 4.1 Confirm the structured viewer shows the decoded strings and that Hex/Text tabs still expose raw bytes (no new toggle)

## 5. Verification

- [ ] 5.1 Typecheck, lint, and production build pass
- [ ] 5.2 Manual: a real `.STF` (e.g. staff roll) decodes to readable text; unknown bytes degrade gracefully
