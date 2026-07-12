## ADDED Requirements

### Requirement: Headless file analyzer

The system SHALL provide a headless command-line analyzer that mounts an ISO/BIN image, resolves a file by its in-image path, and emits a structured diagnostic report.

#### Scenario: Analyze a file by path

- **WHEN** the analyzer is run with an image path and an in-image file path
- **THEN** it writes a report containing the file's size, magic bytes, detected format, the result (or error) of the relevant parser, and a hex window

#### Scenario: Report to a readable artifact

- **WHEN** the analyzer runs
- **THEN** the report is written to a `diagnostics/` output file (JSON and/or text) that can be inspected without launching the app

#### Scenario: List candidates by extension

- **WHEN** the analyzer is run in list mode for an extension
- **THEN** it enumerates matching files in the image with their paths and sizes so a specific one can be chosen for analysis

### Requirement: Diagnostics do not ship in the app

The system SHALL keep diagnostics output and tooling out of the packaged application and out of version control.

#### Scenario: Ignored output

- **WHEN** the analyzer writes reports
- **THEN** the `diagnostics/` directory is git-ignored and excluded from packaged builds
