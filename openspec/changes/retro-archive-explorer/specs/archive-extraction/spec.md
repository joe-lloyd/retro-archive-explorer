## ADDED Requirements

### Requirement: Mount disc image and expose virtual file tree

The system SHALL open an ISO-9660 or raw `.BIN` disc image and produce a virtual file tree describing its contents without loading the entire archive into memory.

#### Scenario: Open a valid ISO-9660 image

- **WHEN** the user selects a valid ISO-9660 `.iso` file
- **THEN** the system returns a root `VirtualNode` whose `children` reflect the disc's directory records, each with `name`, `path`, `type`, `size`, and (for files) `offset`

#### Scenario: Open a raw BIN/sector image

- **WHEN** the user selects a raw `.BIN` image using sector-based addressing
- **THEN** the system tracks sector boundaries and produces file nodes with correct byte `offset` and `size` values

#### Scenario: Reject an unreadable image

- **WHEN** the user selects a file that is not a recognizable disc image
- **THEN** the system returns a descriptive error and no tree is mounted

### Requirement: Lazy node population

The system SHALL avoid reading whole multi-hundred-megabyte archives into active memory, resolving directory contents on demand.

#### Scenario: Large archive stays memory-bounded

- **WHEN** a multi-hundred-megabyte image is mounted
- **THEN** only directory metadata is read initially, and file byte ranges are read only when a specific node is requested

### Requirement: Unpack nested sub-containers

The system SHALL unpack files embedded inside `.RDT` / `.DAT` sub-containers by following internal offset pointers, exposing them as child `VirtualNode`s with a relative `offset`.

#### Scenario: Expand an RDT container node

- **WHEN** the user expands a node whose file is an `.RDT` container
- **THEN** the system splits the container into sub-file nodes (background layers, sound tables, item parameters) each carrying its `offset` and `size`
