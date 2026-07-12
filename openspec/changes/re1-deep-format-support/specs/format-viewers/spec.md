## MODIFIED Requirements

### Requirement: 3D model viewer

The system SHALL render parsed `.TMD`/`.EMD` geometry in a Three.js WebGL viewport with orbit-style camera controls, applying per-vertex colors when present and a texture map when the model supplies UVs and texture pixels.

#### Scenario: Display a colored mesh

- **WHEN** the model viewer receives geometry with per-vertex colors
- **THEN** it renders the mesh with those colors rather than a flat gray

#### Scenario: Display a textured mesh

- **WHEN** the model supplies UV coordinates and texture pixels
- **THEN** the viewer builds a texture and maps it onto the geometry

#### Scenario: Dispose on unmount

- **WHEN** the user navigates away from the model viewer
- **THEN** the WebGL context, geometries, materials, and textures are disposed to avoid leaks

### Requirement: Audio viewer

The system SHALL provide playback and a waveform display for decoded audio assets.

#### Scenario: Play a decoded PSX sample

- **WHEN** the user selects a VAG/ADPCM sample that has been decoded to WAV and presses play
- **THEN** the viewer plays the audio and shows a waveform with playback position

## ADDED Requirements

### Requirement: Structured viewer

The system SHALL render a structured asset (format name, summary, and named sections/records) in a readable panel.

#### Scenario: Render an interpreted engine file

- **WHEN** the viewer receives a structured asset for an RE1 engine file
- **THEN** it displays the format name, summary, and each section's fields
