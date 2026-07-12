## Context

The app parses RE1 assets in the isolated main process and previews them via a tabbed viewer; a headless analyzer (`pnpm analyze`) reads the user's disc for evidence-driven work, and the pmandin/reevengi source is the reference for RE1 formats. This change tackles the remaining high-value content: correctly assembled characters, doors, STR video, and a room viewer. RE1 rooms are pre-rendered: each camera has a background image, with 3D used for collision and placed entities — so the first room viewer is image + camera based.

## Goals / Non-Goals

**Goals:**
- Characters assembled via skeleton rest-positions.
- Correct, textured `.DOR` rendering.
- In-app `.STR` MDEC video playback (video first).
- Room viewer: per-camera backgrounds + camera cycling + RDT section inspector.

**Non-Goals:**
- Full 3D room reconstruction (collision meshes, entity placement in 3D) — later.
- Skeletal animation playback for characters (static assembled pose here).
- XA audio for STR in this pass (video-only first); frame-accurate A/V sync.
- Game-logic interpretation of scripts (SCD) beyond structural listing.

## Decisions

**EMD skeleton assembly.** The skeleton section header is `emd_skel_header_t {relpos_len, move_offset, count, move_size}` (reevengi `emd_common.h`); the hierarchy (armature `{num_mesh, offset}` + child-index arrays) is already decoded. Per-bone rest positions are `emd_vertex3_t {x,y,z}` located from the header; I accumulate parent→child translations over the hierarchy and translate each mesh part by its bone's cumulative position. Enemies already render world-positioned, so assembly is applied only where parts are bone-local (detected/keyed by mesh type) to avoid double offsets. Exact relpos offset confirmed via the analyzer against real files.

**DOR parser.** `.DOR` has a start-of-file offset table (not the EMD end-directory); the entry at a fixed slot points to the door's TMD, with a TIM for texture. Parse the table, decode that TMD via the existing path, resolve the texture, and render. Confirm slot layout with the analyzer; fall back to a descriptive error rather than the old greedy scan.

**STR MDEC decode in main.** STR frames are BS-compressed MDEC macroblocks spread across 2352-byte sectors with a per-sector STR sub-header (frame id, sector index/count, frame size, width/height). Pipeline: demux sectors → assemble each frame's bitstream → BS/RLE + IDCT (MDEC) → YUV→RGB → RGBA frame. Runs in the main process (CPU-heavy); frames are sent to the renderer which paints them to a canvas on a clock. Video first; XA audio deferred. Alternative (ffmpeg/native) — rejected to stay dependency-light and in-process.

**Room viewer = backgrounds + cameras.** RE1 room backgrounds are pre-rendered images (per camera), stored/compressed in the room data. Decode the camera background(s) and the RID camera table; the viewer shows the current camera's image with next/prev controls and a section-inspector panel (reusing the structured/archive views for RID/RVD/SCA/SCD/VH/VB/TIM/items). This lands the "cycle through cameras" experience without full 3D. 3D scene + entity toggles are a documented follow-up.

**Reuse the analyzer.** DOR/STR/RDT sub-layouts are confirmed by dumping real files (`pnpm analyze dump`) and cross-referencing reevengi source, keeping every parser evidence-based.

## Risks / Trade-offs

- **Skeleton relpos layout uncertainty** → confirm via analyzer; apply only to bone-local meshes; visually verify with the user (parts assemble vs. shift wrong).
- **MDEC is intricate** (BS versions, DC/AC coding, IDCT correctness) → implement the common RE1 STR variant, validate against a known clip; report unsupported variants rather than showing corruption.
- **Room background format may be compressed/tiled** → decode incrementally; if a room's background can't be decoded, still show structure + cameras list.
- **Main-process CPU for MDEC** could jank → decode lazily/streamed; cap in-flight frames.
- **DOR slot assumptions** → validate offsets in-bounds; descriptive error on mismatch.

## Migration Plan

Additive; no data migration. New parsers/viewers behind existing extension routing. STR/room are new asset kinds; door routing updated.

## Open Questions

- Exact RDT camera-background storage (compression/format) for this RE1 release — resolve via analyzer + reevengi.
- The precise EMD relpos offset/stride for characters vs enemies.
- STR BS/MDEC variant used by RE1 (v2 vs v3 bitstream).
- Whether DOR animation keyframes are worth decoding now or deferring to static render.
