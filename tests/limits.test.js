// Run with: gjs -m tests/limits.test.js
import System from 'system';

import {scopedLimits} from '../src/limits/limits.js';

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

const RESET = '2026-10-25T17:00:00.043176+00:00';
const fable = {kind: 'weekly_scoped', group: 'weekly', percent: 8, resets_at: RESET,
    scope: {model: {id: null, display_name: 'Fable'}, surface: null}};

check('a per-model weekly limit', scopedLimits({limits: [
    {kind: 'session', percent: 21, resets_at: RESET},
    {kind: 'weekly_all', percent: 36, resets_at: RESET},
    fable,
]}), [{name: 'Fable', percent: 8, resetsAt: RESET}]);
check('several per-model limits keep their order', scopedLimits({limits: [
    fable, {...fable, percent: 3, scope: {model: {display_name: 'Opus'}}},
]}).map(l => l.name), ['Fable', 'Opus']);
check('no limits field', scopedLimits({}), []);
check('limits that are not an array', scopedLimits({limits: 'x'}), []);
check('a scoped limit without a model name is skipped',
    scopedLimits({limits: [{...fable, scope: {model: {id: 'x'}}}]}), []);
check('a scoped limit without a percentage is skipped',
    scopedLimits({limits: [{...fable, percent: null}]}), []);

if (failures > 0) {
    print(`${failures} failed`);
    System.exit(1);
}
print('all passed');
