// Run with: gjs -m tests/export.test.js
import System from 'system';

import {exportCsv} from '../src/history/export.js';

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

const t = (d, h) => new Date(2026, 9, d, h).getTime();
const r = (o) => ({id: `${o.t}|${o.cwd}`, model: 'opus', out: 1, input: 2, cacheRead: 3,
    cacheWrite: 4, cwd: '/w/a', branch: '', sidechain: false, ...o});
check('header only', exportCsv([]), 'date,project,model,output,input,cache_read,cache_write\n');
check('sums a day per project and model', exportCsv([r({t: t(24, 9)}), r({t: t(24, 15)}),
    r({t: t(23, 9), model: 'sonnet'})]).split('\n').slice(1, 3),
    ['2026-10-23,/w/a,Sonnet,1,2,3,4', '2026-10-24,/w/a,Opus,2,4,6,8']);
check('quotes awkward paths', exportCsv([r({t: t(24, 9), cwd: '/w/a,"b"'})]).split('\n')[1],
    '2026-10-24,"/w/a,""b""",Opus,1,2,3,4');

if (failures > 0) {
    print(`\n${failures} failed`);
    System.exit(1);
}
print('\nall passed');
