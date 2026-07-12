## ADDED Requirements

### Requirement: Parse TIM textures

The system SHALL parse `.TIM` textures by validating the magic signature `0x10000000`, reading CLUT dimensions and bit-depth (4-bit, 8-bit, or 16-bit), and producing sanitized pixel data suitable for canvas rendering.

#### Scenario: Decode a paletted TIM

- **WHEN** a `.TIM` buffer with a valid signature and a 4-bit or 8-bit CLUT is parsed
- **THEN** the system returns image width, height, and a `Uint8ClampedArray` of RGBA pixels resolved through the CLUT

#### Scenario: Decode a direct-color TIM

- **WHEN** a 16-bit `.TIM` buffer is parsed
- **THEN** the system returns RGBA pixel data converted from 16-bit color without requiring a CLUT

#### Scenario: Reject an invalid signature

- **WHEN** a buffer whose leading bytes are not `0x10000000` is parsed as a `.TIM`
- **THEN** the system returns a parse error rather than pixel data

### Requirement: Parse TMD/EMD models

The system SHALL parse `.TMD` and `.EMD` model files by iterating vertex chunks, normals, and primitive face records, and reconstruct indices into geometry arrays consumable by a WebGL scene.

#### Scenario: Reconstruct mesh geometry

- **WHEN** a valid `.TMD` or `.EMD` buffer is parsed
- **THEN** the system returns `Float32Array` vertex positions plus face indices sufficient to build a `BufferGeometry`

#### Scenario: Handle multi-object models

- **WHEN** a model file declares multiple objects
- **THEN** each object's geometry is returned as a distinct entry rather than merged silently

### Requirement: Produce serializable, sanitized output

The system SHALL convert all parsed binary data into plain JavaScript objects and typed arrays (e.g. `Float32Array`, `Uint8ClampedArray`) that are safe to transfer across the IPC boundary.

#### Scenario: No live handles cross IPC

- **WHEN** any parser completes
- **THEN** its result contains only structured-cloneable values with no file handles, buffers tied to open descriptors, or executable content
