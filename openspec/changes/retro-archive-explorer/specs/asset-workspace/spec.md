## ADDED Requirements

### Requirement: File tree sidebar navigation

The system SHALL render the mounted virtual file tree in a sidebar that lets the user expand directories and select files.

#### Scenario: Expand and select a node

- **WHEN** the user clicks a directory node in the sidebar
- **THEN** its children are displayed, and selecting a file node marks it active and triggers a data request for that node

#### Scenario: Expand a nested container

- **WHEN** the user expands an `.RDT`/`.DAT` file node
- **THEN** the sidebar displays its unpacked sub-files as child entries

### Requirement: Context-aware viewer container

The system SHALL provide a viewer container that inspects the selected file's extension/type and mounts the matching viewer.

#### Scenario: Dispatch to the correct viewer

- **WHEN** the user selects a file
- **THEN** the container mounts the texture, model, audio, text/hex, or archive viewer appropriate to that file type

#### Scenario: Unknown type falls back to hex

- **WHEN** the selected file has no dedicated viewer
- **THEN** the container falls back to the text/hex viewer rather than showing an empty pane

### Requirement: Responsive selection feedback

The system SHALL keep the interface responsive while a large asset is being parsed.

#### Scenario: Loading state during parse

- **WHEN** a selected file triggers a parse that does not complete immediately
- **THEN** the viewer container shows a loading indicator and remains interactive
