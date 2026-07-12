## 1. EMD character skeleton assembly

- [x] 1.1 Located rest positions: `int16 x,y,z` per bone at `skel+8`; armature at `skel+relpos_len` (reevengi emd_common.h/emd2xml.c)
- [x] 1.2 Accumulate parent→child bone translations via DFS over the armature hierarchy (`parseEmdSkeleton`)
- [x] 1.3 Offset each mesh part by its bone's world position (`assembleBySkeleton`); both char + enemy parts are bone-local. Added EMD Y-up flip
- [x] 1.4 Verified with user: models assemble correctly. Follow-ups found:
- [ ] 1.5 Fix EMD texturing: apply per-face `clutid`/`page` (VRAM tpage/CLUT) to UVs — currently discarded, so wrong texture region maps to each face (e.g. face texture on chest)
- [ ] 1.6 Fix DOR handle placement: door sub-objects (handles) default to (0,0,0); locate + apply their positions

## 2. DOR door parser

- [x] 2.1 Confirmed DOR layout: offset table where slot 1 → door model TMD (0x140c), slot 2 → texture TIM (0xafd4)
- [x] 2.2 Implemented `parseDoor`: parse the table, decode the door TMD, resolve the TIM texture (DOOR00 → 12 objs, 697 tris, 128x256 texture)
- [x] 2.3 Routed `.DOR` to `parseModel`→`parseDoor`; textured, descriptive error on layout mismatch

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

- [x] 5.1 Located: RDT offset table is at 0x40 (64-byte header, reevengi); ROOM1000 section 20 (197 KB) is the raw background, section 22 a TIM, section 19 the VAB. Fixed `interpretRdt` to read 0x40 + type-detect sections (TMD/TIM/VAB) — replaces the byte-8 mislabeling (no more bogus "messages" slot)
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
