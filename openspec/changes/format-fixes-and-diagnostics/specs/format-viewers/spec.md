## ADDED Requirements

### Requirement: Door animation viewer

The system SHALL present parsed `.DOR` door data in a viewer, playing its transition animation when animation data is available.

#### Scenario: Play a door animation

- **WHEN** a `.DOR` file with animation data is opened
- **THEN** the viewer renders the door and plays its transition animation with basic playback controls

#### Scenario: Static fallback

- **WHEN** a `.DOR` file has geometry but no usable animation data
- **THEN** the viewer shows the door statically rather than failing

### Requirement: Structured HED viewer

The system SHALL display interpreted `.HED` sound-header information in the structured viewer.

#### Scenario: Render HED fields

- **WHEN** a `.HED` file is opened
- **THEN** the Preview tab shows its interpreted header fields rather than only hex

## MODIFIED Requirements

### Requirement: Audio viewer

The system SHALL provide playback and a waveform display for decoded audio assets, with a working play control and a correct reported duration.

#### Scenario: Play a decoded PSX sample

- **WHEN** the user selects a VAG/ADPCM sample that has been decoded to WAV and presses play
- **THEN** the viewer plays the audio, shows a waveform with playback position, and reports a non-zero duration

#### Scenario: Undecodable codec reported

- **WHEN** an audio file uses a codec that is not yet supported (e.g. streamed XA)
- **THEN** the viewer identifies it with a note instead of showing a broken player
