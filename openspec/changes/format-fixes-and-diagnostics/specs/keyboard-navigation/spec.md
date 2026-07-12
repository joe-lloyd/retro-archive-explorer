## ADDED Requirements

### Requirement: Keyboard navigation of the file tree

The system SHALL let the user navigate the file tree with the keyboard once the tree has focus.

#### Scenario: Move selection with arrow keys

- **WHEN** the file tree is focused and the user presses Down or Up
- **THEN** the selection moves to the next or previous visible node and that node is revealed/scrolled into view

#### Scenario: Expand and collapse

- **WHEN** the user presses Right on a collapsed directory or container node
- **THEN** it expands (unpacking a container if needed)
- **AND WHEN** the user presses Left on an expanded node
- **THEN** it collapses; pressing Left on a leaf moves selection to its parent

#### Scenario: Open the selected file

- **WHEN** a file node is selected and the user presses Enter
- **THEN** that file opens in the viewer

#### Scenario: Selection follows keyboard

- **WHEN** the keyboard selection lands on a file node
- **THEN** the viewer reflects the selected file (consistent with clicking it)
