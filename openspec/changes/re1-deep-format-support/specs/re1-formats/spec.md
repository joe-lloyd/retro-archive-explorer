## ADDED Requirements

### Requirement: Identify RE1 engine file types

The system SHALL recognize Resident Evil 1 engine extensions (`.RDT`, `.DAT`, `.EMD`, `.IVM`, `.DOR`, `.PIX`, `.ESP`, `.EMW`, `.STF`) and the `camera.bin` sub-file, and associate each with a human-readable format name and description.

#### Scenario: Label a known extension

- **WHEN** a file with a recognized RE1 extension is selected
- **THEN** its preview reports the format's proper name and a short description of its role in the engine

### Requirement: Structured interpretation of engine containers

The system SHALL interpret RE1 container and data files into a structured view of named sections/records rather than only a raw hex dump.

#### Scenario: Interpret an RDT room file

- **WHEN** an `.RDT` file is parsed
- **THEN** the system exposes its header offset table as named sections (e.g. background, collision, camera, lighting) with each section's offset and size

#### Scenario: Interpret camera data

- **WHEN** `camera.bin` (or an RDT camera section) is parsed
- **THEN** the system lists camera records with interpreted position/target fields

#### Scenario: Decode text data

- **WHEN** a `.STF` text file is parsed
- **THEN** the system returns its decoded text content

#### Scenario: Unknown-but-identified fallback

- **WHEN** a recognized format has no dedicated decoder yet
- **THEN** the system still returns a structured summary (format name, size, key header bytes) so the file is identified rather than opaque
