## ADDED Requirements

### Requirement: Git hygiene

The system SHALL be a git repository with an ignore file that excludes build output, dependencies, and local artifacts.

#### Scenario: Ignored paths

- **WHEN** the repository is initialized
- **THEN** `node_modules/`, `dist/`, `dist-electron/`, and the packaged-release output directory are excluded from version control

### Requirement: Tag and version synchronization

The system SHALL keep the `package.json` version in sync with the released git tag, with a documented single command to bump the version and create the matching tag.

#### Scenario: Bump and tag

- **WHEN** a maintainer runs the documented version command with a target version
- **THEN** `package.json` is updated to that version and a matching `v<version>` git tag is created

#### Scenario: Build version matches tag

- **WHEN** the release workflow runs for a pushed tag
- **THEN** the produced artifacts carry the version from the tag

### Requirement: Tag-triggered cross-platform build

The system SHALL provide a GitHub Actions workflow that, when a `v*` tag is pushed, builds the app on macOS, Windows, and Linux and publishes the artifacts to a GitHub Release.

#### Scenario: Release on tag push

- **WHEN** a `v*` tag is pushed to the repository
- **THEN** the workflow builds installers/binaries for macOS, Windows, and Linux and attaches them to the release for that tag

#### Scenario: No release on ordinary commits

- **WHEN** commits are pushed without a `v*` tag
- **THEN** the release workflow does not publish artifacts

#### Scenario: Update feed compatibility

- **WHEN** the workflow publishes a release
- **THEN** it includes the metadata files the in-app updater needs to detect the release
