// Run with: gjs -m tests/status.test.js
import System from 'system';

import {
    SCREEN_STATES, State, backoffSeconds, formatAgo, formatClock, isTokenExpired,
    limitTimeText, limitsScreen, stateForStatus, statusLine,
} from '../src/limits/status.js';

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
const HOUR = 60 * MIN;
const now = new Date(2026, 9, 22, 14, 44).getTime();
const at1432 = new Date(2026, 9, 22, 14, 32).getTime();

check('token expired in the past', isTokenExpired(now - 1, now), true);
check('token expiring exactly now', isTokenExpired(now, now), true);
check('token still valid', isTokenExpired(now + HOUR, now), false);
check('token without expiresAt', isTokenExpired(undefined, now), false);

check('status 200', stateForStatus(200), State.FRESH);
check('status 401', stateForStatus(401), State.EXPIRED);
check('status 429', stateForStatus(429), State.FAILED);
check('status 503', stateForStatus(503), State.FAILED);

check('backoff uses Retry-After', backoffSeconds('90', 0), 90);
check('backoff first 429', backoffSeconds(null, 0), 120);
check('backoff doubles', backoffSeconds(null, 120), 240);
check('backoff caps', backoffSeconds(null, 1200), 1800);
check('backoff ignores HTTP-date', backoffSeconds('Wed, 21 Oct 2026 07:28:00 GMT', 0), 120);

check('clock pads', formatClock(new Date(2026, 9, 22, 9, 5).getTime()), '09:05');

check('ago under a minute', formatAgo(now - 59 * 1000, now), 'just now');
check('ago minutes', formatAgo(at1432, now), '12 min ago');
check('ago hours', formatAgo(now - 3 * HOUR - 10 * MIN, now), '3 h ago');
check('ago days', formatAgo(now - 50 * HOUR, now), '2 d ago');

check('status fresh', statusLine(State.FRESH, null, at1432, now),
    {icon: 'emblem-ok-symbolic', text: 'Updated 12 min ago'});
check('status just updated', statusLine(State.FRESH, null, now - 1000, now).text,
    'Updated just now');
check('status before the first answer', statusLine(State.FRESH, null, 0, now),
    {icon: 'emblem-synchronizing-symbolic', text: 'Checking your limits'});
check('status offline', statusLine(State.OFFLINE, null, at1432, now),
    {icon: 'network-offline-symbolic', text: 'Offline · values from 14:32'});
check('status offline, 12-hour', statusLine(State.OFFLINE, null, at1432, now, false).text,
    'Offline · values from 2:32 PM');
check('status offline without values', statusLine(State.OFFLINE, null, 0, now).text, 'Offline');
check('status expired', statusLine(State.EXPIRED, null, at1432, now),
    {icon: 'dialog-password-symbolic', text: 'Login expired · open Claude Code'});
check('status failed', statusLine(State.FAILED, 'HTTP 503', at1432, now),
    {icon: 'dialog-warning-symbolic', text: 'HTTP 503 · retrying'});
check('status without a login', statusLine(State.NO_LOGIN, null, 0, now),
    {icon: 'avatar-default-symbolic', text: 'Not signed in to Claude Code'});

const iso = ms => new Date(ms).toISOString();

const opts = (o = {}) => ({stale: false, style: 'countdown', use24h: true, ...o});
check('left minutes', limitTimeText(iso(now + 14 * MIN + 30000), now, opts()), '14m');
check('left hours', limitTimeText(iso(now + 2 * HOUR + 14 * MIN + 30000), now, opts()), '2h 14m');
check('left days',
    limitTimeText(iso(now + 3 * 24 * HOUR + 5 * HOUR + 30000), now, opts()), '3d 5h');
check('passed, fresh', limitTimeText(iso(at1432), now, opts()), 'now');
check('passed, stale', limitTimeText(iso(at1432), now, opts({stale: true})), '14:32');
check('passed, clock style, fresh', limitTimeText(iso(at1432), now, opts({style: 'clock'})), 'now');
check('clock today', limitTimeText(iso(now + 2 * HOUR), now, opts({style: 'clock'})), '16:44');
check('clock later in the week',
    limitTimeText(iso(now + 3 * 24 * HOUR), now, opts({style: 'clock'})), 'Sun 14:44');
check('clock 12-hour',
    limitTimeText(iso(now + 2 * HOUR), now, opts({style: 'clock', use24h: false})), '4:44 PM');
check('invalid date', limitTimeText('garbage', now, opts()), '—');
check('clock 12-hour midnight', formatClock(new Date(2026, 9, 22, 0, 7).getTime(), false),
    '12:07 AM');

check('limits loading', limitsScreen(State.FRESH, null, false).title, 'Checking your limits');
check('limits with data', limitsScreen(State.OFFLINE, null, true), null);
check('not signed in', limitsScreen(State.NO_LOGIN, null, false).line,
    'Sign in to Claude Code to see your limits.');
check('failed shows the detail', limitsScreen(State.FAILED, 'HTTP 503', false).line,
    'HTTP 503. Trying again soon.');
check('empty state', SCREEN_STATES.empty.title, 'No activity yet');

if (failures > 0) {
    print(`\n${failures} failed`);
    System.exit(1);
}
print('\nall passed');
