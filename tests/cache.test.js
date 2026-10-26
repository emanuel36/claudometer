// Run with: gjs -m tests/cache.test.js
import System from 'system';

import {firstRequestDelayMs, parseCache, serializeCache} from '../src/limits/cache.js';

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

const LOGIN = '/home/u/.claude/.credentials.json';
const NOW = 1_800_000_000_000;
const MIN = 60_000;
const saved = {
    credentialsPath: LOGIN,
    data: {limits: [{kind: 'session', percent: 21}]},
    lastSuccessMs: NOW - 2 * MIN,
    lastRequestMs: NOW - 2 * MIN,
    backoffSeconds: 0,
    backoffUntilMs: 0,
};
const {credentialsPath: _, ...fields} = saved;

// parseCache
check('round trip', parseCache(serializeCache(saved), LOGIN), fields);
check('another login is ignored', parseCache(serializeCache(saved), '/other/.credentials.json'),
    null);
check('not JSON', parseCache('{', LOGIN), null);
check('another version', parseCache(JSON.stringify({...saved, version: 2}), LOGIN), null);
check('a missing time', parseCache(JSON.stringify({...saved, version: 1, lastRequestMs: null}),
    LOGIN), null);
check('no data yet', parseCache(serializeCache({...saved, data: null}), LOGIN).data, null);
check('data that is not an object',
    parseCache(serializeCache({...saved, data: 'x'}), LOGIN).data, null);

// firstRequestDelayMs, with a 5 min interval
check('no cache asks now', firstRequestDelayMs(null, 300, NOW), 0);
check('waits for the rest of the interval', firstRequestDelayMs(fields, 300, NOW), 3 * MIN);
check('an interval that has passed asks now',
    firstRequestDelayMs({...fields, lastRequestMs: NOW - 10 * MIN}, 300, NOW), 0);
check('a backoff longer than the interval wins',
    firstRequestDelayMs({...fields, backoffUntilMs: NOW + 20 * MIN}, 300, NOW), 20 * MIN);
check('a backoff that has ended does not count',
    firstRequestDelayMs({...fields, lastRequestMs: NOW - 10 * MIN, backoffUntilMs: NOW - MIN},
        300, NOW), 0);
check('a request time in the future asks now',
    firstRequestDelayMs({...fields, lastRequestMs: NOW + MIN}, 300, NOW), 0);

if (failures > 0) {
    print(`${failures} failed`);
    System.exit(1);
}
print('all passed');
