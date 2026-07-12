## Why

The viewer now decodes most RE1 assets, but three big gaps remain: character `.EMD` parts render **stacked** because the skeleton rest-positions aren't applied; `.DOR` doors render as broken black-and-white geometry (wrong format); and `.STR` FMV videos and the whole **room (RDT) structure** aren't viewable at all. The most exciting missing piece is being able to open a stage room and actually see it — its pre-rendered camera backgrounds, its sections, and its placed contents. This change assembles characters correctly, adds a proper door viewer, plays STR video in-app, and introduces a room viewer that cycles through a room's cameras.

## What Changes

- **Assemble character EMDs**: read the skeleton section's per-bone rest positions, accumulate them down the bone hierarchy (already decoded), and offset each mesh part so characters stand assembled instead of stacked at the origin.
- **Parse `.DOR` properly**: decode the door container (start-of-file offset table → door model TMD + texture) and render it correctly (textured, not black-and-white); play the transition animation where the data allows, else show it static.
- **Play `.STR` video**: demux the CD-XA/STR sectors, decode the MDEC (BS) macroblock frames, and play the video on a canvas with basic transport (video first; XA audio as a follow-up).
- **Room (RDT) viewer**: decode a room's pre-rendered **camera backgrounds** and let the user **cycle through cameras**; present a structured breakdown of the RDT's sections (RID camera positions, RVD switches, SCA collision, SCD scripts, VH/VB sound, TIM, items). Foundations for later 3D scene reconstruction and entity toggles.
- Extend the diagnostics analyzer as needed to reverse-engineer DOR/STR/RDT sub-formats from the user's disc.

## Capabilities

### New Capabilities
- `room-viewer`: Open an RDT room, decode and cycle its pre-rendered camera backgrounds, and inspect its section structure.
- `video-playback`: Decode and play `.STR` MDEC video.

### Modified Capabilities
- `asset-parsing`: EMD skeleton assembly (bone-positioned parts); a real `.DOR` parser; RDT camera-background and section decoding.
- `format-viewers`: A working door viewer, a video viewer, and a room viewer with camera cycling.

## Impact

- `electron/parsers/`: EMD skeleton positioning in `tmdParser`; new `re1/dor.ts`, `re1/rdtRoom.ts` (camera/section decode), and `video/str.ts` (MDEC).
- `src/components/viewers/`: new `RoomViewer`, `VideoViewer`; door routed to the model/animation viewer.
- `shared/types.ts`: new asset shapes (room, video, door animation).
- `scripts/analyze.*`: probes for DOR/STR/RDT.
- Larger CPU work (MDEC decode) runs in the main process; results stream to the renderer canvas.
