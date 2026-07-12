## ADDED Requirements

### Requirement: Reconstruct EMD models from their real structure

The system SHALL parse `.EMD` files using their actual container layout (offset directory and skeleton hierarchy) and position each mesh part by its skeleton bone offset, rather than scanning the file for embedded TMD blocks.

#### Scenario: Assembled character

- **WHEN** a valid `.EMD` is parsed
- **THEN** each mesh part is placed at its bone's cumulative offset so the character is assembled in space rather than stacked at the origin

#### Scenario: No more false "no TMD blocks" failure

- **WHEN** an `.EMD` that previously failed the TMD-block scan is parsed
- **THEN** it is parsed via the container structure and produces geometry (or a descriptive, format-specific error), not a generic "no TMD blocks found"

#### Scenario: Colors preserved

- **WHEN** an EMD mesh carries vertex/face colors or a texture
- **THEN** those are retained on the assembled model

### Requirement: Normalize model orientation

The system SHALL present `.TMD`/`.EMD`/`.IVM` models in a consistent upright orientation, correcting the PlayStation coordinate convention (Y-down) so items are not upside-down or rotated.

#### Scenario: Upright IVM

- **WHEN** an `.IVM` item model is viewed
- **THEN** it appears right-side-up rather than inverted or rotated 90°

### Requirement: Parse DOR door data

The system SHALL parse `.DOR` files into their component structures (models/animation data) so a door and its transition animation can be presented.

#### Scenario: Door parsed

- **WHEN** a `.DOR` file is parsed
- **THEN** the system extracts its geometry and any animation/keyframe data into a viewer-ready structure, or reports a descriptive error if the layout is unrecognized

### Requirement: Interpret HED sound headers

The system SHALL interpret `.HED` (VAB/sound header) files into structured information describing the sound bank, instead of showing only hex.

#### Scenario: HED structured view

- **WHEN** a `.HED` file is parsed
- **THEN** the system reports header fields (e.g. program/tone/sample counts and sizes) as structured data

### Requirement: Produce playable decoded audio

The system SHALL emit decoded VAG/SPU‑ADPCM audio as a WAV stream that plays in a standard HTML audio element with a correct reported duration.

#### Scenario: Sample plays

- **WHEN** a decoded `.VB`/VAG sample is loaded and the user presses play
- **THEN** playback occurs and the reported duration is non-zero and matches the waveform

## MODIFIED Requirements

### Requirement: Parse TMD/EMD models

The system SHALL parse `.TMD` and `.EMD` model files by decoding each PSX primitive packet according to its mode/flag bits — reading the color or UV preamble and the interleaved normal/vertex tail — and produce correct triangle geometry with per-vertex color. `.EMD` files SHALL be reconstructed from their container/skeleton structure (see "Reconstruct EMD models from their real structure") rather than by scanning for embedded TMD blocks. Where a primitive is textured and a corresponding texture can be resolved, the system SHALL emit UV coordinates and the texture image; otherwise geometry SHALL still be produced with a neutral fallback color.

#### Scenario: Decode interleaved normal/vertex primitives

- **WHEN** a lit gouraud or textured primitive stores `(normal, vertex)` index pairs
- **THEN** the decoder extracts the vertex indices (not the normal indices) so the reconstructed geometry matches the source mesh

#### Scenario: Emit per-vertex colors

- **WHEN** a primitive carries flat (single) or gouraud (per-vertex) RGB values
- **THEN** the mesh object includes matching per-vertex color data

#### Scenario: Handle multi-object models

- **WHEN** a model file declares multiple objects
- **THEN** each object's geometry is returned as a distinct entry rather than merged silently
