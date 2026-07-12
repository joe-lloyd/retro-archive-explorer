## ADDED Requirements

### Requirement: Room viewer

The system SHALL present a room in a viewer that shows the current camera's background and lets the user cycle cameras, alongside the room's section breakdown.

#### Scenario: View and navigate a room

- **WHEN** an `.RDT` room is opened in the room viewer
- **THEN** the current camera's background is displayed with controls to move between cameras and a panel listing the room's sections

### Requirement: Video viewer

The system SHALL present decoded `.STR` video in a viewer with play/pause and position display.

#### Scenario: Watch a video

- **WHEN** a `.STR` file is opened
- **THEN** the viewer plays the decoded frames on a canvas with transport controls

## MODIFIED Requirements

### Requirement: Door animation viewer

The system SHALL present parsed `.DOR` door data in a viewer, rendering the textured door model and playing its transition animation when animation data is available.

#### Scenario: View a door

- **WHEN** a `.DOR` file is opened
- **THEN** the viewer renders the textured door model, playing its animation if present and showing it statically otherwise
