import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, test} from 'node:test';

import {updateClaudeIndex} from '../src/claude-index.js';
import {Source, loadRecords} from '../src/history.js';
import {readClaudeLogin} from '../src/credentials.js';
import {claudeDir as resolveDir, dataDir as dataFolder, normalizeProjectPath} from '../src/paths.js';

let root;
beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'cm-history-'));
});
afterEach(() => rm(root, {recursive: true, force: true}));

const line = (id, out, model = 'claude-opus-5-5', cwd = 'c:\\work\\app') => JSON.stringify({
    type: 'assistant', timestamp: '2026-10-24T12:00:00Z', cwd,
    message: {id, model, usage: {output_tokens: out, input_tokens: 1}},
});

test('the index reads transcripts once and keeps the model ids', async () => {
    const claudeDir = path.join(root, 'claude');
    const dataDir = path.join(root, 'data');
    const project = path.join(claudeDir, 'projects', 'p');
    await mkdir(project, {recursive: true});
    await writeFile(path.join(project, 's.jsonl'), [
        line('m1', 10), line('m1', 30), line('m2', 5, 'claude-sonnet-5-5'), 'not json', '',
    ].join('\n'));

    const first = await updateClaudeIndex({claudeDir, dataDir});
    assert.deepEqual(first, {records: 2, filesRead: 1});
    const again = await updateClaudeIndex({claudeDir, dataDir});
    assert.equal(again.filesRead, 0);

    const records = await loadRecords(dataDir, [Source.CLAUDE]);
    const byModel = Object.fromEntries(records.map(r => [r.model, r.out]));
    assert.deepEqual(byModel, {'claude-opus-5-5': 30, 'claude-sonnet-5-5': 5});
    assert.ok(records.every(r => r.source === 'claude' && r.cwd === 'C:\\work\\app'));
});

test('a source never read adds nothing', async () => {
    assert.deepEqual(await loadRecords(root, [Source.CLAUDE, Source.CURSOR]), []);
});

test('the login is read from the file outside macOS', async () => {
    await writeFile(path.join(root, '.credentials.json'),
        JSON.stringify({claudeAiOauth: {accessToken: 'x', expiresAt: 5}}));
    assert.equal((await readClaudeLogin(root, 'win32')).accessToken, 'x');
    assert.equal(await readClaudeLogin(path.join(root, 'none'), 'linux'), null);
});

test('data folders per platform', () => {
    assert.equal(dataFolder({LOCALAPPDATA: 'C:\\L'}, 'win32', 'C:\\U'), 'C:\\L\\claudometer');
    assert.equal(dataFolder({}, 'darwin', '/Users/u'),
        '/Users/u/Library/Application Support/claudometer');
    assert.equal(dataFolder({}, 'linux', '/home/u'), '/home/u/.local/share/claudometer');
    assert.equal(dataFolder({CLAUDOMETER_DATA_DIR: '/x'}, 'linux', '/home/u'), '/x');
});

test('the Claude Code folder follows the setting, then the environment', () => {
    assert.equal(resolveDir('', {CLAUDE_CONFIG_DIR: root}), path.normalize(root));
    assert.equal(resolveDir(root, {CLAUDE_CONFIG_DIR: '/other'}), path.normalize(root));
});

test('drive letters are one case', () => {
    assert.equal(normalizeProjectPath('c:\\Users\\u'), 'C:\\Users\\u');
    assert.equal(normalizeProjectPath('/home/u'), '/home/u');
});
