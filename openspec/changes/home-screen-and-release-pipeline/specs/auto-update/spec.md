## ADDED Requirements

### Requirement: Check for updates from GitHub Releases

The system SHALL check a GitHub Releases feed for a newer version on launch (in packaged builds only) and download an available update in the background.

#### Scenario: Update available

- **WHEN** a packaged build starts and a newer published release exists
- **THEN** the updater downloads it in the background

#### Scenario: No update or dev build

- **WHEN** the app is running unpackaged (development) or is already the latest version
- **THEN** no update is attempted and startup is unaffected

#### Scenario: Update check fails

- **WHEN** the update check cannot reach the feed
- **THEN** the failure is handled quietly and the app continues to run normally

### Requirement: Notify when an update is ready

The system SHALL notify the user once an update has been downloaded and offer to restart to apply it.

#### Scenario: Downloaded update

- **WHEN** an update finishes downloading
- **THEN** the user is notified and can choose to restart and install now or later
