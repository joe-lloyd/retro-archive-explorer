## 1. EMD character skeleton assembly

- [x] 1.1 Located rest positions: `int16 x,y,z` per bone at `skel+8`; armature at `skel+relpos_len` (reevengi emd_common.h/emd2xml.c)
- [x] 1.2 Accumulate parent→child bone translations via DFS over the armature hierarchy (`parseEmdSkeleton`)
- [x] 1.3 Offset each mesh part by its bone's world position (`assembleBySkeleton`); both char + enemy parts are bone-local. Added EMD Y-up flip
- [ ] 1.4 Verify visually with the user that characters assemble correctly

## 2. DOR door parser

- [ ] 2.1 Analyze `.DOR` (DOOR00) to confirm the start-of-file offset table and the door-model + texture slots
- [ ] 2.2 Implement `re1/dor.ts`: parse the table, decode the door TMD, resolve the TIM texture
- [ ] 2.3 Route `.DOR` to the model/door viewer; textured, with descriptive error on layout mismatch

## 3. STR video decode

- [ ] 3.1 Analyze `.STR` (e.g. CAPCOM.STR) sector/sub-header layout; confirm width/height/frame framing
- [ ] 3.2 Demux sectors into per-frame bitstreams
- [ ] 3.3 Implement MDEC decode (BS/RLE + IDCT + YUV→RGB) → RGBA frames in `video/str.ts`
- [ ] 3.4 Report unsupported variants with a clear reason
- [ ] 3.5 Unit-test the decoder on a small known frame

## 4. Video viewer

- [ ] 4.1 Add a `video` asset kind and `VideoViewer` that paints frames to a canvas on a clock
- [ ] 4.2 Play/pause + position display; play video without audio (note audio is a follow-up)

## 5. Room (RDT) viewer

- [ ] 5.1 Analyze RDT to locate camera background image data and the RID camera table
- [ ] 5.2 Decode per-camera background image(s) in `re1/rdtRoom.ts`
- [ ] 5.3 Add a `room` asset kind and `RoomViewer`: show current camera background, cycle cameras, list sections
- [ ] 5.4 Section inspector: expose RID/RVD/SCA/SCD/VH/VB/TIM/items with offsets/sizes (reuse structured/archive views)
- [ ] 5.5 Graceful fallback when backgrounds can't be decoded (still show structure + cameras)

## 6. Analyzer support

- [ ] 6.1 Extend `pnpm analyze` as needed for DOR/STR/RDT probes (sub-headers, tables)

## 7. Verification

- [ ] 7.1 Typecheck, lint, and production build pass
- [ ] 7.2 Parser unit tests (skeleton assembly, DOR, STR frame) pass
- [ ] 7.3 Manual: characters assembled; doors textured; a STR clip plays; a room shows backgrounds and cycles cameras
