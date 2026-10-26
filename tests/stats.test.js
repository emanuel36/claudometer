// Run with: gjs -m tests/stats.test.js
import System from 'system';

import {
    bucketRecords, countAmount, dayStats, formatCost, formatTokens, hourStats, modelFamily,
    modelIdTotals, modelLabel, modelTotals, parseHiddenProjects, periodStats, projectModelStats,
    projectStats, rangeFrom, rangeHeader, rangeStart, selectRecords,
} from '../src/history/stats.js';

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

const now = new Date(2026, 9, 24, 15, 30).getTime();
const at = (month, day, hour = 12, minute = 0) =>
    new Date(2026, month, day, hour, minute).getTime();

let n = 0;
function rec(overrides = {}) {
    n++;
    return {
        id: `m${n}`, t: at(9, 24), model: 'claude-opus-5-5', out: 100, input: 0, cacheRead: 0,
        cacheWrite: 0, cwd: '/home/u/billing-api', branch: 'main', sidechain: false,
        ...overrides,
    };
}

// modelFamily
check('opus', modelFamily('claude-opus-5-5'), 'opus');
check('sonnet', modelFamily('claude-sonnet-5-5'), 'sonnet');
check('haiku', modelFamily('claude-haiku-4-5-20251001'), 'haiku');
check('fable', modelFamily('claude-fable-5-1'), 'fable');
check('unknown model', modelFamily('gpt-x'), 'other');

// rangeStart
check('today starts at local midnight', rangeStart(now, 1), at(9, 24, 0));
check('7 days starts 6 days before today', rangeStart(now, 7), at(9, 18, 0));

// dayStats
const days = dayStats([
    rec({t: at(9, 23, 23, 59), out: 30}),
    rec({t: at(9, 24, 0, 0), out: 70, model: 'claude-sonnet-5-5'}),
    rec({t: at(9, 24, 9), out: 5}),
], 7, now);
check('dayStats has one entry per day, oldest first', days.map(d => d.label),
    ['Oct 18', 'Oct 19', 'Oct 20', 'Oct 21', 'Oct 22', 'Oct 23', 'Oct 24']);
check('23:59 belongs to the previous day', days[5].total, 30);
check('00:00 belongs to the new day', days[6].byFamily, {sonnet: 70, opus: 5});
check('day total sums families', days[6].total, 75);
check('days without records are empty', [days[0].total, days[0].byFamily], [0, {}]);
check('day startMs is local midnight', days[6].startMs, at(9, 24, 0));

// hourStats
const hours = hourStats([
    rec({t: at(9, 24, 14, 10), out: 10}),
    rec({t: at(9, 24, 14, 50), out: 20}),
    rec({t: at(9, 24, 3, 0), out: 4}),
], at(9, 24, 0), now);
check('hourStats sums by local hour', [hours.length, hours[14], hours[3], hours[0]],
    [24, 30, 4, 0]);

// modelTotals
check('modelTotals orders by output and puts other last', modelTotals([
    rec({model: 'claude-sonnet-5-5', out: 50}), rec({model: 'claude-opus-5-5', out: 100}),
    rec({model: 'claude-fable-5-1', out: 30}), rec({model: 'claude-haiku-4-5', out: 10}),
    rec({model: 'gpt-x', out: 500}),
], at(9, 1), now), [
    {family: 'opus', out: 100}, {family: 'sonnet', out: 50}, {family: 'fable', out: 30},
    {family: 'haiku', out: 10}, {family: 'other', out: 500},
]);
check('modelTotals with two families has no other', modelTotals([
    rec({out: 7}), rec({model: 'claude-sonnet-5-5', out: 9}),
], at(9, 1), now), [{family: 'sonnet', out: 9}, {family: 'opus', out: 7}]);
check('modelTotals ignores records outside the range', modelTotals([
    rec({t: at(8, 1), out: 99}),
], at(9, 1), now), []);

// projectStats
const six = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6'].map((name, i) =>
    rec({cwd: `/work/${name}`, out: 60 - i * 10}));
const stats = projectStats(six, at(9, 1), now);
check('top five projects plus other', [stats.rows.length, stats.total, stats.other],
    [5, 210, {out: 10, share: 10 / 210}]);
check('rows are ranked by output with shares',
    stats.rows.slice(0, 2).map(r => [r.label, r.out, r.share]),
    [['a1', 60, 60 / 210], ['b2', 50, 50 / 210]]);
check('rows are the five biggest projects', stats.rows.map(r => r.label),
    ['a1', 'b2', 'c3', 'd4', 'e5']);

const twins = projectStats([
    rec({cwd: '/a/app', out: 10}), rec({cwd: '/b/app', out: 20}), rec({cwd: '/c/solo', out: 5}),
], at(9, 1), now);
check('same last component adds the parent folder', twins.rows.map(r => r.label),
    ['app (b)', 'app (a)', 'solo']);

check('rows carry label, output and share only', Object.keys(stats.rows[0]),
    ['label', 'out', 'share']);

check('empty range projectStats', projectStats([], at(9, 1), now),
    {total: 0, rows: [], other: null});

// rangeFrom
const DAY = 86400000;
check('range today', rangeFrom('today', now, []), at(9, 24, 0));
check('range 7d', rangeFrom('7d', now, []), at(9, 18, 0));
check('range 30d', rangeFrom('30d', now, []), at(8, 25, 0));
check('range 6m covers 26 weeks', rangeFrom('6m', now, []), rangeStart(now, 182));
check('range all starts at the first record',
    rangeFrom('all', now, [rec({t: at(1, 25, 12, 40)}), rec({t: at(9, 1)})]), at(1, 25, 12, 40));
check('range all without records is now', rangeFrom('all', now, []), now);

// periodStats
check('30d has one bar per day', periodStats([], '30d', now).length, 30);
const weeks = periodStats([
    rec({t: at(9, 18, 9), out: 4}), rec({t: at(9, 17, 9), out: 6}),
], '6m', now);
check('6m has 26 weekly bars, the last one starting 6 days ago',
    [weeks.length, weeks[25].startMs, weeks[0].startMs], [26, at(9, 18, 0), rangeStart(now, 182)]);
check('a record lands in the week that contains it', [weeks[25].total, weeks[24].total], [4, 6]);
const months = periodStats([
    rec({t: at(7, 3), out: 1}), rec({t: at(9, 20), out: 2, model: 'claude-fable-5-1'}),
], 'all', now);
check('all has one bar per month from the first record',
    months.map(m => [m.label, m.total]), [['Aug 2026', 1], ['Sep 2026', 0], ['Oct 2026', 2]]);
check('all without records is the current month', periodStats([], 'all', now).map(m => m.label),
    ['Oct 2026']);
check('period bars split by family', months[2].byFamily, {fable: 2});

// bucketRecords
const buckets = bucketRecords([
    rec({t: at(9, 24, 14, 10), out: 10, input: 1, cacheRead: 100, cacheWrite: 5}),
    rec({t: at(9, 24, 14, 50), out: 20, input: 2, cacheRead: 200, cacheWrite: 6}),
    rec({t: at(9, 24, 14, 55), out: 7, sidechain: true}),
    rec({t: at(9, 24, 15, 5), out: 3}),
    rec({t: at(9, 24, 14, 20), out: 9, model: 'claude-sonnet-5-5'}),
]);
const first = buckets.find(b => b.t === at(9, 24, 14) && b.model === 'opus' && !b.sidechain);
check('records of one hour, project, family and kind are summed',
    [first.out, first.input, first.cacheRead, first.cacheWrite], [30, 3, 300, 11]);
check('buckets are split by sidechain, hour and family', buckets.length, 4);
check('a bucket keeps the record shape', Object.keys(first),
    ['id', 't', 'model', 'out', 'input', 'cacheRead', 'cacheWrite', 'cwd', 'branch', 'sidechain']);
check('buckets give the same project totals as the records',
    projectStats(buckets, at(9, 1), now).total, 49);
check('bucketing loses no time precision that matters', hourStats(buckets, at(9, 24, 0), now)[14],
    46);

// formatTokens
check('formatTokens small', formatTokens(980), '980');
check('formatTokens thousands', formatTokens(502000), '502K');
check('formatTokens millions', formatTokens(1234567), '1.2M');
check('formatTokens zero', formatTokens(0), '0');
check('formatTokens rounds up to millions', formatTokens(999600), '1.0M');

const mixed = [rec({cwd: '/w/a', out: 10, input: 5, cacheRead: 100, cacheWrite: 1000}),
    rec({cwd: '/w/scratch', out: 7})];
check('count output', selectRecords(mixed, {count: 'output', hidden: []}).map(r => r.out), [10, 7]);
check('count output and input', selectRecords(mixed, {count: 'output-input', hidden: []})
    .map(r => r.out), [15, 7]);
check('count all', selectRecords(mixed, {count: 'all', hidden: []}).map(r => r.out), [1115, 7]);
check('hidden project leaves', selectRecords(mixed, {count: 'output', hidden: ['scratch']})
    .map(r => r.cwd), ['/w/a']);
check('select does not change the input', mixed[0].out, 10);
check('parse hidden', parseHiddenProjects(' a, ,b,a'), ['a', 'b']);
check('parse hidden empty', parseHiddenProjects(''), []);
check('path names use ~', projectStats([rec({cwd: '/home/u/dev/app'}), rec({cwd: '/srv/x'})],
    at(9, 1), now, 5, 'path', '/home/u').rows.map(r => r.label), ['~/dev/app', '/srv/x']);
check('home itself', projectStats([rec({cwd: '/home/u'})], at(9, 1), now, 5, 'path', '/home/u')
    .rows[0].label, '~');
check('similar prefix is not home', projectStats([rec({cwd: '/home/user2/x'})], at(9, 1), now, 5,
    'path', '/home/u').rows[0].label, '/home/user2/x');

// Windows folders
const windows = projectStats([
    rec({cwd: 'C:\\Users\\u\\dev\\app', out: 10}), rec({cwd: 'C:\\Users\\u\\old\\app', out: 5}),
    rec({cwd: 'D:\\solo\\', out: 1}),
], at(9, 1), now);
check('windows folders are named by their last component', windows.rows.map(r => r.label),
    ['app (dev)', 'app (old)', 'solo']);
check('windows path names use ~', projectStats([rec({cwd: 'C:\\Users\\u\\dev\\app'})], at(9, 1),
    now, 5, 'path', 'C:\\Users\\u').rows[0].label, '~\\dev\\app');
check('hidden windows project leaves',
    selectRecords([rec({cwd: 'C:\\w\\scratch'}), rec({cwd: 'C:\\w\\a'})],
        {count: 'output', hidden: ['scratch']}).map(r => r.cwd), ['C:\\w\\a']);

// modelLabel
check('label claude', modelLabel('claude-opus-5-5'), 'Opus 5.5');
check('label drops the date', modelLabel('claude-haiku-4-5-20251001'), 'Haiku 4.5');
check('label puts the family first', modelLabel('claude-4.5-sonnet-thinking'),
    'Sonnet 4.5 Thinking');
check('label cursor effort', modelLabel('claude-sonnet-5-5-high'), 'Sonnet 5.5 High');
check('label gpt', modelLabel('gpt-5.6-sol-medium'), 'GPT-5.6 Sol Medium');
check('label grok', modelLabel('grok-4.7-xhigh'), 'Grok 4.7 XHigh');
check('label family', modelLabel('opus'), 'Opus');
check('label auto', modelLabel('default'), 'Auto');

// projectModelStats
const split = projectModelStats([
    rec({cwd: '/w/a', out: 30}), rec({cwd: '/w/a', out: 10, model: 'gpt-5.6'}),
    rec({cwd: '/w/b', out: 20, model: 'gpt-5.6'}), rec({cwd: '/w/c', out: 5}),
], at(9, 1), now, 2);
check('projects split by model, largest first',
    split.rows.map(r => [r.label, r.out, r.models.map(m => [m.label, m.out, m.share])]), [
        ['a', 40, [['Opus 5.5', 30, 0.75], ['GPT-5.6', 10, 0.25]]],
        ['b', 20, [['GPT-5.6', 20, 1]]],
    ]);
check('other projects keep their models', split.other,
    {out: 5, share: 5 / 65, models: [{model: 'claude-opus-5-5', label: 'Opus 5.5', out: 5,
        share: 1}]});
check('model id totals', modelIdTotals([rec({out: 3}), rec({model: 'gpt-5.6', out: 4})],
    at(9, 1), now).map(m => [m.model, m.out]), [['gpt-5.6', 4], ['claude-opus-5-5', 3]]);
check('buckets can keep the model id', bucketRecords([rec({model: 'gpt-5.6'})],
    {keepModel: true})[0].model, 'gpt-5.6');

check('count amount all',
    countAmount(rec({out: 1, input: 2, cacheRead: 3, cacheWrite: 4}), 'all'), 10);
// cost, in cents, only Cursor's events have it
const priced = [rec({out: 4, cents: 250}), rec({out: 9, cents: 40.5}), rec({out: 7})];
check('count amount cost', priced.map(r => countAmount(r, 'cost')), [250, 40.5, 0]);
check('cost drops what cost nothing',
    selectRecords(priced, {count: 'cost', hidden: []}).map(r => r.out), [250, 40.5]);
check('other counts keep the free ones',
    selectRecords(priced, {count: 'output', hidden: []}).map(r => r.out), [4, 9, 7]);
const costBuckets = bucketRecords([rec({cents: 100}), rec({cents: 20.5}), rec({out: 1})],
    {keepModel: true});
check('buckets sum the cost', costBuckets.map(b => b.cents), [120.5]);
check('buckets without a cost keep their shape',
    'cents' in bucketRecords([rec(), rec()])[0], false);

// formatCost
check('formatCost cents', formatCost(42), '$0.42');
check('formatCost dollars and cents', formatCost(1240), '$12.40');
check('formatCost whole dollars', formatCost(43210), '$432');
check('formatCost thousands', formatCost(123456), '$1.2K');
check('formatCost many thousands', formatCost(1234567), '$12K');
check('formatCost zero', formatCost(0), '$0.00');
check('formatCost rounds up to thousands', formatCost(99960), '$1.0K');
check('header for all', rangeHeader('all', new Date(2025, 9, 3).getTime()), 'SINCE OCT 2025');
check('header for 30d', rangeHeader('30d', 0), 'LAST 30 DAYS');

if (failures > 0) {
    print(`${failures} failed`);
    System.exit(1);
}
print('all passed');
