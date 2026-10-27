// Run with: gjs -m tests/monitor.test.js
import GLib from 'gi://GLib';

import {SessionMonitor} from '../src/sessions/monitor.js';
import {
    check, idle, run, spawnSleep, tempFolder, waitFor, writeSession,
} from './session-fixtures.js';

// Above the 1 s scan interval, so the tests pass without a working folder monitor
const WAIT_MS = 4000;

// Reads the state file synchronously (tests only)
function savedText(path) {
    if (!GLib.file_test(path, GLib.FileTest.EXISTS))
        return null;
    return new TextDecoder().decode(GLib.file_get_contents(path)[1]);
}

function savedRecords(path) {
    const text = savedText(path);
    return text === null ? [] : Object.values(JSON.parse(text).records);
}

// Looks for a record with a seenAt
function savedHasSeen(path) {
    return savedRecords(path).some(r => r.seenAt !== null);
}

run(() => {
    const dir = tempFolder();
    const statePath = GLib.build_filenamev([tempFolder(), 'sessions.json']);
    const child = spawnSleep();
    let changes = 0;

    const m1 = new SessionMonitor({dir, statePath, keepMinutes: 30, intervalSeconds: 1,
        onChange: () => changes++});
    try {
        writeSession(dir, child, {status: 'busy', statusUpdatedAt: Date.now()});
        waitFor(() => m1.sessions.length === 1, WAIT_MS);
        check('change reported', changes > 0, true);
        writeSession(dir, child, {status: 'idle', statusUpdatedAt: Date.now() + 1});
        waitFor(() => m1.listing(Date.now()).rows.length === 1, WAIT_MS);
        check('done row', m1.listing(Date.now()).rows[0].label, 'Done');
        check('done is new', m1.listing(Date.now()).newCount, 1);
        const before = changes;
        m1.markSeen();
        check('markSeen reports a change', changes, before + 1);
    } finally {
        m1.destroy(); // at once, as a screen lock does
    }
    waitFor(() => savedHasSeen(statePath), WAIT_MS);

    const m2 = new SessionMonitor({dir, statePath, keepMinutes: 30, intervalSeconds: 1,
        onChange: () => {}});
    try {
        waitFor(() => m2.sessions.length === 1, WAIT_MS);
        check('done kept across a restart', m2.listing(Date.now()).rows.map(r => r.marker),
            ['dim']);
        check('seen kept across a restart', m2.listing(Date.now()).newCount, 0);
        m2.setKeepMinutes(0);
        check('seen mark expires with a shorter keep time', m2.listing(Date.now()).rows.length,
            0);
        writeSession(dir, child, {status: 'idle', statusUpdatedAt: Date.now() + 2});
        waitFor(() => m2.listing(Date.now()).rows.length === 1, WAIT_MS);
        m2.handled(m2.sessions[0].sessionId);
        check('handled leaves the list', m2.listing(Date.now()).rows.length, 0);
    } finally {
        m2.destroy();
    }

    // Destroyed before the state file is read: no watcher, no change, no save
    waitFor(() => savedRecords(statePath).every(r => !r.done && r.seenAt === null), WAIT_MS);
    const stateBefore = savedText(statePath);
    let early = 0;
    const m0 = new SessionMonitor({dir, statePath, keepMinutes: 30, intervalSeconds: 1,
        onChange: () => early++});
    m0.markSeen();
    m0.destroy();
    idle(1500);
    check('destroyed before loading does nothing', [early, savedText(statePath)], [0, stateBefore]);

    // A broken state file starts empty and is replaced by the next save
    GLib.file_set_contents(statePath, '{"version": 1, "records": ');
    const m3 = new SessionMonitor({dir, statePath, keepMinutes: 30, intervalSeconds: 1,
        onChange: () => {}});
    try {
        waitFor(() => m3.sessions.length === 1, WAIT_MS);
        check('broken state file starts empty', m3.listing(Date.now()).rows.length, 0);
    } finally {
        m3.destroy();
    }
});
