# GNOME 42 to 51 support, tested on Ubuntu

## Intent

A teammate on Ubuntu 22.04 (GNOME Shell 42.9, X11) installed Claudometer and nothing appeared:
the shell marks the extension `OUT OF DATE` because `metadata.json` lists 46 to 51 only. The goal
is that Claudometer works on every GNOME version shipped by an Ubuntu release from 22.04 on, and
that each of those versions is proven by a test before anyone is told to install it.

Support for 42 to 44 is meant to be temporary. Everything it needs lives in parts that can be
deleted later, leaving 45 and newer.

## Goals

- **Every GNOME from 42 to 51 works:** the top bar indicator, the popup with all its tabs, the
  limits request, the history helper and the preferences behave the same on every version.
- **Tested on Ubuntu, one release per GNOME version:**

  | Ubuntu | GNOME | Ubuntu | GNOME |
  |---|---|---|---|
  | 22.04 | 42 | 24.10 | 47 |
  | 22.10 | 43 | 25.04 | 48 |
  | 23.04 | 44 | 25.10 | 49 |
  | 23.10 | 45 | 26.04 | 50 |
  | 24.04 | 46 | 26.10 | 51 |

  Releases past their end of life get their packages from `old-releases.ubuntu.com`. The Fedora
  containers are removed.
- **The installer refuses unsupported systems:** before downloading, `install.sh` checks that
  GNOME Shell is installed and that its major version is between 42 and 51. Otherwise it exits
  with a clear message and installs nothing. Versions above 51 are refused until they pass the
  tests and are added.
- **42 to 44 are converted at install time:** on those versions `install.sh` runs a converter
  that rewrites the downloaded copy into the pre-45 extension format. From 45 on, the converter
  is not called.
- **Removable later:** dropping 42 to 44 means deleting the converter folder, the installer
  block that calls it, the compatibility code (see below) and the 42 to 44 test entries.

## Non-goals

- **extensions.gnome.org for 42 to 44:** users of those versions install with the script only.
  The package uploaded to extensions.gnome.org covers 45 to 51.
- **A second copy of the source:** there is one source, in the current (ES module) format.
- **Running the shell tests in CI:** they stay a local command, as today.
- **Identical looks on old versions:** "behave the same" means behavior. The shell theme of each
  version decides the look, and the tests do not compare screenshots. *(the owner said proceed)*

## Anti-goals

- **Cutting a feature on old versions without asking:** if some part cannot behave the same on
  an old version, the builder stops and asks the owner before dropping or changing it.
- **A version listed without a passing test:** a GNOME version enters `metadata.json`, the
  converter output or the installer range only after its container test passes.

## Facts checked

- `ubuntu:22.04` with `gnome-shell` installed: GNOME Shell 42.9, gjs 1.72.4, GTK 4.6.9,
  libadwaita 1.1.7, and only libsoup 2.4 (no Soup 3 typelib). `gnome-shell --help` lists
  `--headless`, `--wayland` and `--virtual-monitor`, the options the current test uses.
- Docker Hub has images for every Ubuntu release in the table above.
- The shell process of GNOME 42 already loads Soup 2.4; loading Soup 3 in the same process
  aborts it. The usage client (`src/limits/usage-client.js`) uses Soup 3 today.
- The preferences use `Adw.SwitchRow` (libadwaita 1.4), `Adw.AlertDialog` (1.5),
  `Gtk.FileDialog` and `Gtk.UriLauncher` (GTK 4.10), which older releases lack.
- The history helper runs as `gjs -m`, which gjs 1.72 supports, so it can stay an ES module on
  every version.

## Design

### Converter

- **Its own folder** (e.g. `legacy/`), written in GJS, since every GNOME system has `gjs`; the
  installer gains no dependency.
- **Input and output:** takes the downloaded extension folder and converts the files the shell
  and the preferences load: ES `import`/`export` become `imports.gi`, `imports.ui` /
  `imports.misc` and `Me.imports`; the `Extension` and `ExtensionPreferences` entry points
  become the pre-45 `init()` form; `metadata.json` gets `shell-version` 42 to 44.
- **The helper keeps ES modules:** modules the helper process imports must remain loadable by
  `gjs -m` after conversion.
- **Unit tests** for the converter under plain gjs, next to the existing ones in `tests/`.
- **A lint rule** limits the source to the import and export forms the converter handles, so new
  syntax fails the lint before it reaches a 42 container.

### Compatibility code

- **42 to 44 only, in the converter's folder:** the Soup 2.4 version of the usage request and
  the equivalents of the newer GTK and libadwaita widgets in the preferences live next to the
  converter, which swaps them in on install. The package for 45 to 51 (and the one uploaded to
  extensions.gnome.org) carries no legacy code. *(builder's call)*
- **GNOME 45 in the main source:** GNOME 45 is never converted, and its libadwaita (1.4) lacks
  `Adw.AlertDialog`. The preferences fall back to `Adw.MessageDialog` when `Adw.AlertDialog` is
  missing. This fallback stays until 45 is dropped. *(the owner said proceed with this
  recommendation)*
- **Shared modules:** the shell and the history helper both load some modules (e.g.
  `src/history/stats.js`, `src/history/transcripts.js`). The converter writes converted copies
  next to the originals and never rewrites a module the helper imports. *(builder's call)*

### Installer

- Version check before download, as described in the goals.
- On 42 to 44, run the converter on the staged copy before it replaces the installed one.
- The rest of the current flow (stage, compile schemas, enable, restart hint) stays.

### Tests

- `tests/shell/run.sh` maps each GNOME version to its Ubuntu release and builds one image per
  release from an Ubuntu `Containerfile`.
- In every container the extension is installed by `install.sh` itself, from a tarball of the
  working tree (the script already reads `CLAUDOMETER_URL`), so the installer and, on 42 to 44,
  the converter run exactly as they do for a user.
- The checks stay as today: popup on every tab, disable and enable, preferences, no errors
  logged by the shell or the preferences.
- An installer check: with GNOME Shell missing, or reporting a version outside 42 to 51, the
  script exits non-zero and leaves nothing installed.

### Docs

README: supported systems become GNOME 42 to 51 (Ubuntu 22.04 and newer). CONTRIBUTING: the
Ubuntu containers, the converter and how to remove 42 to 44 support.

## Acceptance

1. `bash tests/shell/run.sh` passes for all ten versions.
2. Unit tests and lint pass.
3. After the merge to `main` (nothing is pushed before), the teammate on Ubuntu 22.04
   installs with the script and sees the indicator after restarting the shell on X11. The
   containers run headless Wayland, so X11 is covered here.

## Left to the builder

- Converter internals and file layout inside its folder.
- How the compatibility code detects each feature and which older widgets replace the newer
  ones, as long as the preferences behave the same.
- The Ubuntu `Containerfile` details, including the `old-releases` switch.
