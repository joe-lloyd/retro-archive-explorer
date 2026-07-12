## ADDED Requirements

### Requirement: Preview / Hex / Text tabs

The system SHALL present each selected file in a tabbed viewer offering an interpreted Preview, a Hex view, and a Text view.

#### Scenario: Switch between tabs

- **WHEN** a file is open
- **THEN** the user can switch between Preview, Hex, and Text without reselecting the file

#### Scenario: Lazy hex/text loading

- **WHEN** the user opens the Hex or Text tab
- **THEN** the raw bytes are fetched on demand rather than eagerly for every selection

### Requirement: Preview selected by default

The system SHALL select the Preview tab by default so a file opens on its best interpretation (an image renders as an image, a model as a 3D scene, audio as a player).

#### Scenario: Default to interpreted preview

- **WHEN** a file with a dedicated viewer is selected
- **THEN** the Preview tab is active and shows the interpreted rendering

#### Scenario: Fallback preview for unknown types

- **WHEN** a file has no dedicated preview
- **THEN** the Preview tab shows a structured identification/summary, and Hex/Text remain available
