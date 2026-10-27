# Status tab: Claude Code sessions in Claudometer

## Intent

The owner runs several Claude Code sessions at once, in several tabs and windows of the Ghostty
terminal, across different repositories. Sessions sit unnoticed while they wait for a permission,
wait for an answer, or finish their work. The goal is an overview of every session from the top
bar, so a session that needs the owner is seen, and reached in one click, as soon as it needs
them.

Existing tools were reviewed and rejected: claude-squad is tied to one repository, Claude Code's
own agent view lists only background sessions, and the GNOME extensions found (claude-lights,
gnome-claude-monitor) cover part of it with a different look. The owner chose to build it into
Claudometer rather than as a separate extension, in the calmest of four mocked-up variants
(variant A, tab name "Status", of `2026-10-27-status-tab-mockup.html` next to this document).

Claudometer's design (`docs/design.md`) gains a third question: **which of my sessions needs me
now?**

## Goals

- **The Limits tab becomes the Status tab:** renamed "Status", with a new icon (three rows, each
  a dot followed by a line; drawn in the mockup). It keeps the limits table exactly as today and
  adds a **SESSIONS** section below it. The other tabs do not change.
- **Only what needs the owner is listed:** sessions waiting for the owner, and sessions that
  finished a turn (Done). Every other session is counted in one summary line.
- **One click reaches the session:** clicking a row brings the exact Ghostty tab and window of
  that session to the front, whichever tab or window it is in.
- **A calm signal in the top bar:** a small accent dot on the gauge icon when something is new
  for the owner. No other change to the indicator.
- **No hooks, no conversations:** session states come only from the files Claude Code already
  keeps; nothing is added to Claude Code's settings, and no transcript is read.

## Non-goals

- Answering, approving or denying from the popup.
- Notifications, sounds, escalation, a global shortcut, previews of Claude's messages.
- Detecting API errors: a turn that ends in an error looks the same as a successful one
  (`idle`) in the session files. Doing it would need a hook. Out of scope.
- Focusing a tab in terminals other than Ghostty.
- **Focusing on Wayland, for now:** the click focuses the Ghostty tab only in X11 sessions (the
  owner's machine: GNOME 46, X11). On Wayland, raising a window without an activation token
  usually shows a "Ghostty is ready" banner instead, which the anti-goals forbid, so there the
  click takes the "anything else" path. Wayland focus is a later, separate piece of work.

## Anti-goals

- **Breaking the calm:** no new colors (the accent `#d97757` and the existing greys only), no
  alerts, nothing that moves or blinks.
- **Anything visible in the owner's terminal or on screen** caused by the click mechanism below:
  no characters in the terminal, no notification banner or tray entry, not even briefly.
- **Writing to Claude Code's files or settings.**
- **Losing state the owner has not seen** across a screen lock or a shell restart.

## The data

### Session files

Claude Code (2.1.308, read from its code) keeps one JSON file per running session in
`<claude dir>/sessions/<pid>.json`, where `<claude dir>` is the folder Claudometer already
resolves (the `claude-dir` setting, `CLAUDE_CONFIG_DIR`, or `~/.claude`). Fields used:

| Field | Use |
|---|---|
| `pid`, `procStart` | Identify the process; a file whose process is gone, or whose `procStart` no longer matches the process start time in `/proc/<pid>/stat`, is ignored (Claude Code does the same check) |
| `sessionId` | Stable identity of the session |
| `name` | Row name (for example `vehicle-k265-c9`) |
| `cwd` | Fallback name when `name` is missing: the folder name |
| `kind` | `interactive` (terminal sessions) and `bg` (background sessions) are listed; `daemon` and `daemon-worker` are Claude Code's own processes and are ignored *(my call)* |
| `spare` | Files with `spare: true` are pre-started processes and are ignored *(my call)* |
| `status` | `busy`, `shell`, `waiting` or `idle` |
| `waitingFor` | Set while `waiting`: `permission prompt` (also the default), `input needed`, `dialog open`, `sandbox request`, `goal proposal`, possibly others |
| `startedAt`, `statusUpdatedAt` | Epoch milliseconds; `statusUpdatedAt` changes with every status change |

`waiting` was observed live in interactive sessions: `waitingFor: permission prompt` on a Write
permission prompt, and `input needed` on a question from the AskUserQuestion tool.

### Session states

| State | From the file | Row label |
|---|---|---|
| Waiting | `status: waiting` | `Permission` for `permission prompt` and `sandbox request`; `Question` for `input needed`; `Waiting` for any other value |
| Working | `status: busy` or `shell` *(my call for `shell`)* | (summary line only) |
| Done | `status: idle`, after having been `busy` or `waiting` (see below) | `Done` |
| Idle | `status: idle`, not Done | (summary line only) |

**Done** has no field of its own; Claudometer derives it. A session becomes Done when its status
changes to `idle` from `busy`, `shell` or `waiting`. It stops being Done when the owner clicks its row, when
it leaves `idle`, or 30 minutes after it was *seen* (below). A session that has never run a turn
since it started is never Done. Done and seen state must survive a screen lock and a shell
restart (the extension is disabled and enabled on every lock); `statusUpdatedAt` lets a session
that went idle while the extension was off still be recognized as Done. How to persist it is left
to the builder.

### "New" and "seen"

- **New for the owner:** any Waiting session, or any Done session not yet seen.
- **Seen:** opening the popup marks every Done session listed at that moment as seen. Waiting
  sessions never become seen; they count as new for as long as they wait.
- A seen Done row stays listed, dimmed, for 30 minutes after it was seen, then leaves the list.

## Top bar

- The indicator is unchanged, except a 7px accent dot at the top right of the gauge icon,
  ringed by the top bar's background, while anything is new for the owner.
- When the icon is hidden (the "Show icon" setting is off), the dot sits after the label.
  *(Builder's call on the exact placement.)*

## Popup: the Status tab

The tab sits first, where Limits is today, labeled `Status`. While anything is new and another
tab is open, the Status tab shows the same accent dot on its icon.

Content, top to bottom:

1. The limits table, exactly as today, including its screen states (loading, offline, no login,
   etc.).
2. A row line, then the section header: `SESSIONS` on the left and, on the right,
   `2 WAITING FOR YOU` (the count of Waiting sessions plus Done sessions not seen) or
   `NOTHING WAITING`, in the header style.
3. One row per listed session, separated by row lines, in this order: Waiting (longest waiting
   first), Done not seen (most recent first), Done seen (most recent first). Each row, in the
   existing row style:
   - an 8px square marker with 2px corners: accent for Waiting and for Done not seen, dim grey
     `rgba(255,255,255,0.22)` for Done seen;
   - the name (`cm-name`), ellipsized;
   - the state label (`cm-sec`);
   - the time in that state (`cm-val`): `4m`, `1h 12m`, using the existing duration format.
4. A row line, then the summary in secondary text: `3 working · 1 idle`. With no session at all:
   `No Claude Code sessions`.

Times refresh while the popup is open. The section shows nothing of the conversations, paths
or tools.

### Clicking a row

- **Interactive session in Ghostty, in an X11 session:** brings that session's Ghostty tab and
  window to the front, closes the popup, and, if the session is Done, removes it from the list.
- **Anything else** (Wayland, background session, other terminal, or the click mechanism
  fails): marks the session as handled the same way and closes the popup, without focusing
  anything and without writing to any terminal.

## How the click reaches the right Ghostty tab

Tested on this machine (Ghostty 1.3.1, snap, GNOME 46, X11), each step confirmed:

- The window title cannot identify a session: with all sessions in one window, the title is the
  active tab's task summary, and `WINDOWID` is the same in every session's environment.
- Each Claude Code process has its own terminal: `/proc/<pid>/fd/0` → `/dev/pts/N`.
- Writing the desktop-notification sequence `ESC ] 9 ; <text> BEL` to that terminal makes Ghostty
  send `org.gtk.Notifications.AddNotification` with `default-action: app.present-surface` and
  `default-action-target: uint64 <surface id>`, the id of that tab.
- Calling `org.freedesktop.Application.ActivateAction("present-surface", [<uint64 id>], {})` on
  `com.mitchellh.ghostty` at `/com/mitchellh/ghostty` brought that tab and its window to the front
  from another tab (confirmed by the owner). An unknown id is accepted silently, so success
  cannot be read from the call.

So, on click:

1. Confirm the shell runs on X11 and the session runs in Ghostty (`TERM_PROGRAM=ghostty` in
   `/proc/<pid>/environ`).
2. If the surface id for that session is not known yet, write `ESC ] 9 ; <unique token> BEL` to
   its terminal, catch the matching Ghostty notification inside the shell before it is shown,
   discard it, and keep the surface id for that session (it stays valid while the session runs).
3. Call `present-surface` with the id.
4. If no notification arrives within about a second (Ghostty's desktop notifications turned off,
   for example), fall back to the "anything else" behavior.

Constraints on the mechanism:

- The caught notification must never reach the screen, the message tray or the notification
  list, on every GNOME version Claudometer supports (46 to 51). GNOME Shell hosts the
  `org.gtk.Notifications` service itself, so the interception happens in-process; the hook point
  is the builder's choice.
- File access stays asynchronous (`/proc` reads, the terminal write), per the EGO rules in
  `CLAUDE.md`. No new process is spawned; D-Bus calls are made from the shell.
- A cached surface id is dropped when its session's process ends.

## Settings

On the Popup page:

- **Sessions in the Status tab:** on (default) or off. Off hides the section and the top bar dot
  and stops watching the session files.
- **Keep seen results for:** 10, 30 (default) or 60 minutes.

The Status tab cannot be hidden, like Limits today. The stored last tab (`last-tab`, default
`'Limits'`) must keep working for existing users; the builder decides between a migration and
keeping the internal value.

## Constraints

- GNOME Shell 46 to 51, as on this branch's base: the branch `feat/status-tab` starts at
  `73634fd`, before the GNOME 42 to 45 port, and does not depend on it. The existing shell tests
  in `tests/shell/` must still pass on every version.
- Watching: the sessions folder is watched for changes (files appear, change and disappear); a
  modest periodic check catches processes that die without removing their file. Nothing polls
  while the setting is off.
- Pure logic (parsing a session file, deriving states, new/seen/expiry rules, row order and
  texts) goes into modules with no Shell imports, tested with plain `gjs` like the existing pure
  modules.
- Everything created in `enable()` is destroyed in `disable()`, including the notification
  interception.

## Docs to update

- `docs/design.md`: the third question, the dot, the Status tab and its section, the settings,
  the data source and the click mechanism.
- `docs/images/`: the Limits mockup becomes the Status mockup with a SESSIONS section, and
  `overview.svg` is rebuilt from it.
- `README.md`: the Privacy section says that Claudometer reads which Claude Code sessions are
  running and their state, never their conversations, and that clicking a session sends an
  invisible signal to its terminal to bring its tab to the front.

## Left to the builder

- Module layout, the persistence format for Done/seen, the notification hook point, the token
  format, and the exact refresh cadence.
- How the extension tests the click mechanism, given that the container shell tests have no
  Ghostty: at least a manual test on this machine with sessions in two windows and several tabs.
