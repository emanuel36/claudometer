# Contributing

## Install from source

1. Clone the repository and link it into your extensions folder as `claudometer@emanuel36`:
   ```bash
   git clone https://github.com/emanuel36/claudometer.git
   ln -s "$PWD/claudometer" ~/.local/share/gnome-shell/extensions/claudometer@emanuel36
   glib-compile-schemas claudometer/schemas
   ```
2. Restart GNOME Shell: log out and in, or on X11 press Alt+F2, type `r`, Enter. On GNOME 49
   and later, a nested shell avoids logging out: `dbus-run-session gnome-shell --devkit --wayland`.
3. Enable it: `gnome-extensions enable claudometer@emanuel36`.

GNOME Shell caches extension modules, so every code change needs a shell restart.

## Layout

| Path | What it holds |
|---|---|
| `extension.js`, `prefs.js` | Entry points GNOME loads: the extension and its preferences window |
| `metadata.json`, `stylesheet.css`, `schemas/` | Extension metadata, popup styles and settings schema |
| `src/indicator.js` | Top bar button and popup; wires the limits, the history and the tabs |
| `src/files.js` | Asynchronous file reads and saves shared by the shell-side modules |
| `src/topbar/` | Top bar values, colors and scales (pure), and the bar or ring drawn before the label |
| `src/popup/` | The tab bar, the Status, Projects, Activity and Models tabs, and the shared widgets |
| `src/limits/` | Reading the plan limits: the usage service client, its cache, states, backoff and texts |
| `src/sessions/` | Claude Code sessions: reading the session files, deriving done and seen, watching, and the click that focuses a Ghostty tab |
| `src/history/` | Claude Code history: transcript parsing, stats, the helper process that indexes the transcripts, reading its summary, CSV export |
| `src/prefs/` | Preference choices and folders, and the preferences window's rows and previews |
| `icons/` | The extension icon and the tab icons |
| `tests/` | Tests for the pure modules; `tests/shell/` loads the extension in each GNOME version |
| `package.json`, `eslint.config.js`, `.github/` | The linter and the CI workflow; not part of the extension |
| `docs/` | The design and the README mockups |
| `install.sh` | The one-command install from the README: downloads `main`, compiles the schema, enables the extension |

Modules with no GNOME Shell imports (`src/topbar/panel.js`, `src/limits/status.js`,
`src/limits/limits.js`, `src/limits/cache.js`, `src/sessions/sessions.js`,
`src/sessions/tracker.js`, `src/history/transcripts.js`, `src/history/stats.js`,
`src/history/indexer-core.js`, `src/history/export.js`, `src/prefs/config.js`) are pure, so they
run under plain `gjs` in tests.

The shell never reads transcripts itself: the helper process does (it can take a minute the
first time), and the shell only reads the small hourly summary, asynchronously.

## Tests

```bash
bash tests/run.sh
```

It prints one line per test file, and the failing checks of the first file that fails.

### Session click

The click on a session row needs a real desktop, so check it by hand after changing it:

1. On X11, open two Ghostty windows with several tabs each, and start Claude Code sessions in
   tabs of both windows. Leave one waiting for a permission and let another finish a turn.
2. Switch to a different tab or window, open the popup and click each session row.
3. The session's tab and its window come to the front. No notification banner shows, nothing
   is added to the message tray, and nothing appears in the terminal.
4. With Ghostty's desktop notifications turned off, the click only closes the popup.

## GNOME versions

```bash
bash tests/shell/run.sh          # every version in metadata.json
bash tests/shell/run.sh 50 51    # only some
```

For each GNOME version, it starts a headless GNOME Shell in a Fedora container (Docker is
needed) and loads the packed extension. It opens the popup on every tab, checks a fake waiting
session (the list, the dots, what counts as seen, and that unchanged rows are kept) and the
notification catcher (a notification carrying a focus token never reaches the message tray),
disables and enables the extension as a screen lock does, and opens the preferences. It fails on
any error either one logs. The extension reads a fake login, so it sends one request that the
usage service rejects.
Add a version to `metadata.json` only after it passes; a new one also needs its Fedora release
in `tests/shell/run.sh`.

## Lint

```bash
npm ci
npm run lint
```

`eslint.config.js` is the GJS config from the [GJS style guide](https://gjs.guide/guides/gjs/style-guide.html).
The Extension workflow runs the lint, the tests and the package check on every pull request.

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

With `-o <folder>`, the folder must exist first; `pack` crashes otherwise.

The zip must not contain `schemas/gschemas.compiled`; GNOME compiles the schema on install.

## Commits

- Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`…), imperative mood.
- Subject of at most 50 characters; body lines of at most 72, as one-line bullets saying what
  changed and why.
