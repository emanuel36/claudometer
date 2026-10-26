import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, test} from 'node:test';

import {sessionCookie} from '../src/cursor/api.js';
import {eventRecords, eventRow} from '../src/cursor/cursor-index.js';
import {
    hookCommand, installHook, isHookInstalled, parseHookLog, uninstallHook, withHook,
    withoutHook,
} from '../src/cursor/hook.js';

let root;
beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'cm-cursor-'));
});
afterEach(() => rm(root, {recursive: true, force: true}));

const event = (overrides = {}) => ({
    timestamp: '1793014651496', model: 'grok-4.7-xhigh', conversationId: 'c1',
    usageEventId: 'e1',
    kind: 'USAGE_EVENT_KIND_USAGE_BASED',
    tokenUsage: {inputTokens: 100, outputTokens: 20, cacheReadTokens: 3, cacheWriteTokens: 4,
        totalCents: 53.45},
    ...overrides,
});

test('an event becomes an index row, with what its tokens cost', () => {
    assert.deepEqual(eventRow(event()),
        ['e1', 1793014651496, 'grok-4.7-xhigh', 20, 100, 3, 4, 'c1', 53.45]);
});

test('tokens a plan or a free credit covered still have their cost', () => {
    for (const kind of ['USAGE_EVENT_KIND_INCLUDED_IN_BUSINESS', 'USAGE_EVENT_KIND_FREE_CREDIT'])
        assert.equal(eventRow(event({kind}))[8], 53.45);
});

test('events Cursor did not charge cost nothing', () => {
    for (const kind of ['USAGE_EVENT_KIND_ERRORED_NOT_CHARGED',
        'USAGE_EVENT_KIND_ABORTED_NOT_CHARGED'])
        assert.equal(eventRow(event({kind}))[8], 0);
});

test('a missing or odd cost is zero', () => {
    const tokens = {inputTokens: 1, outputTokens: 1};
    for (const totalCents of [undefined, null, 'x', -3, NaN])
        assert.equal(eventRow(event({tokenUsage: {...tokens, totalCents}}))[8], 0);
});

test('events without tokens or time are dropped', () => {
    assert.equal(eventRow(event({tokenUsage: {}})), null);
    assert.equal(eventRow(event({timestamp: 'x'})), null);
});

test('rows take their project from the conversation', () => {
    const rows = [eventRow(event()), eventRow(event({usageEventId: 'e2', conversationId: 'c9'}))];
    const records = eventRecords(rows, new Map([['c1', 'C:\\dev\\app']]));
    assert.deepEqual(records.map(r => [r.cwd, r.model, r.out]),
        [['C:\\dev\\app', 'grok-4.7-xhigh', 20], ['', 'grok-4.7-xhigh', 20]]);
});

test('records carry the cost, and only when there is one', () => {
    const records = eventRecords([eventRow(event()),
        eventRow(event({usageEventId: 'e2', kind: 'USAGE_EVENT_KIND_ERRORED_NOT_CHARGED'}))],
    new Map());
    assert.equal(records[0].cents, 53.45);
    assert.equal('cents' in records[1], false);
});

test('the session cookie uses the user id of the token', () => {
    const payload = Buffer.from(JSON.stringify({sub: 'google-oauth2|user_1'})).toString('base64url');
    const token = `h.${payload}.s`;
    assert.equal(sessionCookie(token), `WorkosCursorSessionToken=user_1%3A%3A${token}`);
});

test('the hook is added once and other hooks stay', () => {
    const config = {version: 1, hooks: {stop: [{command: 'other'}], afterFileEdit: [{command: 'f'}]}};
    const once = withHook(withHook(config, 'sh "/d/claudometer-cursor-hook.sh"'),
        'sh "/d/claudometer-cursor-hook.sh"');
    assert.equal(once.hooks.stop.length, 2);
    assert.deepEqual(once.hooks.afterFileEdit, [{command: 'f'}]);
    assert.deepEqual(withoutHook(once), config);
    assert.deepEqual(withoutHook({version: 1, hooks: {stop: once.hooks.stop.slice(1)}}),
        {version: 1, hooks: {}});
});

test('hook commands per platform', () => {
    assert.match(hookCommand('C:\\data', 'win32'), /^powershell .*-File "C:\\data\\claudometer-cursor-hook\.ps1"$/);
    assert.equal(hookCommand('/d a', 'darwin'), 'sh "/d a/claudometer-cursor-hook.sh"');
});

test('installing keeps a backup and refuses broken JSON', async () => {
    const cursorHome = path.join(root, 'cursor');
    const dataDir = path.join(root, 'data');
    await installHook(cursorHome, dataDir, 'linux');
    assert.ok(await isHookInstalled(cursorHome));
    await installHook(cursorHome, dataDir, 'linux');
    const config = JSON.parse(await readFile(path.join(cursorHome, 'hooks.json'), 'utf8'));
    assert.equal(config.hooks.stop.length, 1);
    await uninstallHook(cursorHome);
    assert.equal(await isHookInstalled(cursorHome), false);

    await writeFile(path.join(cursorHome, 'hooks.json'), '{broken');
    await assert.rejects(installHook(cursorHome, dataDir, 'linux'), /not valid JSON/);
    assert.equal(await readFile(path.join(cursorHome, 'hooks.json'), 'utf8'), '{broken');
});

test('the hook log maps conversations to their first root', () => {
    const log = '\uFEFF' + [
        JSON.stringify({conversation_id: 'a', workspace_roots: ['/c:/dev/app']}),
        'garbage',
        JSON.stringify({conversation_id: 'b', workspace_roots: '/home/u/x'}),
        JSON.stringify({conversation_id: 'c', workspace_roots: []}),
    ].join('\r\n');
    const projects = parseHookLog(log);
    assert.equal(projects.size, 2);
    assert.match(projects.get('a'), /^C:[\\/]dev[\\/]app$/);
});
