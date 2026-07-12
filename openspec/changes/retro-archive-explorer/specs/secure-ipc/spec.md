## ADDED Requirements

### Requirement: Enforce process isolation

The system SHALL create renderer windows with `contextIsolation: true` and `nodeIntegration: false` so untrusted binary parsing never executes with Node privileges in the renderer.

#### Scenario: Renderer cannot access Node globals

- **WHEN** renderer code attempts to reference `require`, `process`, or other Node globals directly
- **THEN** those globals are undefined and access fails

### Requirement: Expose a narrow typed IPC bridge

The system SHALL expose only explicit, named async channels from the preload script via `contextBridge.exposeInMainWorld`, each backed by a TypeScript type contract.

#### Scenario: Only whitelisted channels are reachable

- **WHEN** the renderer invokes an IPC method that is not part of the exposed bridge surface
- **THEN** the call is rejected and no arbitrary channel or handler is reachable

#### Scenario: Typed request/response round-trip

- **WHEN** the renderer requests parsed data for a given node path or hash through an exposed channel
- **THEN** the main process reads the byte range, runs the appropriate parser, and returns a typed, serialized result to the renderer

### Requirement: One-way privilege direction

The system SHALL ensure the bridge only lets the renderer request data from the main process, never allowing the renderer to supply code or file paths that the main process executes.

#### Scenario: Renderer input is treated as data

- **WHEN** the renderer passes a path, hash, or offset argument over the bridge
- **THEN** the main process validates it as data and uses it only to locate byte ranges, never to execute or resolve outside the mounted archive
