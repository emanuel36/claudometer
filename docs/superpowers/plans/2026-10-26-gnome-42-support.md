# GNOME 42 to 51 Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claudometer installs and works on every GNOME Shell from 42 to 51, each version proven
by a headless shell test in the Ubuntu release that shipped it.

**Architecture:** The source stays in ES modules for GNOME 45+. Two small seams
(`src/limits/http.js`, `src/prefs/toolkit.js`) hold every API that differs on older versions.
For 42 to 44, `install.sh` runs a GJS converter (`legacy/`) that rewrites the shell and
preferences code into the pre-45 module format, swapping in older-API versions of the two seams.
The history helper keeps running the untouched ES modules under `gjs -m`.

**Tech Stack:** GJS, GNOME Shell extension API (pre-45 and 45+), GTK 4 / libadwaita, libsoup
2.4 and 3, POSIX `sh`, Docker with `ubuntu:*` images.

**Spec:** `docs/superpowers/specs/2026-10-26-gnome-42-support-design.md`

## Global Constraints

- Supported GNOME Shell majors: 42 to 51. Converted (legacy) versions: 42, 43, 44.
- GNOME to Ubuntu image: 42→22.04, 43→22.10, 44→23.04, 45→23.10, 46→24.04, 47→24.10,
  48→25.04, 49→25.10, 50→26.04, 51→26.10.
- A version enters `metadata.json`, the converter output or the installer range only after its
  container test passes.
- No synchronous file IO in the shell process; everything created in `enable()` is destroyed in
  `disable()`; the helper is the only process the extension spawns; no `gschemas.compiled` in
  the zip (CLAUDE.md).
- The package built by `gnome-extensions pack` (extensions.gnome.org) carries no legacy code.
- 100-character lines; match the surrounding code's comment density and Google-style docstrings
  (`Args:` / `Returns:`) on public functions.
- Work on branch `feat/gnome-42-support`. Conventional Commits, subject ≤ 50 characters, body as
  one-line bullets, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  Never push.
- Before each commit: `npm run lint` and `bash tests/run.sh` pass, plus the task's shell test.

## Review Focus

1. **Ubuntu 22.04 with the Soup 3 typelib also installed:** the legacy usage request must use
   the Soup the shell already loaded (2.4 on 42) and never load a second one, which aborts the
   shell. Pinned by installing `gir1.2-soup-3.0` in the 22.04 image (Task 6).
2. **`gnome-shell --version` printing a warning line before the version:** the installer must
   still read the version. Pinned in `check-install.sh` (Task 2).
3. **Unreadable version output:** the installer refuses with a clear message instead of guessing.
   Pinned in `check-install.sh` (Task 2).
4. **New syntax the converter does not know:** fails the lint, and the converter itself throws
   instead of writing a broken module. Pinned by the lint rule and a converter test (Task 4).
5. **Preferences widgets missing on a version:** each toolkit seam function is exercised under
   that version's real GTK and libadwaita. Pinned by `toolkit-check.js` (Tasks 3 and 6). Not
   covered: the file chooser and the browser launch, which need a person to finish them.

---

### Task 1: Test on Ubuntu instead of Fedora, installing with install.sh

**Files:**
- Modify: `tests/shell/Containerfile`
- Modify: `tests/shell/run.sh`
- Modify: `tests/shell/check.sh:12-26`
- Modify: `CONTRIBUTING.md:51-63`

**Interfaces:**
- Produces: `tests/shell/run.sh [versions…]` builds `claudometer-shell:<version>` from
  `ubuntu:<release>`, packs the working tree as `/work/claudometer.tar.gz` (top folder
  `claudometer-main/`, without `.git`, `node_modules`, `dist`), mounts `/work` read-only and runs
  `check.sh`. The `UBUNTU` map in `run.sh` is the single list of tested versions; the default run
  is every key of it.
- Produces: inside the container, the extension is installed by
  `CLAUDOMETER_URL=file:///work/claudometer.tar.gz sh /work/install.sh`.

- [ ] **Step 1: Create the branch**

Run: `git switch -c feat/gnome-42-support`

- [ ] **Step 2: Rewrite `Containerfile` for Ubuntu**

`ARG BASE=ubuntu:24.04`. With `DEBIAN_FRONTEND=noninteractive` and `--no-install-recommends`,
install `gnome-shell gnome-shell-extension-prefs gjs libglib2.0-bin dbus xwayland
libgl1-mesa-dri ca-certificates curl`, and `unzip` only if `check.sh` still needs it. If
`apt-get update` fails (release past end of life), point every `archive.ubuntu.com` and
`security.ubuntu.com` entry in `/etc/apt/sources.list` and `/etc/apt/sources.list.d/*` to
`old-releases.ubuntu.com` and retry. Keep the `/tmp/.X11-unix` folder and the `tester` user.

- [ ] **Step 3: Map versions to Ubuntu in `run.sh`**

`declare -A UBUNTU=([46]=24.04 [47]=24.10 [48]=25.04 [49]=25.10 [50]=26.04 [51]=26.10)`; the
default version list is the sorted keys of `UBUNTU` instead of `metadata.json`. Replace the
`gnome-extensions pack` step with the tarball described above, and copy `install.sh` into the
work folder.

- [ ] **Step 4: Install through `install.sh` in `check.sh`**

Replace the unzip, the `glib-compile-schemas` call and the `enabled-extensions` line with the
`install.sh` call above. Remove `disable-extension-version-validation`: the shell must now accept
the version listed in `metadata.json`, which is the failure the Ubuntu 22.04 user hit. Keep the
keyfile backend, the fake login and the input-source line.

- [ ] **Step 5: Run the shell tests**

Run: `bash tests/shell/run.sh`
Expected: `PASS` for 46 to 51 and no `Failed:` line.

- [ ] **Step 6: Update CONTRIBUTING**

In "GNOME versions": Ubuntu containers, one release per GNOME version (list the map), installed
through `install.sh`, end-of-life releases from `old-releases`; a new version needs its Ubuntu
release in `tests/shell/run.sh`.

- [ ] **Step 7: Commit**

```bash
git add tests/shell CONTRIBUTING.md
git commit -m "test: run the shell tests on Ubuntu"
```

---

### Task 2: Installer refuses unsupported GNOME versions

**Files:**
- Modify: `install.sh:5-21`
- Create: `tests/shell/check-install.sh`
- Modify: `tests/shell/run.sh`

**Interfaces:**
- Produces: in `install.sh`, `MIN_SHELL=46`, `MAX_SHELL=51` (Task 3 lowers `MIN_SHELL` to 45,
  Task 6 to 42),
  and the variable `shell_major` holding the detected major version, set before any download.
- Produces: `tests/shell/check-install.sh`, run by `run.sh` in every container before `check.sh`.

- [ ] **Step 1: Write the failing installer checks**

`check-install.sh` runs `install.sh` with a fake `gnome-shell` first on `PATH` (a script that
prints the given text), `CLAUDOMETER_URL=file:///nonexistent.tar.gz`, and a temporary `HOME` and
`XDG_DATA_HOME`. Each case asserts the exit status, a fragment of stderr and that no extension
folder was created:

| Case | Fake output | Expect |
|---|---|---|
| `too old` | `GNOME Shell 41.0` | exit ≠ 0, stderr has `GNOME Shell 41 is not supported` |
| `too new` | `GNOME Shell 52.0` | exit ≠ 0, stderr has `GNOME Shell 52 is not supported` |
| `unreadable` | `something else` | exit ≠ 0, stderr has `Cannot tell the GNOME Shell version` |
| `missing` | no `gnome-shell` on `PATH` | exit ≠ 0, stderr has `GNOME Shell was not found` |
| `warning first` | `warning: x` then `GNOME Shell 46.0` | exit ≠ 0, stderr has no `not supported` and no `Cannot tell` (it got past the check and failed on the download) |

For `missing`, `PATH` holds only a folder with links to `sh`, `sed`, `cat` and `mktemp`.
Prints `ok   <case>` / `FAIL <case>`, exits 1 on any failure.

- [ ] **Step 2: Run it to see it fail**

Run: `bash tests/shell/run.sh 46`
Expected: `FAIL too old`, `FAIL too new`, `FAIL unreadable`, `FAIL missing`.

- [ ] **Step 3: Add the version check to `install.sh`**

First thing after `fail()`, before the tool check: refuse when `gnome-shell` is not on `PATH`;
take the first line of `gnome-shell --version 2>/dev/null` that matches
`GNOME Shell <digits>` and keep its major; refuse when there is none; refuse when it is outside
`MIN_SHELL`..`MAX_SHELL`. Exact messages:
- `GNOME Shell was not found. Claudometer is a GNOME Shell extension.`
- `Cannot tell the GNOME Shell version from: <output>`
- `GNOME Shell <major> is not supported; Claudometer needs GNOME Shell <MIN_SHELL> to <MAX_SHELL>.`

- [ ] **Step 4: Run the shell tests**

Run: `bash tests/shell/run.sh`
Expected: every `check-install.sh` case `ok`, and `PASS` for 46 to 51.

- [ ] **Step 5: Commit**

```bash
git add install.sh tests/shell
git commit -m "feat: refuse unsupported GNOME versions"
```

---

### Task 3: Preferences toolkit seam, and GNOME 45

**Files:**
- Create: `src/prefs/toolkit.js`
- Modify: `prefs.js` (`switchRow`, `tabsRow`, `keepRows`, `_rebuild`, `_export`, `_aboutPage`)
- Modify: `src/prefs/prefs-widgets.js:32-40` (`addCss`)
- Modify: `metadata.json` (`shell-version` gains `"45"`)
- Create: `tests/shell/toolkit-check.js`
- Modify: `tests/shell/check.sh`, `tests/shell/run.sh` (`[45]=23.10`)
- Modify: `install.sh` (`MIN_SHELL=45`)
- Modify: `README.md:15` (GNOME Shell 45 to 51, until Task 6)

**Interfaces:**
- Produces, all in `src/prefs/toolkit.js`, the only place the preferences touch these APIs:
  - `switchRow({title, subtitle = null})` → `{row, toggle}`: `row` goes in a group or expander;
    `toggle` has a boolean `active` property that can be bound and emits `notify::active`. On 45+
    both are the same `Adw.SwitchRow`.
  - `confirm(window, {heading, body, cancelLabel, confirmLabel}, onConfirm)` → the dialog
    object; `onConfirm()` runs only when the confirm button is chosen. `Adw.AlertDialog` when it
    exists, else `Adw.MessageDialog` (GNOME 45), with the confirm response styled as suggested.
  - `chooseSaveFile(window, initialName)` → `Promise<Gio.File|null>`, null when dismissed.
  - `openUri(window, uri)` → `undefined`.
  - `loadCss(provider, css)` → `undefined`.
  - `toast(window, title)` → `undefined`, plain text, never markup.

- [ ] **Step 1: Write the failing toolkit check**

`tests/shell/toolkit-check.js`, run as `gjs -m toolkit-check.js <extensionDir>` on the headless
shell's Wayland display. It loads `<extensionDir>/src/prefs/toolkit.js` by dynamic import, makes
an `Adw.PreferencesWindow`, and checks, printing `ok`/`FAIL` per line and exiting 1 on a failure:
- `switchRow({title: 'T'})`: setting `toggle.active = true` emits `notify::active` once and reads
  back `true`; adding `row` to an `Adw.PreferencesGroup` does not throw.
- `confirm(window, {...}, onConfirm)`: presenting does not throw; making the returned dialog
  answer the confirm response calls `onConfirm` once, the cancel response never.
- `loadCss(new Gtk.CssProvider(), '.x {color: red;}')` and `toast(window, 'a & b')` do not throw.

`check.sh` runs it after the preferences check, with `WAYLAND_DISPLAY=wayland-0`, and fails the
run on a non-zero exit.

- [ ] **Step 2: Run it to see it fail**

Run: `bash tests/shell/run.sh 46`
Expected: the toolkit check fails to import `src/prefs/toolkit.js`.

- [ ] **Step 3: Implement `src/prefs/toolkit.js` and move the callers to it**

`prefs.js` and `prefs-widgets.js` keep their behavior on 46+: same labels (`Cancel` / `Rebuild`,
the existing heading and body), same toasts, same widgets.

- [ ] **Step 4: Run the shell tests, 45 included**

Add `[45]=23.10` to `run.sh` and `"45"` to `metadata.json`.
Run: `bash tests/shell/run.sh`
Expected: `PASS` for 45 to 51, the toolkit check `ok` on each.

- [ ] **Step 5: Open the installer to 45 and update the README**

Only after Step 4 passes: `MIN_SHELL=45` in `install.sh`; README says GNOME Shell 45 to 51.

- [ ] **Step 6: Commit**

```bash
git add src/prefs prefs.js metadata.json install.sh tests/shell README.md
git commit -m "feat: support GNOME 45"
```

---

### Task 4: Module converter

**Files:**
- Create: `legacy/convert.js`
- Create: `tests/convert.test.js`
- Modify: `eslint.config.js`

**Interfaces:**
- Produces: `convertModule(text, file)` → `string`, in `legacy/convert.js`. `file` is the module's
  path relative to the extension root (`'extension.js'`, `'prefs.js'`, `'src/limits/cache.js'`).
  Throws `Error` naming `file` when an `import` or `export` statement is left after conversion.
- Produces: the lint rule that keeps `extension.js`, `prefs.js`, `src/**` and
  `legacy/overrides/**` within the forms below.

Conversion table (relative paths resolve from `file`'s folder; `src/<rest>` maps to the
`src-legacy` tree, path segments with characters other than letters, digits and `_` use brackets):

| ES module form | Pre-45 form |
|---|---|
| `import X from 'gi://Name'` | `const X = imports.gi.Name;` |
| `import X from 'gi://Name?version=V'` | `imports.gi.versions.Name = 'V';` then as above |
| `import X from 'cairo'` / `'system'` | `const X = imports.cairo;` / `imports.system` |
| `import * as M from 'resource:///org/gnome/shell/ui/<n>.js'` | `const M = imports.ui.<n>;` (same for `misc/`) |
| `import {Extension} from '…/extensions/extension.js'`, `import {ExtensionPreferences} from '…/extensions/prefs.js'` | `const {…} = Me.imports['src-legacy'].shim;` |
| `import {A, B} from './src/limits/usage-client.js'` (single or multi-line) | `const {A, B} = Me.imports['src-legacy'].limits['usage-client'];` |
| `export function f` | `function f` |
| `export const X =` / `export let X =` | `var X =` |
| `export class X` | `var X = class X` |
| `export default class X` | `class X` |

When any `Me.imports` is emitted, the module starts with
`const Me = imports.misc.extensionUtils.getCurrentExtension();`. For `file === 'extension.js'`,
append `function init(meta) { return new X(meta.metadata); }` (X is the default-exported class).
For `'prefs.js'`, append `function init() {}` and
`function fillPreferencesWindow(window) { new X(Me.metadata).fillPreferencesWindow(window); }`.

- [ ] **Step 1: Write the failing tests**

`tests/convert.test.js`, in the style of `tests/limits.test.js` (`check(name, actual, expected)`):
- one test per row of the table above, asserting the exact output line;
- `relative import from src/popup/views.js` resolves `'../history/stats.js'` to
  `Me.imports['src-legacy'].history.stats`;
- `Me line only when needed`: a module with only `gi://` imports has no `Me` line;
- `extension entry`: `export default class Ext extends Extension {}` as `'extension.js'` ends
  with `function init(meta) { return new Ext(meta.metadata); }`;
- `prefs entry`: the same for `'prefs.js'` with `init` and `fillPreferencesWindow`;
- `unknown syntax throws`: `export {a};` throws an `Error` whose message contains the file name;
- `the real tree`: every `.js` under `src/` plus `extension.js` and `prefs.js` converts without
  throwing, the output has no line starting with `import ` or `export `, and
  `new Function(output)` compiles it.

- [ ] **Step 2: Run them to see them fail**

Run: `gjs -m tests/convert.test.js`
Expected: fails to import `../legacy/convert.js`.

- [ ] **Step 3: Implement `convertModule` in `legacy/convert.js`**

Text rewriting with regular expressions over the whole file (imports may span lines); no parser
dependency.

- [ ] **Step 4: Run the tests**

Run: `bash tests/run.sh`
Expected: `ok    tests/convert.test.js` and every other file `ok`.

- [ ] **Step 5: Add the lint rule**

A config block with `files: ['extension.js', 'prefs.js', 'src/**/*.js', 'legacy/overrides/**/*.js']`
whose `no-restricted-syntax` repeats the existing `_init` selector (a later block replaces the
whole rule) and adds, each with a message pointing at `legacy/convert.js`:
`ExportAllDeclaration`, `ExportNamedDeclaration[source]`,
`ExportNamedDeclaration[declaration=null]`, `ImportExpression`,
`ExportDefaultDeclaration[declaration.type!="ClassDeclaration"]`,
`ImportSpecifier[imported.name!=local.name]`.

- [ ] **Step 6: Run the lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add legacy/convert.js tests/convert.test.js eslint.config.js
git commit -m "feat: convert modules to the pre-45 format"
```

---

### Task 5: HTTP seam for the usage request

**Files:**
- Create: `src/limits/http.js`
- Modify: `src/limits/usage-client.js:3,45-48,189-218,254-284,308-309`

**Interfaces:**
- Produces, in `src/limits/http.js`, the only module that imports Soup:
  - `createSession({timeoutSeconds, userAgent})` → session object.
  - `getUrl(session, url, headers, callback)`: `headers` is `[[name, value], …]`; always a new
    connection (today's `NEW_CONNECTION` flag and its comment move here). `callback(error,
    response)`: `error` is an `Error` when the request did not complete (network, TLS, timeout),
    else `null` and `response` is `{status: number, retryAfter: string|null, body: Uint8Array}`.
  - `abortSession(session)`.
- Consumes: nothing new; `UsageClient` keeps its public interface.

- [ ] **Step 1: Move the Soup calls behind the seam**

`UsageClient` builds its session with `createSession`, requests with `getUrl` and aborts with
`abortSession`; `_handleResponse(response, token)` reads `status`, `retryAfter` and `body`.
States, backoff, cache and log messages stay the same.

- [ ] **Step 2: Run the unit tests and lint**

Run: `bash tests/run.sh && npm run lint`
Expected: all `ok`, no lint errors.

- [ ] **Step 3: Run the shell tests**

Run: `bash tests/shell/run.sh`
Expected: `PASS` for 45 to 51; each run still writes the usage cache after the rejected request.

- [ ] **Step 4: Commit**

```bash
git add src/limits
git commit -m "refactor: isolate the usage request from Soup"
```

---

### Task 6: GNOME 42 to 44 through the converter

**Files:**
- Modify: `legacy/convert.js` (add `convertExtension`)
- Create: `legacy/main.js`
- Create: `legacy/shim.js`
- Create: `legacy/overrides/src/limits/http.js`
- Create: `legacy/overrides/src/prefs/toolkit.js`
- Modify: `install.sh` (convert on 42 to 44, `MIN_SHELL=42`, `gjs` required there)
- Modify: `tests/convert.test.js`
- Modify: `tests/shell/Containerfile`, `tests/shell/run.sh`, `tests/shell/toolkit-check.js`
- Modify: `README.md`, `CONTRIBUTING.md`

**Interfaces:**
- Consumes: `convertModule(text, file)` (Task 4); the `http.js` interface (Task 5); the
  `toolkit.js` interface (Task 3); `MIN_SHELL` / `shell_major` (Task 2).
- Produces: `convertExtension(extensionDir, legacyDir)` → `undefined`, in `legacy/convert.js`:
  - every `.js` under `<extensionDir>/src` is converted into `<extensionDir>/src-legacy/<same
    path below src>`, reading `<legacyDir>/overrides/src/<path>` instead when it exists; `src/`
    itself is left untouched for the helper;
  - `extension.js` and `prefs.js` are converted in place;
  - `<legacyDir>/shim.js` is copied to `<extensionDir>/src-legacy/shim.js`;
  - `metadata.json` gets `"shell-version": ["42", "43", "44"]`;
  - an override with no matching file under `src/` throws.
- Produces: `gjs -m legacy/main.js <extensionDir>` runs `convertExtension` with the script's own
  folder as `legacyDir`; prints the error and exits 1 on failure.
- Produces: `legacy/shim.js`, written directly in the pre-45 format: `var Extension` and
  `var ExtensionPreferences` (the same class) whose constructor takes the metadata and sets
  `metadata`, `uuid` and `path`, with `getSettings()` → `ExtensionUtils.getSettings()` and
  `openPreferences()` → `ExtensionUtils.openPrefs()`.

- [ ] **Step 1: Write the failing converter tests**

In `tests/convert.test.js`, on a temporary copy of the repository's `extension.js`, `prefs.js`,
`metadata.json` and `src/`:
- `convertExtension writes src-legacy`: `src-legacy/limits/usage-client.js` exists and contains
  no `import ` line; `src/limits/usage-client.js` is byte-identical to the original;
- `overrides win`: `src-legacy/limits/http.js` comes from `legacy/overrides/src/limits/http.js`;
- `shim copied` and `metadata versions`: `["42","43","44"]`;
- `stale override throws`: an override for `src/nope.js` throws.

- [ ] **Step 2: Run them to see them fail**

Run: `gjs -m tests/convert.test.js`
Expected: `convertExtension` is not exported.

- [ ] **Step 3: Implement `convertExtension`, `main.js` and `shim.js`**

Synchronous Gio file IO is fine here: the converter runs in the installer, not in the shell.

- [ ] **Step 4: Implement the overrides**

`legacy/overrides/src/limits/http.js`, same interface as Task 5: imports `gi://Soup` without a
version so it gets the Soup the shell already loaded, and branches on `Soup.MAJOR_VERSION`:
2 uses `Soup.Session.queue_message`, where a `status_code` below 100 is a transport failure and
becomes `error`; 3 uses the same calls as `src/limits/http.js`.

`legacy/overrides/src/prefs/toolkit.js`, same interface as Task 3, with the widgets of GTK 4.6
and libadwaita 1.1: `switchRow` is an `Adw.ActionRow` with a centered `Gtk.Switch` suffix as
`toggle`; `confirm` uses `Adw.MessageDialog` when it exists, else `Gtk.MessageDialog`;
`chooseSaveFile` uses `Gtk.FileChooserNative` in save mode; `openUri` uses `Gtk.show_uri`;
`loadCss` uses `load_from_data`; `toast` creates `Adw.Toast({title})` without `use_markup`.

- [ ] **Step 5: Run the unit tests and lint**

Run: `bash tests/run.sh && npm run lint`
Expected: all `ok`, no lint errors.

- [ ] **Step 6: Convert in the installer**

Set `MIN_SHELL=42`. When `shell_major` is 44 or lower, require `gjs`, and after the files are
moved into `$STAGE/$UUID` run `gjs -m "$STAGE/legacy/main.js" "$STAGE/$UUID"`, failing with
`Could not prepare Claudometer for GNOME Shell <major>.` when it exits non-zero.

- [ ] **Step 7: Add 42 to 44 to the shell tests**

`run.sh`: `[42]=22.04 [43]=22.10 [44]=23.04`. `Containerfile`: on 22.04 also install
`gir1.2-soup-3.0`, so the test proves the shell's own Soup 2.4 is used. `toolkit-check.js`: when
`<extensionDir>/src-legacy` exists, load the converted toolkit through
`imports.searchPath` and `imports['src-legacy'].prefs.toolkit` instead of the dynamic import.

- [ ] **Step 8: Run every version**

Run: `bash tests/shell/run.sh`
Expected: every `check-install.sh` case `ok`, `PASS` for 42 to 51, no `Failed:` line. On 42 the
log shows no Soup error and the usage cache is written. If some part cannot behave the same on
an old version, stop and ask the owner before changing or dropping it.

- [ ] **Step 9: Update the docs**

README: needs GNOME Shell 42 to 51 (Ubuntu 22.04 and newer); on 42 to 44, install with the
command (extensions.gnome.org covers 45 and newer). CONTRIBUTING: the `legacy/` folder, what the
installer does on 42 to 44, the lint rule, and how to drop 42 to 44: delete `legacy/`, the
installer's conversion block and `gjs` check, `tests/convert.test.js`, the 42 to 44 entries in
`run.sh`, the 22.04 extra package and the legacy branch of `toolkit-check.js`, and set
`MIN_SHELL=45`.

- [ ] **Step 10: Commit**

```bash
git add legacy install.sh tests README.md CONTRIBUTING.md
git commit -m "feat: support GNOME 42 to 44"
```

---

### Task 7: Hand-off check

- [ ] **Step 1: Full verification**

Run: `npm run lint && bash tests/run.sh && bash tests/shell/run.sh`
Expected: no lint errors, every unit test `ok`, `PASS` for 42 to 51.

- [ ] **Step 2: Package check**

Run: `mkdir -p dist && gnome-extensions pack --force --extra-source=src --extra-source=icons -o dist && unzip -l dist/*.zip`
Expected: no `legacy/`, no `src-legacy/`, no `gschemas.compiled`; `metadata.json` in the zip
lists 45 to 51.

- [ ] **Step 3: Report to the owner**

The branch is ready for review and merge on request. After the merge, the Ubuntu 22.04 user
installs with the command and confirms on X11 (spec, acceptance 3).
