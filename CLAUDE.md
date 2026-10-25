# Claudometer

GNOME Shell extension (GNOME 46, X11 here). Developer notes are in CONTRIBUTING.md: layout,
tests, logs and packaging. The README is for users: no internals, and no code beyond the
install commands.

- The installed copy is a symlink to this repo
  (`~/.local/share/gnome-shell/extensions/claudometer@emanuel36`), so the checked-out branch is
  what runs. Restarting the shell many times in a row makes the usage service answer 429.
- `docs/design.md` describes the look and behavior, and the mockups in `docs/images/` show it
  with made-up data; update both when the look changes.
- EGO rules to keep: no synchronous file IO in the shell process, everything created in
  `enable()` is destroyed in `disable()`, the helper process is the only one spawned and is
  written in GJS, no `gschemas.compiled` in the zip.

## Git

- Identity is set in this repo's local config (emanuel36, GitHub noreply email).
- Every code change on a `<type>/<topic>` branch, merged with `git merge --no-ff` only when
  asked; docs-only changes may go straight to `main`. Never push unless asked.
- Fold fixes into the commit they belong to before merging.
