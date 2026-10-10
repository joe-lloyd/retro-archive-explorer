<p align="center">
  <img src="build/icon.png" width="120" alt="Retro Archive Explorer icon" />
</p>

<h1 align="center">Retro Archive Explorer</h1>

<p align="center">Browse and preview the assets packed inside retro (PlayStation-era) disc images — right down to Resident Evil 1 engine files.</p>

---

## What it is

Retro Archive Explorer mounts an `.iso`/`.bin` disc image, walks its filesystem, and lets you preview the proprietary formats inside without extracting anything. Binary parsing runs in an isolated Electron main process; the UI never touches the raw bytes with Node privileges.

![Home screen](docs/img/home.png)

## Supported formats

| Category | Formats | Preview |
| --- | --- | --- |
| Disc images | ISO‑9660, raw MODE2/2352 `.BIN` | Virtual file tree |
| Textures | `.TIM` (4/8/16/24‑bit + CLUT) | Canvas image |
| Models | `.TMD`, `.EMD`, `.IVM` | Textured / vertex‑colored 3D viewport |
| Audio | `.VAG` / SPU‑ADPCM | Decoded to WAV + waveform player |
| RE1 engine | `.RDT`, `.DAT`, `.STF`, `camera.bin`, … | Structured “what this is” interpretation |
| Anything else | — | Hex / Text |

Every file also has **Hex** and **Text** tabs; the **Preview** tab is selected by default.

> Some RE1 container layouts (RDT sections, camera records, DAT unpacking) are best‑effort interpretations and may be refined against real data.

## Run from source

Requires [Node.js](https://nodejs.org) 20+ and [pnpm](https://pnpm.io) 10+.

```bash
pnpm install
pnpm dev        # electron-vite: builds main/preload/renderer and launches Electron with HMR
```

Other scripts:

```bash
pnpm typecheck  # tsc --noEmit
pnpm lint       # eslint
pnpm build      # electron-vite build -> out/ (main, preload, renderer)
pnpm dist       # build + package installers for the current OS (electron-builder)
pnpm icons      # regenerate build/icon.png + build/icon.ico from build/icon.svg
pnpm verify:rdt1  # check the RE1 room and script decoder against a synthetic room
pnpm demo:disc out/demo.iso  # build a demo ISO with no game data (macOS, uses hdiutil)
node scripts/verify-scd-roundtrip.mjs <image | dir>...  # round-trip every room script through the assembler
node scripts/verify-msg-roundtrip.mjs <image | dir>...  # round-trip every room message and rewrite sample rooms
```

## Command line

`pnpm rae` runs the same parsers without the app.

```bash
pnpm rae list    re1.bin rdt              # list files, optionally by extension
pnpm rae find    re1.bin ROOM10           # list files whose path matches
pnpm rae extract re1.bin out/             # copy every file out and convert what it can
pnpm rae rooms   re1.bin                  # one line per room: cameras, enemies, items, doors
pnpm rae room    re1.bin ROOM1000.RDT     # cameras, placements and sections of one room
pnpm rae script  re1.bin ROOM1000.RDT     # decompiled init and main room scripts
pnpm rae dump    re1.bin ROOM1000.RDT     # diagnostics/<name>.json plus the raw bytes
pnpm rae swap-enemy ROOM1040.RDT out.RDT 0x11 0 28  # copy a room with one enemy type swapped
pnpm rae asm     script.c in.RDT out.RDT  # assemble edited script text into a copy of a room
pnpm rae flags   re1.bin                  # which rooms check, set, clear and toggle each flag; unused indexes per group
pnpm rae msg     re1.bin ROOM1000.RDT     # the room's messages, one per line as "index: text"
pnpm rae msg-set messages.txt in.RDT out.RDT  # copy a room with its messages replaced from that format
```

`room` and `script` also take a single extracted `.RDT` path. `extract` writes TIM as PNG, VAG as WAV, and each VAB sample as its own WAV. Each room gets a `<name>.RDT.d/` folder with its sections, `script.c`, `room.txt` and `room.json`. STR and XA files are copied as 2048-byte user data, so their Form 2 sectors are not usable yet.

`asm` takes the text `script` prints. Edit it freely: block lengths are recomputed, and `/* ... */` notes are ignored. Each procedure needs its `// init procedure N` or `// main procedure N` header; a section with no procedures in the text keeps the room's own, and a section whose bytes did not change is not written. `asm` refuses to write over its input files. It also refuses what the engine cannot run:

- Every procedure except the last of its section must end with `return;`. The engine runs a procedure until it reaches an `end`, so one without would run on into the next. The assembler does not add the `return;` for you. The last procedure may leave it out because the section's closing zero word is an `end`.
- `if` blocks nest at most 16 deep, the size of the engine's branch stack.
- Enemy types are 0-48 and item ids 0-128 (or UNLOCK and LOCKED where a lock is expected), the sizes of the engine's tables.
- `set(group, index, mode)` takes mode 0 (set), 1 (clear) or 2 (toggle).

Written sections go behind the old data, then the room's `snd.vb` is copied behind them and the offset table is pointed at the new places. The engine uses the memory from `snd.vb` onward as scratch space for enemy models, so anything left after it would be overwritten. A second write to a room that was already written reuses that last `snd.vb` instead of leaving a copy each time. The result is refused if it would leave less than 471,728 bytes of the engine's 832,728-byte room buffer for enemy models, the least any retail room has, or less than the original room had when that is smaller. Rooms that fit are the ones with enough headroom; for the largest rooms the check refuses any growth. `verify-scd-roundtrip.mjs` takes a disc image or a directory of `.RDT` files and proves each init and main procedure survives decode, text and assemble byte for byte. `flags` reads only init and main scripts; event scripts are not decoded, so an index it lists as unused may still be used there.

### Room messages

`msg` prints one message per line as `index: text`, and `msg-set` writes a copy of a room with its messages replaced from a file in the same format. Blank lines are skipped. Indexes must run 0, 1, 2 without gaps, and a line is `index:`, one space, then the text. A room holds at most 64 messages (the engine picks one with `msg_id & 0x3F`). Adding messages at the end is always accepted. Removing any is refused unless you pass `--force`, because a script can show a message by number and event scripts are not decoded, so nothing proves one does not.

Text uses the escapes of the `STR()` macro in the Resident Evil PC decomp (`src/Globals.cpp`). The one difference: `STR()` reads an operand from the next character, so here an operand is written as `{N}`, a decimal number from 0 to 255. Every byte of a message has a spelling, so decoding loses nothing.

| Text | Bytes | Meaning |
| --- | --- | --- |
| `A-Z a-z 0-9 : ; , ! ? ( ) / ' - .` and space | one glyph byte | plain characters |
| `"` | `19` | closing double quote |
| `\o` | `78` | opening double quote |
| `\n` | `02` | newline |
| `\p{N}` | `03 N` | page break; 0 waits for the player, N continues after N frames |
| `\s{N}` | `04 N` | text speed. `\s{0}` opens a span that is skipped up to the next `\s{N}` |
| `\t{N}` | `05 N` | text colour |
| `\m{N}` | `06 N` | item name; 0 is the selected item. The name ends with `\r` |
| `\r` | `07` | end of an item name |
| `\c` | `08` | Yes/No prompt |
| `\q` | `0A` | square glyph |
| `\i` | `05 01 06 00 05 00` | the selected item's name in green |
| `\d{N}` | `01 N` | last in the text: the message dismisses itself after N frames. Without it the message waits for the player (`01 00`) |
| `\xNN` | `NN` | any other byte. `\xF8`, `\xF9` and `\xFA` must be followed by a second `\xNN` |

Anything else is an error that names its position: a character with no glyph, an unknown escape, a missing or oversized operand, `\d` that is not last, or a `\s{0}` span that is never closed. The end marker `01 N` is added for you. The decomp's `docs/TEXT_ENCODING.md` has the tags 02 and 03 swapped in its message table; the renderer, `UpdateMessageDisplay`, is the authority and `\n` is 02.

The new message section goes behind the old data in the same layout as scripts, and the 0x74 pointer is moved to it. `LoadRoomRdt` adds the file's base address to every entry of the offset table at 0x48, 0x74 included, and nothing else points into the old section, so the engine finds the new one. Scripts and messages can both be replaced on one file, in either order.

The RE1 room layout and script opcodes are ported from [biohazard-utils](https://github.com/biorand/biohazard-utils) (MIT). Event scripts (cutscenes) are listed by offset but not decoded yet.

The app is bundled with [electron-vite](https://electron-vite.org): `electron/main.ts` and `electron/preload.ts` compile to `out/main` and `out/preload`, and the React renderer (root `index.html` → `src/`) to `out/renderer`.

## Releasing

Versioning is tag‑driven — the git tag *is* the release version, and it stays in sync with `package.json`.

1. Bump the version and create the matching tag:
   ```bash
   pnpm version <major|minor|patch|x.y.z>
   ```
   This updates `package.json` and creates a `vX.Y.Z` git tag.
2. Push the commit and tag:
   ```bash
   git push --follow-tags
   ```
3. Pushing a `v*` tag triggers [`.github/workflows/release.yml`](.github/workflows/release.yml), which builds on **macOS, Windows, and Linux** and publishes the installers to a GitHub Release (via `electron-builder`, using the default `GITHUB_TOKEN`).

Ordinary commits (no `v*` tag) never publish a release.

### Auto‑update

Packaged builds check the GitHub Releases feed on launch and download newer versions in the background, prompting to restart when ready. This only runs in packaged builds — development is unaffected.

> **Unsigned builds:** artifacts are currently unsigned. macOS shows a Gatekeeper warning (right‑click → Open the first time) and macOS auto‑update is disabled until code signing is added. Windows and Linux auto‑update works unsigned.

## Documentation

- [User Guide](docs/USER_GUIDE.md) — a walkthrough of opening a disc and using each viewer.

## Architecture

- `electron/` — main process: window, IPC handlers, binary parsers (`parsers/`), recent‑files store, updater.
- `src/` — React renderer: home screen, sidebar file tree, tabbed viewers.
- `shared/` — the typed IPC contract shared by both processes.
