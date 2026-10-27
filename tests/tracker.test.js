// Run with: gjs -m tests/tracker.test.js
import System from 'system';

import {
    STARTUP_GRACE_MS, clearDone, listing, markSeen, parseRecords, reconcile, serializeRecords,
} from '../src/sessions/tracker.js';

let failures = 0;

function check(name, actual, expected) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
        print(`ok   ${name}`);
    } else {
        failures++;
        print(`FAIL ${name}\n     expected ${e}\n     got      ${a}`);
    }
}

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
const onlySeen = listing(recs, [sessions[4]], now);
check('seen-only rows say nothing waiting', [onlySeen.rows.length, onlySeen.header],
    [1, 'NOTHING WAITING']);
check('all listed still has a summary', listing(recs, sessions.slice(0, 5), now).summary,
    '0 working · 0 idle');

check('grace period', STARTUP_GRACE_MS, 10000);

if (failures > 0) {
    print(`\n${failures} failed`);
    System.exit(1);
}
print('\nall passed');
