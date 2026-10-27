// Run with: gjs -m tests/watcher.test.js
import {SessionWatcher} from '../src/sessions/watcher.js';
import {
    check, deleteFile, idle, killChild, procStartOf, run, setMode, spawnSleep, tempFolder,
    waitFor, writeRaw, writeSession,
} from './session-fixtures.js';

// Above the 1 s scan interval, so the tests pass without a working folder monitor
const WAIT_MS = 4000;

run(() => {
    const dir = tempFolder();
    const child = spawnSleep();
    const dead = spawnSleep();
    const deadStart = procStartOf(dead);
    killChild(dead);
    const reused = spawnSleep();
    const daemon = spawnSleep();

    writeSession(dir, child, {status: 'busy'});
    writeSession(dir, dead, {status: 'busy', procStart: deadStart});
    writeSession(dir, reused, {status: 'busy', procStart: '1'});
    writeSession(dir, daemon, {status: 'busy', kind: 'daemon'});
    writeRaw(dir, `${child}.0123abcd.key`, 'secret');
    writeRaw(dir, 'notes.txt', 'x');

    let latest = null;
    let scans = 0;
    const watcher = new SessionWatcher({
        dir,
        intervalSeconds: 1,
        onSessions: list => {
            latest = list;
            scans++;
        },
    });
    try {
        waitFor(() => latest !== null, WAIT_MS);
        check('only the live session', latest.map(x => [x.pid, x.status]), [[child, 'busy']]);

        writeSession(dir, child, {status: 'waiting'});
        waitFor(() => latest[0]?.status === 'waiting', WAIT_MS);
        check('change seen by the watcher', latest[0].status, 'waiting');

        writeRaw(dir, `${child}.json`, '{"pid": ');
        const before = scans;
        watcher.refresh();
        waitFor(() => scans > before, WAIT_MS);
        check('truncated rewrite keeps the session', latest.map(x => x.status), ['waiting']);

        // An unreadable folder is not an empty one: no report until it can be read again
        const reportsBefore = scans;
        setMode(dir, 0o000);
        try {
            watcher.refresh();
            idle(2500);
        } finally {
            setMode(dir, 0o700);
        }
        check('unreadable folder reports nothing', [scans, latest.map(x => x.status)],
            [reportsBefore, ['waiting']]);

        deleteFile(dir, `${child}.json`);
        waitFor(() => latest.length === 0, WAIT_MS);
        check('removed file', latest, []);
    } finally {
        watcher.destroy();
    }

    // Destroyed while its first scan runs
    let late = 0;
    const brief = new SessionWatcher({dir, intervalSeconds: 1, onSessions: () => late++});
    brief.destroy();
    const countAt = scans;
    watcher.refresh();
    idle(1500);
    check('no report after destroy', [scans, late], [countAt, 0]);

    // The first scan starts at once; the requests made during it run one more scan, and the
    // periodic scan is not due yet
    let burst = 0;
    const busy = new SessionWatcher({dir, intervalSeconds: 1, onSessions: () => burst++});
    for (let i = 0; i < 5; i++)
        busy.refresh();
    idle(600);
    busy.destroy();
    check('requests during a scan run one more scan', burst, 2);

    let reported = null;
    const missing = new SessionWatcher({
        dir: `${dir}/none`,
        intervalSeconds: 1,
        onSessions: list => (reported = list),
    });
    try {
        waitFor(() => reported !== null, WAIT_MS);
        check('missing folder reports nothing', reported, []);
    } finally {
        missing.destroy();
    }
});
