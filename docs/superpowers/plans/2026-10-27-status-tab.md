# Status tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the Limits tab to Status and add a SESSIONS section that lists the Claude Code
sessions waiting for the owner or done, with an accent dot in the top bar, and a click that
brings the session's Ghostty tab to the front on X11.

**Architecture:** Pure modules parse session files and derive Waiting/Done/seen and the rows
(`src/sessions/sessions.js`, `src/sessions/tracker.js`). A watcher reads `<claude dir>/sessions`
and `/proc` asynchronously and a monitor persists Done/seen in the extension's data folder
(`src/sessions/watcher.js`, `src/sessions/monitor.js`, Gio/GLib only, so they run under plain
gjs). The click writes an OSC 9 token to the session's pty, a notification catcher swallows
Ghostty's resulting `org.gtk.Notifications.AddNotification` inside the shell to learn the
surface id, and `present-surface` is activated on Ghostty over D-Bus
(`src/sessions/focus.js`, `src/sessions/catcher.js`).

**Tech Stack:** GJS ES modules, GNOME Shell 46–51 (St, Clutter, Gio, GLib, Meta,
`InjectionManager`), GSettings, plain `gjs` tests, ESLint, Docker shell tests.

**Spec:** `docs/superpowers/specs/2026-10-27-status-tab-design.md` (mockup: variant A of
`docs/superpowers/specs/2026-10-27-status-tab-mockup.html`).

## Global Constraints

- GNOME Shell 46 to 51; the existing shell tests in `tests/shell/` must pass on every version.
- No synchronous file IO in the shell process: `/proc` reads, session files, the state file and
  the terminal write are all `*_async`.
- No new process is spawned by the extension; D-Bus calls are made from the shell.
- Everything created in `enable()` is destroyed in `disable()`, including the notification
  interception (`InjectionManager.clear()`), monitors, timers and cancellables.
- Never write to Claude Code's files or settings; never read transcripts; never read the
  `*.key` files in the sessions folder (only names matching `^\d+\.json$` are opened).
- Colors: the accent `#d97757` and the existing greys only; nothing moves or blinks.
- Nothing visible on screen or in the terminal from the click mechanism: no banner, no tray
  entry, no characters.
- Copy is fixed by the spec: tab `Status`; header `SESSIONS`, `<n> WAITING FOR YOU`,
  `NOTHING WAITING`; labels `Permission`, `Question`, `Waiting`, `Done`; summary
  `<w> working · <i> idle`, `No Claude Code sessions`.
- 100-char lines, Google-style docstrings on non-trivial public APIs, repo import style
  (relative `./` and `../` imports, as every existing module and test uses).
- Commits: Conventional Commits, subject ≤ 50 chars, body of one-line bullets ≤ 72 chars, ending
  with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. All work on
  `feat/status-tab`; never push.
- Run before each commit: `bash tests/run.sh` and `npm run lint`.

## Review Focus

1. **The catcher is unavailable** (the hook point is missing on some GNOME version): the click
   must never write the OSC 9 sequence, or Ghostty's banner reaches the screen. Pinned in
   Task 6 (`focus.test.js`: no write, no `expect` call) and in the shell test (catcher available
   on every version).
2. **Ghostty's notification arrives after the 1 s timeout:** it must still be swallowed, not
   shown. Pinned in Task 6 (`TokenBook` keeps expired tokens for 60 s).
3. **A session file read mid-rewrite** (truncated JSON) or an unrelated file in the folder: the
   session must not drop out for one scan, which would reset its Done/seen record. Pinned in
   Task 4 (`watcher.test.js`: truncated rewrite keeps the previous session).
4. **Screen lock right after opening the popup:** the seen marks must survive. Pinned in
   Task 4 (`monitor.test.js`: `markSeen()` then `destroy()` at once, a new monitor reads the
   seen state); the save is not cancelled by `destroy()`.
5. **The session's stdin is not a pty** (a pipe or a redirected file): nothing is written to it.
   Pinned in Task 6 (`focus.test.js` with a child whose stdin is a pipe).

---

## File structure

| File | Responsibility |
|---|---|
| `src/sessions/sessions.js` (new, pure) | Parse a session file, `/proc/<pid>/stat`, `/proc/<pid>/environ`; state and label |
| `src/sessions/tracker.js` (new, pure) | Done/seen records, expiry, rows/header/summary, state file format |
| `src/sessions/watcher.js` (new, Gio) | Watch the sessions folder, check processes, report live sessions |
| `src/sessions/monitor.js` (new, Gio) | Own the watcher and the records; load/save the state file |
| `src/sessions/focus.js` (new, Gio) | `TokenBook` and `SessionFocus`: pty write, wait for surface id, `present-surface` |
| `src/sessions/catcher.js` (new, Shell) | Hook `AddNotificationAsync` and feed it to a `TokenBook` |
| `src/files.js` (new, Gio) | `saveText()` shared by the usage cache and the state file |
| `src/popup/sessions-view.js` (new, St) | The SESSIONS section |
| `src/limits/status.js` | Gains `formatDuration()`, used by `limitTimeText` and the rows |
| `src/popup/views.js` | Tab bar gains `setBadge(name, shown)` |
| `src/indicator.js` | Status tab, dots, monitor/focus lifecycle, row clicks |
| `src/prefs/config.js`, `prefs.js`, schema | Two settings, last-tab mapping, Status group |
| `icons/status-symbolic.svg` | Replaces `icons/limits-symbolic.svg` |
| `stylesheet.css` | Dots and session rows |
| `tests/sessions.test.js`, `tracker.test.js`, `watcher.test.js`, `monitor.test.js`, `focus.test.js` | New tests |
| `tests/shell/check.sh` | Status tab, a fake session, catcher check |
| `docs/design.md`, `docs/images/`, `README.md`, `CONTRIBUTING.md` | Docs |

Async tests (`watcher`, `monitor`, `focus`) use a `GLib.MainLoop` with a helper
`waitFor(predicate, timeoutMs = 5000)` that iterates the default main context until the
predicate holds or fails the test on timeout. They spawn `sleep 60` children with
`Gio.Subprocess` (tests may spawn; the extension may not) and read their start time
synchronously with `GLib.file_get_contents` (tests only). Each file uses the same `check`
helper and exit code as `tests/status.test.js`.

---

### Task 1: Parse session files

**Files:**
- Create: `src/sessions/sessions.js`
- Modify: `src/limits/status.js:127-148` (extract the countdown)
- Test: `tests/sessions.test.js`, `tests/status.test.js`

**Interfaces:**
- Produces:
  - `Session` = `{pid: number, procStart: string, sessionId: string, name: string,
    kind: 'interactive'|'bg', status: string, waitingFor: string|null, startedAt: number,
    statusUpdatedAt: number}`
  - `parseSession(text: string) -> Session|null`
  - `procStartFromStat(text: string) -> string|null`
  - `isGhostty(environ: string) -> boolean`
  - `sessionState(status: string) -> 'waiting'|'working'|'idle'`
  - `waitingLabel(waitingFor: string|null) -> 'Permission'|'Question'|'Waiting'`
  - `latestPerSession(sessions: Session[]) -> Session[]`
  - `formatDuration(minutes: number) -> string` in `src/limits/status.js`

- [ ] **Step 1: Write the failing tests** in `tests/sessions.test.js` and add to
  `tests/status.test.js`

```js
const FILE = {pid: 1198229, sessionId: '7bb6fcfe-66e0-4a96-a754-2101cd6cfb7b',
    cwd: '/home/u/workspace/vehicle.k265', startedAt: 1793113490361, procStart: '10037311',
    kind: 'interactive', name: 'vehicle-k265-c9', status: 'idle',
    statusUpdatedAt: 1793125544654, version: '2.1.308'};
const text = obj => JSON.stringify({...FILE, ...obj});

check('parses a session', parseSession(text({})), {pid: 1198229, procStart: '10037311',
    sessionId: FILE.sessionId, name: 'vehicle-k265-c9', kind: 'interactive', status: 'idle',
    waitingFor: null, startedAt: 1793113490361, statusUpdatedAt: 1793125544654});
check('name falls back to the folder', parseSession(text({name: undefined})).name,
    'vehicle.k265');
check('folder with a trailing slash', parseSession(text({name: '', cwd: '/a/claudometer/'}))
    .name, 'claudometer');
check('no name nor folder', parseSession(text({name: undefined, cwd: undefined})).name,
    '7bb6fcfe');
check('background session', parseSession(text({kind: 'bg'})).kind, 'bg');
check('kind missing means interactive', parseSession(text({kind: undefined})).kind,
    'interactive');
check('daemon ignored', parseSession(text({kind: 'daemon'})), null);
check('daemon worker ignored', parseSession(text({kind: 'daemon-worker'})), null);
check('spare ignored', parseSession(text({spare: true})), null);
check('waiting keeps waitingFor', parseSession(text({status: 'waiting',
    waitingFor: 'input needed'})).waitingFor, 'input needed');
check('numeric procStart', parseSession(text({procStart: 10037311})).procStart, '10037311');
check('invalid JSON', parseSession('{"pid": 12'), null);
check('pid as text', parseSession(text({pid: '12'})), null);
check('pid zero', parseSession(text({pid: 0})), null);
check('no sessionId', parseSession(text({sessionId: undefined})), null);
check('no procStart', parseSession(text({procStart: undefined})), null);
check('no statusUpdatedAt', parseSession(text({statusUpdatedAt: undefined})), null);
check('JSON that is not an object', parseSession('[1]'), null);

check('stat start time', procStartFromStat('1198229 (claude) S 985680 1198229 985675 34818 ' +
    '1198229 4194304 3341793 7627503 453 373601 31748 2702 6641 8247 20 0 25 0 10037311 ' +
    '5820071936 106580'), '10037311');
check('stat with ") " in the name', procStartFromStat('12 (a) b) S 1 2 3 4 5 6 7 8 9 10 11 ' +
    '12 13 14 15 16 17 18 777 9'), '777');
check('stat garbage', procStartFromStat('nonsense'), null);

check('ghostty', isGhostty('TERM=xterm-ghostty\0TERM_PROGRAM=ghostty\0'), true);
check('other terminal', isGhostty('TERM_PROGRAM=gnome-terminal\0'), false);
check('similar name', isGhostty('XTERM_PROGRAM=ghostty\0'), false);

check('state waiting', sessionState('waiting'), 'waiting');
check('state busy', sessionState('busy'), 'working');
check('state shell', sessionState('shell'), 'working');
check('state unknown counts as working', sessionState('compacting'), 'working');
check('state idle', sessionState('idle'), 'idle');

check('permission prompt', waitingLabel('permission prompt'), 'Permission');
check('sandbox request', waitingLabel('sandbox request'), 'Permission');
check('waitingFor missing is a permission prompt', waitingLabel(null), 'Permission');
check('input needed', waitingLabel('input needed'), 'Question');
check('dialog open', waitingLabel('dialog open'), 'Waiting');
check('goal proposal', waitingLabel('goal proposal'), 'Waiting');

const a = parseSession(text({pid: 1, statusUpdatedAt: 10}));
const b = parseSession(text({pid: 2, statusUpdatedAt: 20}));
check('same sessionId keeps the latest', latestPerSession([a, b]).map(s => s.pid), [2]);
```

```js
// tests/status.test.js
check('duration minutes', formatDuration(4), '4m');
check('duration zero', formatDuration(0), '0m');
check('duration hours', formatDuration(72), '1h 12m');
check('duration days', formatDuration(1500), '1d 1h');
```

- [ ] **Step 2: Run to verify they fail**

Run: `bash tests/run.sh`
Expected: FAIL on `tests/sessions.test.js` (module not found) or `formatDuration` not exported.

- [ ] **Step 3: Implement**

  - `src/sessions/sessions.js`, no `gi://` imports, header comment like `src/limits/status.js`.
    `parseSession` requires `pid` a positive integer, `sessionId` a non-empty string,
    `procStart` a string or number (stored as string), `startedAt` and `statusUpdatedAt`
    finite numbers, `status` a string; rejects `spare === true` and any `kind` other than
    `interactive`, `bg` or missing. `procStartFromStat` splits after the last `)` and takes
    field 22 (index 19 of the rest). `isGhostty` splits on `\0` and looks for the exact entry
    `TERM_PROGRAM=ghostty`.
  - `src/limits/status.js`: move the countdown at lines 141–147 into
    `export function formatDuration(minutes)` and call it from `limitTimeText`.

- [ ] **Step 4: Run to verify they pass**

Run: `bash tests/run.sh && npm run lint`
Expected: every line `ok`, lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/sessions/sessions.js src/limits/status.js tests/sessions.test.js tests/status.test.js
git commit -m "feat: parse Claude Code session files"
```

---

### Task 2: Done, seen and the rows

**Files:**
- Create: `src/sessions/tracker.js`
- Test: `tests/tracker.test.js`

**Interfaces:**
- Consumes: `Session`, `sessionState`, `waitingLabel` (Task 1); `formatDuration` (Task 1).
- Produces:
  - `Record` = `{state: 'waiting'|'working'|'idle', statusUpdatedAt: number, done: boolean,
    seenAt: number|null}`; records are a `Map<sessionId, Record>`, never mutated in place.
  - `STARTUP_GRACE_MS = 10000`
  - `reconcile(records, sessions: Session[], nowMs, keepMs) -> Map`
  - `markSeen(records, nowMs) -> Map`
  - `clearDone(records, sessionId) -> Map`
  - `listing(records, sessions, nowMs, freshSinceMs = Infinity) -> Listing`, with
    `Listing` = `{rows: [{sessionId, name, label, time, marker: 'accent'|'dim'}],
    header: string, summary: string, newCount: number}`
  - `serializeRecords(records) -> string`, `parseRecords(text) -> Map`

Rules (from the spec, decided here where it leaves room):
- A non-idle session: `{state, statusUpdatedAt, done: false, seenAt: null}`.
- An idle session with a record: unchanged when `statusUpdatedAt` is the same; otherwise
  `done: true, seenAt: null` (any status change that ends in idle went through a turn, since
  `statusUpdatedAt` changes with every status change).
- An idle session without a record (new to the extension, for example after it was off):
  Done only when `statusUpdatedAt - startedAt > STARTUP_GRACE_MS`, so a session that never ran a
  turn is never Done.
- Done with `seenAt` and `nowMs - seenAt >= keepMs` becomes `done: false`; the same
  `statusUpdatedAt` keeps it from coming back.
- Records of sessions not in `sessions` are dropped.
- `listing`: Waiting rows by `statusUpdatedAt` ascending, then Done unseen by `statusUpdatedAt`
  descending, then Done seen descending; order and times use the session's `statusUpdatedAt`,
  and a session without a record is listed only if Waiting. A Done row is "fresh" (accent marker, counted in the
  header) when `seenAt === null || seenAt >= freshSinceMs`, so rows marked seen by the current
  popup opening keep their look until it closes. `newCount` counts Waiting plus Done with
  `seenAt === null` (drives the top bar dot). `time` is
  `formatDuration(Math.max(0, Math.floor((nowMs - statusUpdatedAt) / 60000)))`. The summary
  counts unlisted sessions: working, and idle not Done.

- [ ] **Step 1: Write the failing tests** in `tests/tracker.test.js`

```js
const MIN = 60000;
const KEEP = 30 * MIN;
const T0 = 1793100000000;
const s = (id, status, updated, extra = {}) => ({pid: 1, procStart: '1', sessionId: id,
    name: id, kind: 'interactive', status, waitingFor: null, startedAt: T0,
    statusUpdatedAt: updated, ...extra});
const step = (records, sessions, now) => reconcile(records, sessions, now, KEEP);

let r = step(new Map(), [s('a', 'busy', T0 + MIN)], T0 + MIN);
check('busy is working', r.get('a'), {state: 'working', statusUpdatedAt: T0 + MIN,
    done: false, seenAt: null});
r = step(r, [s('a', 'idle', T0 + 2 * MIN)], T0 + 2 * MIN);
check('busy then idle is done', r.get('a').done, true);
check('waiting then idle is done', step(step(new Map(), [s('a', 'waiting', T0)], T0),
    [s('a', 'idle', T0 + MIN)], T0 + MIN).get('a').done, true);
check('idle then idle with a new time is done', step(step(new Map(),
    [s('a', 'idle', T0 + 2000)], T0 + MIN), [s('a', 'idle', T0 + 2 * MIN)], T0 + 2 * MIN)
    .get('a').done, true);
check('same idle file stays not done', step(step(new Map(), [s('a', 'idle', T0 + 2000)], T0),
    [s('a', 'idle', T0 + 2000)], T0 + MIN).get('a').done, false);
check('new idle session just started', step(new Map(), [s('a', 'idle', T0 + 2000)],
    T0 + MIN).get('a').done, false);
check('new idle session after a turn', step(new Map(), [s('a', 'idle', T0 + MIN)],
    T0 + 2 * MIN).get('a').done, true);
check('done then busy', step(r, [s('a', 'busy', T0 + 3 * MIN)], T0 + 3 * MIN).get('a').done,
    false);

const seen = markSeen(r, T0 + 3 * MIN);
check('seen sets the time', seen.get('a').seenAt, T0 + 3 * MIN);
check('seen again keeps the first time', markSeen(seen, T0 + 9 * MIN).get('a').seenAt,
    T0 + 3 * MIN);
check('not expired yet', step(seen, [s('a', 'idle', T0 + 2 * MIN)], T0 + 3 * MIN + KEEP - 1)
    .get('a').done, true);
const expired = step(seen, [s('a', 'idle', T0 + 2 * MIN)], T0 + 3 * MIN + KEEP);
check('expired', expired.get('a').done, false);
check('expired stays out', step(expired, [s('a', 'idle', T0 + 2 * MIN)], T0 + 60 * MIN)
    .get('a').done, false);
const cleared = clearDone(r, 'a');
check('cleared', cleared.get('a').done, false);
check('cleared stays out', step(cleared, [s('a', 'idle', T0 + 2 * MIN)], T0 + 5 * MIN)
    .get('a').done, false);
check('gone session dropped', step(r, [], T0 + 5 * MIN).has('a'), false);
check('input not mutated', r.get('a').seenAt, null);

// Order and texts
const now = T0 + 60 * MIN;
const sessions = [
    s('waitB', 'waiting', now - 3 * MIN, {waitingFor: 'input needed'}),
    s('waitA', 'waiting', now - 10 * MIN),
    s('doneC', 'idle', now - 5 * MIN), s('doneD', 'idle', now - MIN),
    s('doneE', 'idle', now - 72 * MIN), s('work', 'busy', now), s('idle', 'idle', T0 + 1000),
];
const recs = new Map([
    ['waitA', {state: 'waiting', statusUpdatedAt: now - 10 * MIN, done: false, seenAt: null}],
    ['waitB', {state: 'waiting', statusUpdatedAt: now - 3 * MIN, done: false, seenAt: null}],
    ['doneC', {state: 'idle', statusUpdatedAt: now - 5 * MIN, done: true, seenAt: null}],
    ['doneD', {state: 'idle', statusUpdatedAt: now - MIN, done: true, seenAt: null}],
    ['doneE', {state: 'idle', statusUpdatedAt: now - 72 * MIN, done: true,
        seenAt: now - 2 * MIN}],
    ['work', {state: 'working', statusUpdatedAt: now, done: false, seenAt: null}],
    ['idle', {state: 'idle', statusUpdatedAt: T0 + 1000, done: false, seenAt: null}],
]);
const list = listing(recs, sessions, now);
check('row order', list.rows.map(row => row.sessionId),
    ['waitA', 'waitB', 'doneD', 'doneC', 'doneE']);
check('labels', list.rows.map(row => row.label),
    ['Permission', 'Question', 'Done', 'Done', 'Done']);
check('times', list.rows.map(row => row.time), ['10m', '3m', '1m', '5m', '1h 12m']);
check('markers', list.rows.map(row => row.marker),
    ['accent', 'accent', 'accent', 'accent', 'dim']);
check('header', list.header, '4 WAITING FOR YOU');
check('new count', list.newCount, 4);
check('summary', list.summary, '1 working · 1 idle');
const open = listing(recs, sessions, now, now - 2 * MIN);
check('seen while open keeps the accent', open.rows[4].marker, 'accent');
check('seen while open is counted', open.header, '5 WAITING FOR YOU');
check('seen while open is not new', open.newCount, 4);
check('future time shows 0m', listing(recs, [s('doneD', 'idle', now + MIN)], now)
    .rows[0].time, '0m');
const empty = listing(new Map(), [], now);
check('nothing waiting', [empty.header, empty.summary, empty.rows.length],
    ['NOTHING WAITING', 'No Claude Code sessions', 0]);

check('round trip', [...parseRecords(serializeRecords(recs))], [...recs]);
check('garbage state', parseRecords('{').size, 0);
check('other version', parseRecords('{"version":99,"records":{}}').size, 0);
check('bad record dropped', parseRecords(
    '{"version":1,"records":{"x":{"state":"idle"}}}').size, 0);
```

- [ ] **Step 2: Run to verify it fails**

Run: `gjs -m tests/tracker.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/sessions/tracker.js`** (no `gi://` imports) with the rules above.
  State file: `{"version": 1, "records": {"<sessionId>": Record}}`; `parseRecords` drops any
  record whose `state` is not one of the three, whose `statusUpdatedAt` is not finite, whose
  `done` is not a boolean or whose `seenAt` is neither null nor finite.

- [ ] **Step 4: Run to verify it passes**

Run: `bash tests/run.sh && npm run lint`
Expected: all `ok`, lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/sessions/tracker.js tests/tracker.test.js
git commit -m "feat: derive done and seen sessions"
```

---

### Task 3: Status tab and its settings

**Files:**
- Modify: `schemas/org.gnome.shell.extensions.claudometer.gschema.xml`
- Modify: `src/prefs/config.js`, `prefs.js:47-68,249-259`
- Modify: `src/indicator.js:156-212`
- Rename: `icons/limits-symbolic.svg` → `icons/status-symbolic.svg` (new drawing)
- Modify: `tests/shell/check.sh:61` (tab names)
- Test: `tests/config.test.js`

**Interfaces:**
- Produces:
  - Settings `show-sessions` (`b`, default `true`) and `seen-minutes` (`i`, range 10–60,
    default `30`).
  - `SEEN_CHOICES = [[10, '10 min'], [30, '30 min'], [60, '60 min']]` and
    `tabFromSetting(saved: string, names: string[]) -> string` in `src/prefs/config.js`.
  - The tab key is `'Status'` in `Indicator._tabViews`, `_selectTab('Status')` and the shell
    test.

Decision on `last-tab`: keep the stored value working without a migration. The schema keeps the
`Limits` choice (so existing stored values stay valid), adds `Status` and makes it the default;
`tabFromSetting` maps `Limits` to `Status`.

- [ ] **Step 1: Write the failing test** in `tests/config.test.js`

```js
check('old Limits tab opens Status', tabFromSetting('Limits', ['Status', 'Models']), 'Status');
check('saved tab kept', tabFromSetting('Models', ['Status', 'Models']), 'Models');
check('unknown tab opens Status', tabFromSetting('Nope', ['Status']), 'Status');
check('seen choices', SEEN_CHOICES.map(([minutes]) => minutes), [10, 30, 60]);
```

- [ ] **Step 2: Run to verify it fails**

Run: `gjs -m tests/config.test.js`
Expected: FAIL, `tabFromSetting` not exported.

- [ ] **Step 3: Implement**
  - Schema: `last-tab` gains `<choice value="Status"/>`, default `'Status'`; `tabs` summary
    "The popup tabs shown after Status"; the two new keys with summaries "Show the Claude Code
    sessions in the Status tab" and "Minutes a seen finished session stays listed".
  - `config.js`: `SEEN_CHOICES`, `tabFromSetting`.
  - `icons/status-symbolic.svg`: `git mv` the old file, then replace its content with the
    mockup's drawing:

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="3" cy="3.5" r="1.6"/><rect x="6" y="2.7" width="8.5" height="1.6" rx=".8"/><circle cx="3" cy="8" r="1.6"/><rect x="6" y="7.2" width="6" height="1.6" rx=".8"/><circle cx="3" cy="12.5" r="1.6"/><rect x="6" y="11.7" width="7.5" height="1.6" rx=".8"/></svg>
```

  - `indicator.js`: rename the `Limits` key to `Status` in `_buildPopup`, `_applyTabs` (and its
    comment), `_selectTab`; read the saved tab with `tabFromSetting`. The Status view is still
    only `this._limitsView.actor` in this task.
  - `prefs.js`: the `Limits` group becomes `Status` with, in order, `switchRow(settings,
    'show-sessions', 'Sessions in the Status tab')`, `choiceRow({title: 'Keep seen results
    for', settings, key: 'seen-minutes', type: 'i', choices: SEEN_CHOICES})` (visible only
    while `show-sessions` is on, with `followSettings` as the Scale row does), then the two
    existing rows. `tabsRow` subtitle `'Only Status'`.
  - `tests/shell/check.sh`: `for tab in Status Projects Activity Models`.

- [ ] **Step 4: Verify**

Run: `bash tests/run.sh && npm run lint && glib-compile-schemas --strict --dry-run schemas`
Expected: all `ok`, lint clean, no schema error.

Run: `glib-compile-schemas schemas`, restart the shell (Alt+F2, `r`), open the popup.
Expected: the first tab reads `Status` with the three-rows icon and the limits table; the tab
used last before the change (if Limits) opens as Status; Preferences → Popup shows the Status
group, and the minutes row hides when the switch is off.

- [ ] **Step 5: Commit**

```bash
git add -A schemas src/prefs/config.js prefs.js src/indicator.js icons tests/config.test.js \
    tests/shell/check.sh
git commit -m "feat: rename the Limits tab to Status"
```

---

### Task 4: Watch the sessions and keep Done/seen

**Files:**
- Create: `src/files.js`, `src/sessions/watcher.js`, `src/sessions/monitor.js`
- Modify: `src/limits/usage-client.js:220-252` (use `saveText`)
- Test: `tests/watcher.test.js`, `tests/monitor.test.js`

**Interfaces:**
- Consumes: `parseSession`, `procStartFromStat`, `latestPerSession` (Task 1); `reconcile`,
  `markSeen`, `clearDone`, `listing`, `serializeRecords`, `parseRecords` (Task 2).
- Produces:
  - `saveText(path: string, text: string, cancellable: Gio.Cancellable|null, what: string)`:
    creates the parent folder if needed, replaces the file, warns
    `Claudometer: Cannot save the <what>: <message>` on failure other than cancellation.
  - `new SessionWatcher({dir, onSessions, intervalSeconds = 30})`, `.refresh()`, `.destroy()`;
    `onSessions(sessions: Session[])` after every scan, with live processes only.
  - `new SessionMonitor({dir, statePath, keepMinutes, onChange})`, `.sessions: Session[]`,
    `.listing(nowMs, freshSinceMs = Infinity) -> Listing`, `.markSeen()`, `.handled(sessionId)`,
    `.setKeepMinutes(minutes)`, `.destroy()`; `onChange()` after every change of the listing
    inputs.

Watcher behavior:
- `Gio.File.monitor_directory` on `dir` (created even if `dir` is missing; failure to create it
  is warned once and the periodic scan still runs); events are debounced 300 ms into one scan;
  a `GLib.timeout_add_seconds` every `intervalSeconds` catches processes that died without
  removing their file.
- A scan: `enumerate_children_async` (`standard::name`), keep names matching `^\d+\.json$`,
  `load_contents_async` each, `parseSession`, then `load_contents_async('/proc/<pid>/stat')` and
  keep it when `procStartFromStat(...) === session.procStart`. A missing folder reports `[]`.
- One scan at a time; a request during a scan runs one more scan after it.
- **Review Focus 3:** when a file fails to parse but its previous scan parsed, and that pid is
  still alive with the same `procStart`, the previous session is reported.
- All IO uses one `Gio.Cancellable`, cancelled in `destroy()` along with the timers and monitor.

Monitor behavior:
- Loads `statePath` first (`load_contents_async`, `parseRecords`; missing or broken → empty)
  and only then starts the watcher, so state from before a lock is never overwritten.
- On sessions: `reconcile` with `keepMinutes * 60000`, save when `serializeRecords` differs from
  the last saved text, call `onChange`. `markSeen` and `handled` (`clearDone`) save and call
  `onChange` the same way.
- **Review Focus 4:** saves pass a `null` cancellable so a save started just before
  `destroy()` completes.

- [ ] **Step 1: Write the failing tests**

`tests/watcher.test.js` (temp folder from `GLib.dir_make_tmp`, a `sleep 60` child, its
`procStart` from its `/proc/<pid>/stat`):

```js
// writeSession(pid, fields) writes <dir>/<pid>.json; writeRaw(name, text) writes any file
writeSession(child, {status: 'busy'});
writeSession(child2Dead, {status: 'busy'});           // pid of a child already killed
writeSession(child3, {status: 'busy', procStart: '1'}); // pid reused by another process
writeSession(child4, {status: 'busy', kind: 'daemon'});
writeRaw(`${child}.0123abcd.key`, 'secret');
writeRaw('notes.txt', 'x');
const watcher = new SessionWatcher({dir, onSessions: list => (latest = list)});
waitFor(() => latest !== null);
check('only the live session', latest.map(x => [x.pid, x.status]), [[child, 'busy']]);
writeSession(child, {status: 'waiting'});
waitFor(() => latest[0]?.status === 'waiting');
check('change seen by the monitor', latest[0].status, 'waiting');
writeRaw(`${child}.json`, '{"pid": ');
const before = scans;  // onSessions also counts its calls
watcher.refresh();
waitFor(() => scans > before);
check('truncated rewrite keeps the session', latest.map(x => x.status), ['waiting']);
deleteFile(`${child}.json`);
waitFor(() => latest.length === 0);
check('removed file', latest, []);
watcher.destroy();
check('missing folder reports nothing', /* new watcher on `${dir}/none` */ reported, []);
```

`tests/monitor.test.js` (same helpers; `statePath` in another temp folder):

```js
const m1 = new SessionMonitor({dir, statePath, keepMinutes: 30, onChange: () => changes++});
writeSession(child, {status: 'busy', statusUpdatedAt: Date.now()});
waitFor(() => m1.sessions.length === 1);
writeSession(child, {status: 'idle', statusUpdatedAt: Date.now() + 1});
waitFor(() => m1.listing(Date.now()).rows.length === 1);
check('done row', m1.listing(Date.now()).rows[0].label, 'Done');
check('done is new', m1.listing(Date.now()).newCount, 1);
m1.markSeen();
m1.destroy();  // at once, as a screen lock does
waitFor(() => GLib.file_test(statePath, GLib.FileTest.EXISTS) && savedHasSeen(statePath));
const m2 = new SessionMonitor({dir, statePath, keepMinutes: 30, onChange: () => {}});
waitFor(() => m2.sessions.length === 1);
check('done kept across a restart', m2.listing(Date.now()).rows.map(r => r.marker), ['dim']);
check('seen kept across a restart', m2.listing(Date.now()).newCount, 0);
m2.handled(m2.sessions[0].sessionId);
check('handled leaves the list', m2.listing(Date.now()).rows.length, 0);
m2.destroy();
// writeSession defaults: kind interactive, startedAt now; savedHasSeen reads the state file
// synchronously (tests only) and looks for a record with a seenAt
```

- [ ] **Step 2: Run to verify they fail**

Run: `gjs -m tests/watcher.test.js; gjs -m tests/monitor.test.js`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement** `src/files.js` (move `UsageClient._saveCache`'s folder-and-replace
  logic into `saveText`, and call it from `_saveCache` with `this._cancellable` and
  `'usage cache'`), `src/sessions/watcher.js`, `src/sessions/monitor.js`, following the
  behavior lists above and the async style of `src/limits/usage-client.js` (callbacks with
  `*_finish` in `try`, `this._destroyed` checks).

- [ ] **Step 4: Run to verify they pass**

Run: `bash tests/run.sh && npm run lint`
Expected: all `ok` (including `cache.test.js`), lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/files.js src/sessions/watcher.js src/sessions/monitor.js \
    src/limits/usage-client.js tests/watcher.test.js tests/monitor.test.js
git commit -m "feat: watch Claude Code sessions"
```

---

### Task 5: SESSIONS section and the dots

**Files:**
- Create: `src/popup/sessions-view.js`
- Modify: `src/popup/views.js:51-93` (tab badge), `src/indicator.js`, `stylesheet.css`
- Modify: `tests/shell/check.sh` (fake session)

**Interfaces:**
- Consumes: `SessionMonitor` and `Listing` (Tasks 2, 4); settings and `'Status'` (Task 3).
- Produces:
  - `createSessionsView(onActivate: (sessionId) => void) -> {actor, update(listing)}`.
  - Tab bar `setBadge(name: string, shown: boolean)`.
  - Indicator fields used by Task 6 and the shell test: `this._monitor` (null while the setting
    is off), `this._sessionsView`, `this._iconDot`, `this._labelDot`, and
    `_onSession(sessionId)` (the row click handler).

View, per spec "Popup: the Status tab", in the existing classes:
- `cm-tline`, then a header row `cm-ss-header` (`cm-hdr` `SESSIONS` with `x_expand`, and
  `cm-hdr` `listing.header`), with 12px above it.
- One `St.Button` per row (`cm-ss-row`, `can_focus`, `track_hover`, accessible name = row
  name), separated by `cm-tline`; its child is a `cm-trow` box: an 8×8 marker
  (`cm-ss-mark`, plus `cm-ss-mark-dim` for `marker === 'dim'`), the name (`cm-name`,
  `x_expand`, ellipsized end), the label (`cm-sec`), the time (`cm-val cm-ss-time`). A dim row's
  three text cells take the faded opacity 115 the limits use for outdated values ("dimmed").
- `cm-tline`, then a `cm-trow` with the summary in `cm-sec`.
- `update` rebuilds the children (`destroy_all_children`), like `shareTable`.

Styles (`stylesheet.css`, new "Sessions" block):
- `.cm-ss-mark { width: 8px; height: 8px; border-radius: 2px; background-color: #d97757; }`,
  `.cm-ss-mark-dim { background-color: rgba(255, 255, 255, 0.22); }`
- `.cm-ss-time { width: 52px; text-align: right; }`, `.cm-ss-header { padding-top: 12px; }`
- `.cm-ss-row:hover .cm-name, .cm-ss-row:focus .cm-name { color: #ffffff; }`
- `.cm-dot { width: 7px; height: 7px; border-radius: 4px; background-color: #d97757; }` with
  `.cm-panel-dot { border: 1.5px solid #000000; }` (the default top bar background) and
  `.cm-tab-dot { border: 1.5px solid #353535; }` (the popup background).

Indicator:
- The Status tab view becomes a vertical box holding `this._limitsView.actor` then
  `this._sessionsView.actor`.
- The top bar icon sits in an `St.Widget` with `Clutter.BinLayout`, with `this._iconDot`
  (`cm-dot cm-panel-dot`, `x_align: END`, `y_align: START`) over it; `this._labelDot` (same
  classes, `y_align: CENTER`) is added after the label. Visible: `newCount > 0` and, for the
  icon dot, `show-icon` on; for the label dot, `show-icon` off.
- `createTabBar` wraps each tab icon the same way with a hidden `cm-dot cm-tab-dot`;
  `setBadge` shows it. The Status badge shows while `newCount > 0` and another tab is selected.
- `show-sessions` on: create `SessionMonitor({dir: <claude dir>/sessions, statePath:
  <dataDir>/sessions.json, keepMinutes: seen-minutes, onChange: () => this._showSessions()})`;
  off: destroy it, hide the section and every dot. `claude-dir` changes recreate it;
  `seen-minutes` calls `setKeepMinutes`. `destroy()` destroys it.
- Popup open: `this._freshSinceMs = Date.now()`, `_showSessions()`, then `markSeen()`. Popup
  closed: `this._freshSinceMs = Infinity`. The open tick also calls `_showSessions()`.
- `_showSessions()`: `listing(Date.now(), this._freshSinceMs)` into the view, the dots and the
  badge.
- `_onSession(sessionId)`: `this.menu.close()`, then `this._monitor.handled(sessionId)`. (Task 6
  adds the focus.)

- [ ] **Step 1: Add the failing shell check** in `tests/shell/check.sh`: before the shell
  starts, run `sleep 600 &`, read its start time (`awk '{print $22}' /proc/$!/stat`), and write
  `$HOME/.claude/sessions/$!.json` with `kind: "interactive"`, `name: "demo"`,
  `status: "waiting"`, `waitingFor: "input needed"`, `startedAt` and `statusUpdatedAt` set to
  now in ms, a `sessionId`, `pid` and `procStart`; kill the `sleep` at the end of the script.
  After the tab loop:

```bash
result=$(eval_js "$button._monitor.listing(Date.now()).header === '1 WAITING FOR YOU' && \
    $button._sessionsView.actor.visible && ($button._iconDot.visible || $button._labelDot.visible)")
echo "sessions: $result"
[ "$result" = "(true, 'true')" ] || fail=1
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash tests/shell/run.sh 46`
Expected: `sessions: (false, ...)` or an Eval error, then `Failed: 46`.

- [ ] **Step 3: Implement** the view, the badge, the styles and the indicator wiring above.

- [ ] **Step 4: Verify**

Run: `bash tests/run.sh && npm run lint && bash tests/shell/run.sh`
Expected: all `ok`, lint clean, `PASS` for 46 through 51.

Manual, on this machine (restart the shell once; repeated restarts make the usage service
answer 429): with one session asking a permission and one finished, the gauge shows the dot,
the Status tab lists `Permission` then `Done` with accent markers and the counts in the header
and summary; reopening the popup shows the Done row dimmed and no top bar dot unless something
waits; clicking a row closes the popup and a Done row leaves the list; lock and unlock keep the
seen state; Preferences → "Sessions in the Status tab" off hides the section and the dot.

- [ ] **Step 5: Commit**

```bash
git add src/popup/sessions-view.js src/popup/views.js src/indicator.js stylesheet.css \
    tests/shell/check.sh
git commit -m "feat: list sessions that need you"
```

---

### Task 6: Click brings the Ghostty tab to the front

**Files:**
- Create: `src/sessions/focus.js`, `src/sessions/catcher.js`
- Modify: `src/indicator.js` (`_onSession`, lifecycle), `tests/shell/check.sh`
- Test: `tests/focus.test.js`

**Interfaces:**
- Consumes: `Session`, `isGhostty` (Task 1); `this._monitor`, `_onSession` (Task 5).
- Produces:
  - `TOKEN_TIMEOUT_MS = 1000`, `LATE_TOKEN_MS = 60000` in `focus.js`.
  - `new TokenBook()`: `.expect(token, timeoutMs) -> Promise<{appId: string,
    target: GLib.Variant}|null>`, `.take(appId, notification: {[key]: GLib.Variant}) -> boolean`
    (true = swallow), `.destroy()` (resolves pending with null, removes timers).
  - `new SessionFocus({book, available: () => boolean, x11: boolean})`:
    `.focus(session) -> Promise<boolean>`, `.forget(live: Session[])`, `.destroy()`.
  - `new NotificationCatcher(book)` in `catcher.js`: `.available: boolean`, `.destroy()`.

`TokenBook.take`: reads `title` and `body` (`unpack()` when present); when either contains a
pending token, resolves that promise with `{appId, target:
notification['default-action-target'] ?? null}` (null target resolves null) and returns true;
when either contains a token that expired less than `LATE_TOKEN_MS` ago, returns true
(**Review Focus 2**); otherwise false.

`SessionFocus.focus(session)` returns false, writing nothing, unless all hold, in this order:
`x11`, `session.kind === 'interactive'`, `available()` (**Review Focus 1**),
`isGhostty(<async /proc/<pid>/environ>)`. Then:
1. Surface cached for `${pid}:${procStart}` → skip to 4.
2. `query_info_async('/proc/<pid>/fd/0', 'standard::symlink-target', NOFOLLOW_SYMLINKS)`;
   the target must match `^/dev/pts/\d+$`, else false (**Review Focus 5**).
3. `token = 'cm-' + GLib.uuid_string_random()`; call `book.expect(token, TOKEN_TIMEOUT_MS)`
   before writing; write `\x1b]9;${token}\x07` to the pts path in one `write_bytes_async` on an
   `append_to_async` stream, then `close_async`; a null result returns false; otherwise cache it.
4. `Gio.DBus.session.call(appId, '/' + appId.replaceAll('.', '/'),
   'org.freedesktop.Application', 'ActivateAction', new GLib.Variant('(sava{sv})',
   ['present-surface', [target], {}]), null, NONE, -1, cancellable, ...)`; pass the caught
   `target` Variant unchanged (no uint64 to Number round trip). Returns true.
Any error returns false (`console.warn('Claudometer: Cannot focus the session:', e.message)`
for unexpected ones). `forget` drops cached surfaces of processes not in `live`.

`NotificationCatcher`: `daemon = Main.notificationDaemon?._gtkNotificationDaemon`;
`available = typeof daemon?.AddNotificationAsync === 'function'`. When available, an
`InjectionManager` (from `resource:///org/gnome/shell/extensions/extension.js`) overrides
`AddNotificationAsync` on the `daemon` instance: when `book.take(appId, notification)` is true
it calls `invocation.return_value(null)` and returns, so no source or banner is ever created;
otherwise it calls the original. (On GNOME 46 the D-Bus wrapper looks the method up on the
instance at call time.) `destroy()` calls `clear()`. If a later GNOME version moves this
method, the shell check below fails on it: find that version's equivalent and keep
`available` false where none exists.

Indicator: when the monitor is created, also create `this._book`, `this._catcher` and
`this._focus = new SessionFocus({book, available: () => catcher.available, x11})` with
`x11 = typeof Meta.is_wayland_compositor === 'function' && !Meta.is_wayland_compositor()`;
destroy all three with the monitor. `onChange` also calls `this._focus.forget(monitor.sessions)`.
`_onSession(sessionId)`: close the popup, `handled(sessionId)`, then, when the session is still
in `monitor.sessions`, `this._focus.focus(session)` without awaiting it.

- [ ] **Step 1: Write the failing tests** in `tests/focus.test.js`

```js
const v = (type, value) => new GLib.Variant(type, value);
const note = (body, target = 42) => ({title: v('s', 'Ghostty'), body: v('s', body),
    'default-action': v('s', 'app.present-surface'), 'default-action-target': v('t', target)});

const book = new TokenBook();
let hit;
book.expect('cm-1', 1000).then(x => (hit = x));
check('unrelated notification passes', book.take('org.app', note('hello')), false);
check('token swallowed', book.take('com.mitchellh.ghostty', note('cm-1')), true);
waitFor(() => hit !== undefined);
check('surface id', [hit.appId, hit.target.unpack()], ['com.mitchellh.ghostty', 42]);
let late;
book.expect('cm-2', 50).then(x => (late = x));
waitFor(() => late !== undefined);
check('timeout gives null', late, null);
check('late token still swallowed', book.take('com.mitchellh.ghostty', note('cm-2')), true);
book.destroy();

// `child`: `sleep 60` spawned with Gio.SubprocessFlags.STDIN_PIPE and TERM_PROGRAM=ghostty
// (Gio.SubprocessLauncher.setenv), so in the last case only the pipe stops the write
let expected = 0;
const fakeBook = {expect: () => { expected++; return Promise.resolve(null); }};
const session = {pid: child, procStart, kind: 'interactive', sessionId: 'x'};
const cases = [
    ['no catcher', {available: () => false, x11: true}, session],
    ['wayland', {available: () => true, x11: false}, session],
    ['background session', {available: () => true, x11: true}, {...session, kind: 'bg'}],
    ['stdin is a pipe', {available: () => true, x11: true}, session],
];
for (const [name, options, target] of cases) {
    expected = 0;
    let result;
    new SessionFocus({book: fakeBook, ...options}).focus(target).then(x => (result = x));
    waitFor(() => result !== undefined);
    check(`${name}: no focus, nothing written`, [result, expected], [false, 0]);
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `gjs -m tests/focus.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `src/sessions/focus.js` (Gio/GLib only) and
  `src/sessions/catcher.js`, then the indicator wiring above.

- [ ] **Step 4: Add the shell check** in `tests/shell/check.sh`, after the sessions check, that
  the catcher swallows a notification on every version:

```bash
eval_js "globalThis.cmHit = null; const n = Main.messageTray.getSources().length; \
    globalThis.cmSources = n; $button._book.expect('cm-shell-test', 5000) \
    .then(x => (globalThis.cmHit = x?.target?.unpack() ?? -1)); true" > /dev/null
gdbus call --session --dest org.gtk.Notifications --object-path /org/gtk/Notifications \
    --method org.gtk.Notifications.AddNotification com.mitchellh.ghostty cm \
    "{'title': <'Ghostty'>, 'body': <'cm-shell-test'>, \
    'default-action': <'app.present-surface'>, 'default-action-target': <uint64 42>}" > /dev/null
sleep 1
result=$(eval_js "$button._catcher.available && globalThis.cmHit === 42 && \
    Main.messageTray.getSources().length === globalThis.cmSources")
echo "catcher: $result"
[ "$result" = "(true, 'true')" ] || fail=1
```

- [ ] **Step 5: Verify**

Run: `bash tests/run.sh && npm run lint && bash tests/shell/run.sh`
Expected: all `ok`, lint clean, `catcher: (true, 'true')` and `PASS` for 46 through 51.

Manual, on this machine (GNOME 46, X11, Ghostty 1.3.1), restarting the shell once: sessions in
two Ghostty windows with several tabs each, the active tab of each window being another one.
For each session, make it wait (for example ask it to write a file) and click its row: its own
tab and window come to the front, and no banner, message tray entry or notification list entry
appears; nothing shows in that terminal. Click again (cached id): same. With
`desktop-notifications = false` in Ghostty's config, a click closes the popup and focuses
nothing, with nothing visible.

- [ ] **Step 6: Commit**

```bash
git add src/sessions/focus.js src/sessions/catcher.js src/indicator.js tests/focus.test.js \
    tests/shell/check.sh
git commit -m "feat: focus the session's Ghostty tab"
```

---

### Task 7: Docs

**Files:**
- Modify: `docs/design.md`, `README.md:30-33`, `CONTRIBUTING.md` (layout table, pure modules
  list, tests list)
- Rename and modify: `docs/images/limits.svg` → `docs/images/status.svg`
- Modify: `docs/images/overview.js` (tab key `status`), regenerate `docs/images/overview.svg`

Content (from the spec's "Docs to update"):
- `design.md`: Goal gains the third question **Which of my sessions needs me now?**; Top bar
  gains the accent dot (and after the label when the icon is hidden); Popup tabs list starts
  with Status; the Limits section becomes Status with the limits table and the SESSIONS section
  (order, markers, labels, times, header and summary texts, dimmed seen rows, the click); the
  Settings table's Popup row gains the two options; Data gains the session files (read only,
  no transcripts) and the click mechanism in plain terms; Mockups mentions `status.svg`.
- `status.svg`: the Status tab icon in the tab bar (`Status` label), the limits rows as today,
  then a SESSIONS section with made-up data: `api-gateway · Permission · 4m` (accent),
  `web-shop · Done · 1m` (accent), `dotfiles · Done · 12m` (dim), and `2 working · 1 idle`;
  update the four tab bars in the other mockups to the Status icon and label.
- `README.md` Privacy: add that Claudometer reads which Claude Code sessions are running and
  their state, never their conversations, and that clicking a session sends an invisible signal
  to its terminal to bring its tab to the front. No code, no internals.
- `CONTRIBUTING.md`: `src/sessions/` row; `src/sessions/sessions.js` and
  `src/sessions/tracker.js` in the pure modules list; the overview is built from the four tab
  mockups including `status.svg`.

- [ ] **Step 1: Edit the docs and mockups** as listed.
- [ ] **Step 2: Rebuild the overview**

Run: `gjs -m docs/images/overview.js && xdg-open docs/images/overview.svg`
Expected: the overview shows the Status tab with the SESSIONS section, columns ending together.

- [ ] **Step 3: Check**

Run: `rg -n 'Limits tab|limits.svg|limits-symbolic' --glob '!docs/superpowers/**'`
Expected: no stale references (the limits *table* may still be named).

- [ ] **Step 4: Commit**

```bash
git add -A docs/design.md docs/images README.md CONTRIBUTING.md
git commit -m "docs: describe the Status tab"
```
