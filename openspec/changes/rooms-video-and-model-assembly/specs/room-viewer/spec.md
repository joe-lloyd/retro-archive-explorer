## ADDED Requirements

### Requirement: Decode room camera backgrounds

The system SHALL decode the pre-rendered camera background image(s) contained in (or referenced by) an RDT room and expose them per camera.

#### Scenario: Room exposes camera backgrounds

- **WHEN** an `.RDT` room is opened
- **THEN** the system produces the pre-rendered background image for each of the room's cameras

#### Scenario: No backgrounds available

- **WHEN** a room's background data cannot be decoded
- **THEN** the system still presents the room's structure and reports that backgrounds are unavailable, rather than failing

### Requirement: Cycle through room cameras

The system SHALL let the user move between a room's cameras and see the corresponding background.

#### Scenario: Next/previous camera

- **WHEN** a room with multiple cameras is open and the user advances the camera
- **THEN** the view switches to the next camera's background and reports the current camera index/count

### Requirement: RDT section inspector

The system SHALL present a structured breakdown of an RDT room's sections (e.g. camera positions RID, camera switches RVD, collision SCA, scripts SCD, sound VH/VB, textures, items) with their offsets and sizes.

#### Scenario: Inspect sections

- **WHEN** a room is open
- **THEN** the user can see the room's named sections and drill into a section to view/parse it
