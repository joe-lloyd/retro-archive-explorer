## MODIFIED Requirements

### Requirement: Structured HED viewer

The system SHALL display interpreted `.HED` sound-header information and decoded `.STF` text in the structured viewer, with raw bytes remaining available on the Hex/Text tabs.

#### Scenario: Render HED fields

- **WHEN** a `.HED` file is opened
- **THEN** the Preview tab shows its interpreted header fields rather than only hex

#### Scenario: Render decoded STF text

- **WHEN** a `.STF` file is opened
- **THEN** the Preview tab shows its decoded strings, and the Hex/Text tabs still expose the raw bytes
