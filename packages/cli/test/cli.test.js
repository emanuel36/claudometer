import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, test} from 'node:test';

import {DEFAULTS} from '@claudometer/core';

import {installStatusLine, statusLineCommand, uninstallStatusLine} from '../src/install.js';
import {painter, renderLimits, renderModels, renderProjects} from '../src/render.js';
import {statusLine} from '../src/statusline.js';

let root;
beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'cm-cli-'));
});
afterEach(() => rm(root, {recursive: true, force: true}));

const plain = painter(false);
const settingsOf = async () => JSON.parse(await readFile(path.join(root, 'settings.json'), 'utf8'));

test('the status line command uses full paths, with forward slashes on Windows', () => {
    assert.equal(statusLineCommand('C:\\node\\node.exe', 'C:\\cm\\claudometer.js', 'win32'),
        '"C:/node/node.exe" "C:/cm/claudometer.js" statusline');
});

test('installing keeps other settings and never replaces another status line unasked',
    async () => {
        await writeFile(path.join(root, 'settings.json'),
            JSON.stringify({theme: 'dark', statusLine: {type: 'command', command: 'mine'}}));
        const command = '"node" "/x/claudometer.js" statusline';
        assert.equal((await installStatusLine({claudeDir: root, command})).installed, false);
        assert.equal((await installStatusLine({claudeDir: root, command, force: true})).installed,
            true);
        assert.deepEqual(await settingsOf(),
            {theme: 'dark', statusLine: {type: 'command', command, padding: 0}});
        assert.equal(await uninstallStatusLine({claudeDir: root}), true);
        assert.deepEqual(await settingsOf(), {theme: 'dark'});
    });

test('broken settings are left alone', async () => {
    await writeFile(path.join(root, 'settings.json'), '{ // comment');
    await assert.rejects(installStatusLine({claudeDir: root, command: 'c'}), /not valid JSON/);
});

test('limits table', () => {
    const text = renderLimits([{name: '5-hour', percent: 42, left: '2h 14m', source: 'claude'}],
        'Updated just now', {paint: plain, stale: false});
    assert.deepEqual(text.split('\n'), [
        'LIMITS',
        'LIMIT                USED  LEFT',
        '5-hour  ████░░░░░░    42%  2h 14m',
        'Updated just now',
    ]);
});

test('projects list their models under them', () => {
    const text = renderProjects({header: 'TODAY', total: 10, other: null, rows: [{
        label: 'app', out: 10, share: 1,
        models: [{label: 'Opus 5.5', out: 6, share: 0.6}, {label: 'GPT-5.6', out: 4, share: 0.4}],
    }]}, {paint: plain});
    assert.match(text, /^app +100% +10\n {2}Opus 5\.5 +60% +6\n {2}GPT-5\.6 +40% +4$/m);
});

test('the on-demand row shows dollars and no meter', () => {
    const text = renderLimits([
        {name: 'Cursor plan', percent: 20, left: '24d 6h', source: 'cursor'},
        {name: 'On demand', percent: null, text: '$10.06', left: '24d 6h', source: 'cursor'},
    ], 'Updated just now', {paint: plain, stale: false});
    const lines = text.split('\n');
    assert.match(lines[2], /^Cursor plan +█+░* +20% +24d 6h$/);
    assert.match(lines[3], /^On demand +\$10\.06 +24d 6h$/);
});

test('projects and models show dollars when the view is the cost', () => {
    const project = {label: 'app', out: 1240, share: 1,
        models: [{label: 'GPT-5.6', out: 1240, share: 1}]};
    const projects = renderProjects({header: 'LAST 7 DAYS', unit: 'cost', total: 1240,
        other: null, rows: [project]}, {paint: plain});
    assert.match(projects, /^PROJECTS · LAST 7 DAYS · \$12\.40 token cost$/m);
    assert.match(projects, /^app +100% +\$12\.40\n {2}GPT-5\.6 +100% +\$12\.40$/m);
    const models = renderModels({header: 'TODAY', unit: 'cost', total: 1240,
        rows: [{label: 'GPT-5.6', out: 1240, share: 1}]}, {paint: plain});
    assert.match(models, /\$12\.40$/m);
});

test('the status line reads the cache and asks for a refresh when it is old', async () => {
    const nowMs = Date.now();
    await writeFile(path.join(root, 'usage-cache.json'), JSON.stringify({
        version: 1, state: 'fresh', lastAttemptMs: nowMs - 3600000, lastSuccessMs: nowMs,
        data: {five_hour: {utilization: 42, resets_at: new Date(nowMs + 600000).toISOString()},
            seven_day: {utilization: 18}},
    }));
    let refreshed = 0;
    const line = await statusLine('{}', {dataDir: root, config: DEFAULTS, paint: plain, nowMs,
        refresh: () => refreshed++});
    assert.equal(line, '✻ 5h 42% 10m · wk 18%');
    assert.equal(refreshed, 1);
});
