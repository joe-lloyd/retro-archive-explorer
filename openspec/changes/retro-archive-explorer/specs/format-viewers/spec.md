## ADDED Requirements

### Requirement: Texture viewer

The system SHALL render parsed `.TIM` pixel data onto an HTML5 Canvas at the texture's native dimensions.

#### Scenario: Render a decoded texture

- **WHEN** the texture viewer receives RGBA pixel data with width and height
- **THEN** it draws the image to a canvas sized to those dimensions

### Requirement: 3D model viewer

The system SHALL render parsed `.TMD`/`.EMD` geometry in a Three.js WebGL viewport with orbit-style camera controls.

#### Scenario: Display a mesh

- **WHEN** the model viewer receives vertex positions and indices
- **THEN** it builds a `BufferGeometry`, adds it to the scene, and lets the user rotate and zoom the model

#### Scenario: Dispose on unmount

- **WHEN** the user navigates away from the model viewer
- **THEN** the WebGL context, geometries, and materials are disposed to avoid leaks

### Requirement: Audio viewer

The system SHALL provide playback and a waveform display for supported audio assets.

#### Scenario: Play an audio asset

- **WHEN** the user selects a supported audio file and presses play
- **THEN** the viewer plays the audio and shows a waveform with playback position

### Requirement: Text and hex viewer

The system SHALL display file contents as either plain text or a formatted hex dump.

#### Scenario: Hex dump formatting

- **WHEN** the text/hex viewer receives a binary buffer
- **THEN** it renders offset, hex byte columns, and an ASCII gutter

### Requirement: Archive viewer

The system SHALL list the sub-files contained in a nested archive node with their names, sizes, and offsets.

#### Scenario: List archive contents

- **WHEN** the archive viewer receives an unpacked container's sub-file list
- **THEN** it displays each sub-file's name, size, and offset, and selecting one opens it in the appropriate viewer
