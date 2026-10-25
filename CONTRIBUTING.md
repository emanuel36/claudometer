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

## Logs

```bash
journalctl --user -b | grep -i claudometer
```

## Package

```bash
gnome-extensions pack --force --extra-source=src --extra-source=icons
```

The zip must not contain `schemas/gschemas.compiled`; GNOME compiles the schema on install.

## Commits

- Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`…), imperative mood.
- Subject of at most 50 characters; body lines of at most 72, as one-line bullets saying what
  changed and why.
