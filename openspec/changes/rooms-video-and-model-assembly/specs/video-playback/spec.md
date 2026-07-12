## ADDED Requirements

### Requirement: Decode STR MDEC video

The system SHALL demux `.STR` sector streams and decode their MDEC (BS) macroblock frames into displayable RGB images.

#### Scenario: Decode frames

- **WHEN** a `.STR` file is opened
- **THEN** the system decodes its frames into images at the stream's resolution

#### Scenario: Report undecodable stream

- **WHEN** a `.STR` file's frames cannot be decoded
- **THEN** the system reports the reason (e.g. unsupported variant) instead of failing silently

### Requirement: Play STR video

The system SHALL play decoded STR video on a canvas with basic transport controls at approximately the source frame rate.

#### Scenario: Playback

- **WHEN** a decoded `.STR` video is open and the user presses play
- **THEN** frames render in sequence on a canvas with play/pause, and the current/total position is shown

#### Scenario: Audio follow-up

- **WHEN** XA audio decoding is not yet implemented
- **THEN** video plays without audio and this is indicated, rather than blocking playback
