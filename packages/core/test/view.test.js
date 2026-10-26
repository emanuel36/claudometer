import assert from 'node:assert/strict';
import {test} from 'node:test';

import {State} from '../../../src/limits/status.js';
import {
    NO_PROJECT, activityView, chosenRecords, cursorPlanUsage, limitRows, modelsView, projectsView,
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
