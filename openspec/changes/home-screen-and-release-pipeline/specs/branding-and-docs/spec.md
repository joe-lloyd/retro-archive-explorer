## ADDED Requirements

### Requirement: Application icon

The system SHALL ship a modern "disk exploration" themed application icon in the formats each platform needs, wired into the packaged build and the app window.

#### Scenario: Packaged app icon

- **WHEN** the app is packaged for macOS, Windows, or Linux
- **THEN** the platform-appropriate icon (`.icns`, `.ico`, `.png`) is applied to the installer and application

#### Scenario: Window icon

- **WHEN** the app window is shown on a platform that uses window icons
- **THEN** the app icon is displayed

### Requirement: README

The system SHALL provide a README describing what the app is, supported formats, how to install/run from source, and how to release.

#### Scenario: README present

- **WHEN** a visitor opens the repository
- **THEN** the README explains the app's purpose, feature/format list, run-from-source steps, and release process

### Requirement: Illustrated user guide

The system SHALL provide a user guide covering opening a disc, browsing files, and using each viewer, with screenshots.

#### Scenario: User guide present

- **WHEN** a user opens the user guide
- **THEN** it walks through opening an image, the home/recent-files screen, the file tree, and the Preview/Hex/Text viewers, with screenshots
