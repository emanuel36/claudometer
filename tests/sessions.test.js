// Run with: gjs -m tests/sessions.test.js
import System from 'system';

import {
    isGhostty, latestPerSession, parseSession, procStartFromStat, sessionState, ttyFromStat,
    waitingLabel,
} from '../src/sessions/sessions.js';

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

check('stat terminal', ttyFromStat('1198229 (claude) S 985680 1198229 985675 34818 ' +
    '1198229 4194304'), 34818);
check('stat terminal with ") " in the name', ttyFromStat('12 (a) 9 b) S 1 2 3 1026 5'), 1026);
check('stat without a terminal', ttyFromStat('12 (sleep) S 1 12 12 0 -1 4194304'), null);
check('stat terminal garbage', ttyFromStat('nonsense'), null);
check('stat cut short', ttyFromStat('12 (sleep) S 1 12'), null);

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

if (failures > 0) {
    print(`\n${failures} failed`);
    System.exit(1);
}
print('\nall passed');
