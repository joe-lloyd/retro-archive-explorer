## MODIFIED Requirements

### Requirement: Decode text data

The system SHALL decode `.STF` text files using their real structure — a string offset table and payload — mapping each string's bytes through the RE1 character set into readable text, rather than only surfacing printable-ASCII bytes.

#### Scenario: Decode STF strings

- **WHEN** a `.STF` file is parsed
- **THEN** the system reads its string offset table, decodes each string via the RE1 character map, and returns the resulting text

#### Scenario: Unknown bytes are handled

- **WHEN** a byte has no entry in the character map
- **THEN** the decoder emits a placeholder for that byte and continues, rather than aborting the whole string

#### Scenario: Malformed file falls back safely

- **WHEN** a `.STF` file does not match the expected structure
- **THEN** the system reports a descriptive result and still exposes the raw bytes, instead of failing hard

### Requirement: RE1 character map

The system SHALL include a checked-in RE1 character map (byte value → character) used to decode STF text, requiring no external or user-supplied file at runtime.

#### Scenario: Map is bundled

- **WHEN** the STF decoder runs
- **THEN** it uses the repository's bundled character map without needing an external file
