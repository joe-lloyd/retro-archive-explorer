## ADDED Requirements

### Requirement: Assemble EMD characters from the skeleton

The system SHALL position each EMD mesh part using the skeleton section: read per-bone rest positions, accumulate them down the bone hierarchy, and translate each part's vertices by its bone's cumulative position so the character is assembled rather than stacked at the origin.

#### Scenario: Character assembled

- **WHEN** a character `.EMD` (standard-TMD mesh) is parsed
- **THEN** each mesh part is offset by its bone's accumulated rest position, producing a coherent standing figure

#### Scenario: Enemy meshes unaffected when already positioned

- **WHEN** an enemy `.EMD` whose parts are already world-positioned is parsed
- **THEN** it continues to render correctly (no double offset)

### Requirement: Parse DOR door files

The system SHALL parse `.DOR` files via their own container layout (start-of-file offset table locating the door model TMD and its texture) and produce a textured door model.

#### Scenario: Door renders textured

- **WHEN** a `.DOR` file is parsed
- **THEN** the door model is decoded from the offset-table entry and rendered with its texture (not black-and-white garbage)

#### Scenario: Descriptive error on unknown layout

- **WHEN** a `.DOR` file does not match the expected layout
- **THEN** the system reports a specific error rather than emitting scrambled geometry

### Requirement: Decode RDT camera backgrounds and sections

The system SHALL read an RDT room's header/section table to locate its camera background image data and its named sections.

#### Scenario: Locate backgrounds and sections

- **WHEN** an `.RDT` file is parsed for the room viewer
- **THEN** the system exposes the camera background image data and the offsets/sizes of the room's sections
