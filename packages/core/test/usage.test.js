import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, test} from 'node:test';

import {State} from '../../../src/limits/status.js';
import {readUsageCache, refreshUsage} from '../src/usage.js';

let dataDir;
beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'cm-usage-'));
});
afterEach(() => rm(dataDir, {recursive: true, force: true}));

const login = {accessToken: 'token-a', expiresAt: Date.now() + 3600000};
const readLogin = async () => login;

function answer(status, body = {}, headers = {}) {
    let calls = 0;
    const fetchImpl = async () => {
        calls++;
        return new Response(JSON.stringify(body), {status, headers});
    };
    return {fetchImpl, calls: () => calls};
}

test('a good answer is fresh and kept', async () => {
    const {fetchImpl} = answer(200, {five_hour: {utilization: 42}});
    const snapshot = await refreshUsage({claudeDir: '', dataDir, fetchImpl, readLogin});
    assert.equal(snapshot.state, State.FRESH);
    assert.equal(snapshot.data.five_hour.utilization, 42);
    assert.ok(snapshot.lastSuccessMs > 0);
});

test('a recent attempt by any process is reused', async () => {
    const {fetchImpl, calls} = answer(200, {});
    await refreshUsage({claudeDir: '', dataDir, fetchImpl, readLogin});
    await refreshUsage({claudeDir: '', dataDir, fetchImpl, readLogin, maxAgeMs: 60000});
    assert.equal(calls(), 1);
});

test('the service is not asked twice within a minute, even when forced', async () => {
    const {fetchImpl, calls} = answer(200, {});
    const nowMs = Date.now();
    await refreshUsage({claudeDir: '', dataDir, fetchImpl, readLogin, nowMs});
    await refreshUsage({claudeDir: '', dataDir, fetchImpl, readLogin, nowMs: nowMs + 30000});
    assert.equal(calls(), 1);
});

test('401 marks the token as rejected until it changes', async () => {
    const rejected = answer(401);
    const nowMs = Date.now();
    const first = await refreshUsage({claudeDir: '', dataDir, fetchImpl: rejected.fetchImpl,
        readLogin, nowMs});
    assert.equal(first.state, State.EXPIRED);
    const again = await refreshUsage({claudeDir: '', dataDir, fetchImpl: rejected.fetchImpl,
        readLogin, nowMs: nowMs + 120000});
    assert.equal(again.state, State.EXPIRED);
    assert.equal(rejected.calls(), 1);
});

test('429 backs off for Retry-After and keeps the last values', async () => {
    const nowMs = Date.now();
    await refreshUsage({claudeDir: '', dataDir, fetchImpl: answer(200, {x: 1}).fetchImpl,
        readLogin, nowMs});
    const limited = answer(429, {}, {'Retry-After': '600'});
    const snapshot = await refreshUsage({claudeDir: '', dataDir, fetchImpl: limited.fetchImpl,
        readLogin, nowMs: nowMs + 61000});
    assert.equal(snapshot.state, State.FAILED);
    assert.equal(snapshot.detail, 'HTTP 429');
    assert.deepEqual(snapshot.data, {x: 1});
    const cache = await readUsageCache(dataDir);
    assert.equal(cache.backoffUntilMs, nowMs + 61000 + 600000);
    await refreshUsage({claudeDir: '', dataDir, fetchImpl: limited.fetchImpl, readLogin,
        nowMs: nowMs + 200000});
    assert.equal(limited.calls(), 1);
});

test('no network is offline', async () => {
    const fetchImpl = async () => {
        throw new TypeError('fetch failed');
    };
    const snapshot = await refreshUsage({claudeDir: '', dataDir, fetchImpl, readLogin});
    assert.equal(snapshot.state, State.OFFLINE);
});

test('no login and an expired login never call the service', async () => {
    const {fetchImpl, calls} = answer(200);
    const none = await refreshUsage({claudeDir: '', dataDir, fetchImpl,
        readLogin: async () => null});
    assert.equal(none.state, State.NO_LOGIN);
    const expired = await refreshUsage({claudeDir: '', dataDir, fetchImpl,
        readLogin: async () => ({accessToken: 'b', expiresAt: 1})});
    assert.equal(expired.state, State.EXPIRED);
    assert.equal(calls(), 0);
});
