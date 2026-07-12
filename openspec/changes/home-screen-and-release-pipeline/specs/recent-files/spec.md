## ADDED Requirements

### Requirement: Home screen with recent files

The system SHALL show a home screen whenever no archive is mounted, listing recently opened files and offering an action to open a new file.

#### Scenario: Home screen on launch

- **WHEN** the app starts with no archive mounted
- **THEN** the home screen is shown with the recent-files list and an "Open image" button

#### Scenario: Reopen a recent file

- **WHEN** the user clicks a recent-files entry
- **THEN** the app mounts that file and enters the explorer without a file dialog

#### Scenario: Open a new file from home

- **WHEN** the user clicks "Open image" on the home screen
- **THEN** a native file dialog opens and the chosen image is mounted

#### Scenario: Return to home

- **WHEN** the user activates the "home" control while in the explorer
- **THEN** the app returns to the home screen without exiting

### Requirement: Persist recent files

The system SHALL persist the recent-files list across sessions in the main process, most-recent first, capped to a fixed maximum, without duplicate paths.

#### Scenario: Record an opened file

- **WHEN** a file is successfully mounted
- **THEN** it is added to the top of the recent-files list with its name, path, and last-opened timestamp
- **AND** an existing entry for the same path is moved to the top rather than duplicated

#### Scenario: Cap the list

- **WHEN** the number of recent files exceeds the maximum
- **THEN** the oldest entries beyond the cap are dropped

#### Scenario: Prune missing files

- **WHEN** the recent-files list is loaded and an entry's file no longer exists on disk
- **THEN** that entry is omitted from the list presented to the user

### Requirement: Manage recent files

The system SHALL let the user remove a single recent entry or clear the whole list.

#### Scenario: Remove one entry

- **WHEN** the user removes a recent entry
- **THEN** it is deleted from the persisted list and no longer shown

#### Scenario: Clear all

- **WHEN** the user clears the recent-files list
- **THEN** the persisted list becomes empty
