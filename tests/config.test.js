// Run with: gjs -m tests/config.test.js
import System from 'system';

import {
    REFRESH_CHOICES, indexGapSeconds, keepDays, keepFields, resolveClaudeDir,
} from '../src/prefs/config.js';

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


check('default folder', resolveClaudeDir('', null, '/home/u'), '/home/u/.claude');
check('env folder', resolveClaudeDir('  ', '/opt/claude', '/home/u'), '/opt/claude');
check('setting wins', resolveClaudeDir('/data/c', '/opt/claude', '/home/u'), '/data/c');
check('tilde expands',
    resolveClaudeDir('~/work/.claude/', null, '/home/u'), '/home/u/work/.claude');
check('bare tilde', resolveClaudeDir('~', null, '/home/u'), '/home/u');
check('gap 5 min', indexGapSeconds('every-5'), 300);
check('gap 15 min', indexGapSeconds('every-15'), 900);
check('gap on open', indexGapSeconds('on-open'), 0);
check('refresh choices', REFRESH_CHOICES.length, 5);

check('keep forever', keepDays(true, 6, 'months'), 0);
check('keep 6 months', keepDays(false, 6, 'months'), 180);
check('fields forever', keepFields(0), {forever: true, amount: 6, unit: 'months'});
check('fields 45 days', keepFields(45), {forever: false, amount: 45, unit: 'days'});
check('fields 365 days', keepFields(365), {forever: false, amount: 1, unit: 'years'});
check('fields 14 days', keepFields(14), {forever: false, amount: 2, unit: 'weeks'});

if (failures > 0) {
    print(`\n${failures} failed`);
    System.exit(1);
}
print('\nall passed');
