# Contributing

## Install from source

1. Clone the repository and link it into your extensions folder as `claudometer@emanuel36`:
   ```bash
   git clone https://github.com/emanuel36/claudometer.git
   ln -s "$PWD/claudometer" ~/.local/share/gnome-shell/extensions/claudometer@emanuel36
   glib-compile-schemas claudometer/schemas
   ```
2. Restart GNOME Shell: on X11 press Alt+F2, type `r`, Enter; on Wayland log out and in.
3. Enable it: `gnome-extensions enable claudometer@emanuel36`.

GNOME Shell caches extension modules, so every code change needs a shell restart.

## Layout

| Path | What it holds |
|---|---|
| `extension.js`, `prefs.js` | Entry points GNOME loads: the extension and its preferences window |
| `metadata.json`, `stylesheet.css`, `schemas/` | Extension metadata, popup styles and settings schema |
| `src/indicator.js` | Top bar button and popup; wires the limits, the history and the tabs |
| `src/topbar/` | Top bar values, colors and scales (pure), and the bar or ring drawn before the label |
| `src/popup/` | The tab bar, the Limits, Projects, Activity and Models tabs, and the shared widgets |
| `src/limits/` | Reading the plan limits: the usage service client, states, backoff and texts |
| `src/history/` | Claude Code history: transcript parsing, stats, the helper process that indexes the transcripts, reading its summary, CSV export |
| `src/prefs/` | Preference choices and folders, and the preferences window's rows and previews |
| `icons/` | The extension icon and the tab icons |
| `tests/` | Tests for the pure modules |
| `docs/` | The design and the README mockups |
| `install.sh` | The one-command install from the README: downloads `main`, compiles the schema, enables the extension |
| `packages/` | The VS Code extension and the CLI for Windows, macOS and Linux (see Editors and terminal) |
| `.github/workflows/` | The tests, under GJS on Linux and under Node on Linux, macOS and Windows |

Modules with no GNOME Shell imports (`src/topbar/panel.js`, `src/limits/status.js`,
`src/limits/limits.js`, `src/history/transcripts.js`, `src/history/stats.js`,
`src/history/indexer-core.js`, `src/history/export.js`, `src/prefs/config.js`) are pure, so
they run under plain `gjs` in tests.

The shell never reads transcripts itself: the helper process does (it can take a minute the
first time), and the shell only reads the small hourly summary, asynchronously.

## Tests

```bash
bash tests/run.sh
```

It prints one line per test file, and the failing checks of the first file that fails.

## README image

`docs/images/overview.svg` is built from the four tab mockups; rebuild it after changing one:

```bash
gjs -m docs/images/overview.js
```

## Logs

```bash
journalctl --user -b | grep -i claudometer
```

## Package

```bash
gnome-extensions pack --force --extra-source=src --extra-source=icons
```

The zip must not contain `schemas/gschemas.compiled`; GNOME compiles the schema on install.

## Editors and terminal

`packages/` holds the Node side: the VS Code extension and the CLI for Windows, macOS and
Linux. They reuse the pure modules of `src/` as they are, so the GNOME extension and the Node
packages count, name and color everything the same way.

| Path | What it holds |
|---|---|
| `packages/core/` | Data dir, Claude Code login (file, or the macOS Keychain), the usage client with a cache shared by every process, the history index run in a worker, and the view models of the tabs |
| `packages/core/src/cursor/` | The opt-in Cursor source: Cursor's database read-only, its usage API, the index of usage events with exact model ids, and the `stop` hook for Cursor CLI chats |
| `packages/cli/` | The `claudometer` command, its tables and Claude Code's status line, with its installer |
| `packages/vscode/` | The extension: status bar, the webview panel, settings and commands |
| `packages/scripts/` | Runs the GJS tests of `tests/` under Node, through a small `print` and `system` shim |

Every process shares one data dir (`%LOCALAPPDATA%\claudometer`,
`~/Library/Application Support/claudometer` or `$XDG_DATA_HOME/claudometer`; override it with
`CLAUDOMETER_DATA_DIR`). The usage cache there takes a lock and keeps 60 seconds between
requests, so the editors, the CLI and the status line together still ask the usage service
as rarely as one GNOME popup.

Projects come from the `cwd` of Claude Code's transcripts, and, for Cursor, from the
`conversationId` of each usage event matched with the composer's workspace in Cursor's
database. Only Cursor CLI chats need the hook, which logs `conversation_id` and the workspace
root to `cursor-conversations.jsonl`.

```bash
cd packages
npm ci
npm test            # the GJS tests under Node, then the core and CLI tests
npm run build       # cli/dist/claudometer.js and vscode/dist/
npm run package     # vscode/claudometer.vsix
```

The packages run on Node 18.17, but reading Cursor's database needs `node:sqlite` (Node 22.13
or later; Cursor itself has it) and the tests need Node 22. To try the extension without
installing it, run `code --extensionDevelopmentPath="$PWD/vscode"` (or `cursor …`) after a
build. Its warnings go to the Extension Host log in the Output panel.

## Commits

- Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`…), imperative mood.
- Subject of at most 50 characters; body lines of at most 72, as one-line bullets saying what
  changed and why.
