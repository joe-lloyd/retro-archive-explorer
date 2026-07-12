## MODIFIED Requirements

### Requirement: Parse TMD/EMD models

The system SHALL parse `.TMD` and `.EMD` model files by decoding each PSX primitive packet according to its mode/flag bits — reading the color or UV preamble and the interleaved normal/vertex tail — and produce correct triangle geometry with per-vertex color. Where a primitive is textured and a corresponding texture can be resolved, the system SHALL emit UV coordinates and the texture image; otherwise geometry SHALL still be produced with a neutral fallback color.

#### Scenario: Decode interleaved normal/vertex primitives

- **WHEN** a lit gouraud or textured primitive stores `(normal, vertex)` index pairs
- **THEN** the decoder extracts the vertex indices (not the normal indices) so the reconstructed geometry matches the source mesh

#### Scenario: Emit per-vertex colors

- **WHEN** a primitive carries flat (single) or gouraud (per-vertex) RGB values
- **THEN** the mesh object includes matching per-vertex color data

#### Scenario: Texture an EMD when a palette is available

- **WHEN** an `.EMD` contains or is accompanied by a resolvable `.TIM`
- **THEN** the model includes UV coordinates and decoded texture pixels for rendering
- **AND WHEN** no texture can be resolved
- **THEN** the model still renders with correct geometry and a neutral color

#### Scenario: Handle multi-object models

- **WHEN** a model file declares multiple objects
- **THEN** each object's geometry is returned as a distinct entry rather than merged silently

## ADDED Requirements

### Requirement: Decode PSX audio to a playable format

The system SHALL decode PlayStation audio samples (VAG / SPU-ADPCM) into PCM and wrap them as WAV so the renderer can play them. Formats that cannot yet be decoded SHALL be identified and reported rather than shown only as raw bytes.

#### Scenario: Decode a VAG sample

- **WHEN** a `.VAG` (or embedded SPU-ADPCM) sample is parsed
- **THEN** the system returns WAV audio with the correct sample rate that the audio viewer can play

#### Scenario: Report an undecodable codec

- **WHEN** an audio file uses a codec that is not yet supported (e.g. streamed XA)
- **THEN** the system returns a descriptive note identifying the format instead of failing silently
