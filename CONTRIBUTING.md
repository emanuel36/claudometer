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
| `src/topbar/` | Top bar values, colors and scales (pure), and the bar or ring drawn before the label |
| `src/popup/` | The tab bar, the Limits, Projects, Activity and Models tabs, and the shared widgets |
| `src/limits/` | Reading the plan limits: the usage service client, its cache, states, backoff and texts |
| `src/history/` | Claude Code history: transcript parsing, stats, the helper process that indexes the transcripts, reading its summary, CSV export |
| `src/prefs/` | Preference choices and folders, and the preferences window's rows and previews |
| `icons/` | The extension icon and the tab icons |
| `tests/` | Tests for the pure modules; `tests/shell/` loads the extension in each GNOME version |
| `package.json`, `eslint.config.js`, `.github/` | The linter and the CI workflow; not part of the extension |
| `docs/` | The design and the README mockups |
| `install.sh` | The one-command install from the README: downloads `main`, converts it on GNOME 42 to 44, compiles the schema, enables the extension |
| `legacy/` | The converter to the pre-45 extension format, and the modules that replace `src/` ones on GNOME 42 to 44; not part of the package |

Modules with no GNOME Shell imports (`src/topbar/panel.js`, `src/limits/status.js`,
`src/limits/limits.js`, `src/limits/cache.js`, `src/history/transcripts.js`,
`src/history/stats.js`, `src/history/indexer-core.js`, `src/history/export.js`,
`src/prefs/config.js`) are pure, so they run under plain `gjs` in tests.

The shell never reads transcripts itself: the helper process does (it can take a minute the
first time), and the shell only reads the small hourly summary, asynchronously.

## Tests

```bash
bash tests/run.sh
```

It prints one line per test file, and the failing checks of the first file that fails.

## GNOME versions

```bash
bash tests/shell/run.sh          # every version listed below
bash tests/shell/run.sh 50 51    # only some
```

For each GNOME version, it starts a headless GNOME Shell in an Ubuntu container (Docker is
needed), one release per version, and installs the extension with `install.sh` from a tarball of
the working tree. It opens the popup on every tab, disables and enables the extension as a
screen lock does, and opens the preferences. It fails on any error either one logs. The
extension reads a fake login, so it sends one request that the usage service rejects.

| GNOME | 42 | 43 | 44 | 45 | 46 | 47 | 48 | 49 | 50 | 51 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Ubuntu | 22.04 | 22.10 | 23.04 | 23.10 | 24.04 | 24.10 | 25.04 | 25.10 | 26.04 | 26.10 |

The releases past their end of life (22.10, 23.04, 23.10, 24.10, 25.04 and 25.10 today) are
fetched from `old-releases.ubuntu.com`. The 22.04 image also has Soup 3 installed, so the test
shows that the extension uses the Soup 2.4 that GNOME 42 loads. The shell accepts only the
versions in `metadata.json`, so add a version there only after it passes; a new one also needs
its Ubuntu release in the `UBUNTU` map in `tests/shell/run.sh`.

## GNOME 42 to 44

GNOME 45 changed the extension format to ES modules, so on 42 to 44 `install.sh` runs
`gjs -m legacy/main.js` on the downloaded copy before it replaces the installed one:

- Each module under `src/` is converted to the older format into `src-legacy/`, and `src/`
  stays as it is for the helper process, which runs as an ES module on every version.
- A module in `legacy/overrides/src/` takes the place of the one at the same path in `src/`:
  `limits/http.js` uses the Soup the shell has loaded (2.4 on GNOME 42), and
  `prefs/toolkit.js` uses the widgets of GTK 4.6 and libadwaita 1.1.
- `extension.js` and `prefs.js` are converted in place, with `legacy/shim.js` standing in for
  the `Extension` and `ExtensionPreferences` classes, and `metadata.json` lists 42 to 44.
- A module that fails to convert or to compile stops the install with an error.

The converter rewrites the source with regular expressions, so a lint rule limits
`extension.js`, `prefs.js`, `src/` and `legacy/overrides/` to the import and export forms it
handles. `tests/convert.test.js` runs it on the real tree.

To drop GNOME 42 to 44:

1. Delete `legacy/`, `tests/convert.test.js` and the `legacy/` lint blocks in
   `eslint.config.js`.
2. In `install.sh`, delete `LAST_LEGACY_SHELL`, the `gjs` check and the conversion block, and
   set `MIN_SHELL=45`.
3. Delete `icons/external-link-symbolic.svg`, which only GNOME 42 uses.
4. In the shell tests, delete the 42 to 44 entries in `run.sh`, the 22.04 extra package in
   `Containerfile`, the `src-legacy` branch of `toolkit-check.js` and the GNOME 42 and 43 log
   filters in `check.sh`.

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
