import assert from 'node:assert/strict';
import {test} from 'node:test';

import {State} from '../../../src/limits/status.js';
import {
    NO_PROJECT, activityView, chosenRecords, cursorOnDemand, cursorPlanUsage, formatAmount,
    limitRows, modelsView, projectsView,
} from '../src/view.js';

const now = new Date(2026, 9, 24, 15, 30).getTime();
const hour = new Date(2026, 9, 24, 10).getTime();
const rec = overrides => ({
    id: Math.random().toString(), t: hour, model: 'claude-opus-5-5', out: 10, input: 1,
    cacheRead: 0, cacheWrite: 0, cwd: '/w/app', branch: '', sidechain: false, source: 'claude',
    ...overrides,
});

test('limit rows for Claude Code and the Cursor plan', () => {
    const data = {
        five_hour: {utilization: 42, resets_at: new Date(now + 3600000).toISOString()},
        seven_day: {utilization: 18, resets_at: new Date(now + 86400000 * 3).toISOString()},
        limits: [{kind: 'weekly_scoped', percent: 7, resets_at: null,
            scope: {model: {display_name: 'Fable'}}}],
    };
    const plan = {summary: {billingCycleEnd: String(now + 86400000 * 10),
        individualUsage: {plan: {used: 50, limit: 200}}}};
    const rows = limitRows({state: State.FRESH, data}, plan,
        {modelLimits: true, resetStyle: 'countdown', nowMs: now});
    assert.deepEqual(rows.map(r => [r.name, r.percent, r.left, r.source]), [
        ['5-hour', 42, '1h 0m', 'claude'],
        ['Weekly', 18, '3d 0h', 'claude'],
        ['Fable weekly', 7, '—', 'claude'],
        ['Cursor plan', 25, '10d 0h', 'cursor'],
    ]);
});

test('what Cursor billed on demand is a row with dollars and no limit', () => {
    const plan = {summary: {billingCycleEnd: String(now + 86400000 * 10),
        individualUsage: {plan: {used: 50, limit: 200},
            onDemand: {enabled: true, used: 1006, limit: null}}}};
    const rows = limitRows({state: State.FRESH, data: null}, plan,
        {modelLimits: false, resetStyle: 'countdown', nowMs: now});
    assert.deepEqual(rows.map(r => [r.name, r.percent, r.text, r.left]), [
        ['Cursor plan', 25, undefined, '10d 0h'],
        ['On demand', null, '$10.06', '10d 0h'],
    ]);
});

test('the plan percentage comes from the service when it has one', () => {
    assert.equal(cursorPlanUsage({summary: {individualUsage: {plan: {totalPercentUsed: 61,
        used: 1, limit: 2}}}}).percent, 61);
    assert.equal(cursorPlanUsage(null), null);
});

test('projects list each model, and unknown folders are named', () => {
    const records = [
        rec({out: 30}), rec({model: 'gpt-5.6', out: 10, source: 'cursor'}),
        rec({cwd: '', model: 'grok-4.7', out: 5, source: 'cursor'}),
    ];
    const view = projectsView(records, {range: '7d', projectNames: 'folder', home: '', nowMs: now});
    assert.equal(view.header, 'LAST 7 DAYS');
    assert.deepEqual(view.rows.map(r => [r.label, r.models.map(m => m.label)]), [
        ['app', ['Opus 5.5', 'GPT-5.6']],
        [NO_PROJECT, ['Grok 4.7']],
    ]);
});

test('sources and hidden projects filter the records', () => {
    const records = [rec({}), rec({source: 'cursor'}), rec({cwd: '/w/secret'})];
    assert.equal(chosenRecords(records, 'cursor', {count: 'output', hiddenProjects: []}).length, 1);
    assert.equal(chosenRecords(records, 'all', {count: 'output', hiddenProjects: ['secret']})
        .length, 2);
});

test('cost counts Cursor only, whatever the source', () => {
    const records = [rec({out: 30}), rec({source: 'cursor', cents: 250, model: 'gpt-5.6'}),
        rec({source: 'cursor', cents: 0}), rec({source: 'cursor', cents: 40, cwd: '/w/blog'})];
    for (const source of ['all', 'claude', 'cursor']) {
        const picked = chosenRecords(records, source, {count: 'cost', hiddenProjects: []});
        assert.deepEqual(picked.map(r => r.out), [250, 40], source);
    }
    const view = projectsView(chosenRecords(records, 'cursor', {count: 'cost', hiddenProjects: []}),
        {range: '7d', projectNames: 'folder', home: '', unit: 'cost', nowMs: now});
    assert.equal(view.unit, 'cost');
    assert.equal(view.total, 290);
    assert.deepEqual(view.rows.map(r => [r.label, r.out]), [['app', 250], ['blog', 40]]);
});

test('amounts are shown as tokens or as dollars', () => {
    assert.equal(formatAmount(502000, 'tokens'), '502K');
    assert.equal(formatAmount(1240, 'cost'), '$12.40');
    assert.equal(modelsView([rec({})], {range: 'today', nowMs: now}).unit, 'tokens');
});

test('what Cursor billed beyond the plan', () => {
    const plan = {summary: {billingCycleEnd: '2026-11-19T18:25:39.000Z',
        individualUsage: {onDemand: {enabled: true, used: 1006, limit: null}}}};
    assert.deepEqual(cursorOnDemand(plan),
        {cents: 1006, resetsAt: '2026-11-19T18:25:39.000Z'});
    assert.equal(cursorOnDemand({summary: {individualUsage: {onDemand: {enabled: false,
        used: 5}}}}), null);
    assert.equal(cursorOnDemand({summary: {individualUsage: {plan: {}}}}), null);
    assert.equal(cursorOnDemand(null), null);
});

test('models and activity views', () => {
    const records = [rec({out: 30}), rec({model: 'gpt-5.6', out: 10})];
    const models = modelsView(records, {range: 'today', nowMs: now});
    assert.deepEqual(models.rows.map(r => [r.label, r.family, r.share]),
        [['Opus 5.5', 'opus', 0.75], ['GPT-5.6', 'other', 0.25]]);
    const activity = activityView(records, {range: '7d', nowMs: now});
    assert.equal(activity.periods.length, 7);
    assert.equal(activity.total, 40);
    assert.equal(activity.hours[10], 40);
    assert.deepEqual(activity.families.map(f => f.name), ['Opus', 'Other']);
});
