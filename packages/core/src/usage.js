import {createHash} from 'node:crypto';
import {watch} from 'node:fs';
import path from 'node:path';

import {State, backoffSeconds, isTokenExpired, stateForStatus} from '../../../src/limits/status.js';
import {credentialsPath, readClaudeLogin} from './credentials.js';
import {readJson, tryLock, writeAtomically} from './files.js';

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const USAGE_BETA = 'oauth-2025-04-20';
const REQUEST_TIMEOUT_MS = 15000;
// The service answers 429 when asked too often, so nothing asks again sooner than this
const MIN_GAP_MS = 60000;
const OFFLINE_RETRY_MS = 30000;
const EVENT_DELAY_MS = 1000;
const CACHE_VERSION = 1;

const EMPTY = {
    version: CACHE_VERSION, state: State.FRESH, detail: null, data: null, lastSuccessMs: 0,
    lastAttemptMs: 0, lastResponseMs: 0, backoffSeconds: 0, backoffUntilMs: 0,
    rejectedToken: null,
};

export function usageCachePath(dataDir) {
    return path.join(dataDir, 'usage-cache.json');
}

const hashToken = token => createHash('sha256').update(token).digest('hex');

/** Returns: `{state, detail, data, lastSuccessMs}`, the shape every view takes. */
export function snapshotOf(cache) {
    const {state, detail, data, lastSuccessMs} = cache;
    return {state, detail, data, lastSuccessMs};
}

/** Returns: The cache every Claudometer process shares; empty when there is none yet. */
export async function readUsageCache(dataDir) {
    const cache = await readJson(usageCachePath(dataDir));
    return cache?.version === CACHE_VERSION ? {...EMPTY, ...cache} : {...EMPTY};
}

async function request(token, fetchImpl) {
    try {
        const response = await fetchImpl(USAGE_URL, {
            headers: {'Authorization': `Bearer ${token}`, 'anthropic-beta': USAGE_BETA},
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        return {status: response.status, retryAfter: response.headers.get('retry-after'),
            text: await response.text()};
    } catch {
        return null;
    }
}

/**
 * Bring the shared usage cache up to date, at most once per `maxAgeMs` across every process,
 * and never while the service asked to back off.
 *
 * Args:
 *     options: `claudeDir`, `dataDir`, `maxAgeMs` (a newer attempt is reused), and for tests
 *         `fetchImpl`, `readLogin` and `nowMs`.
 *
 * Returns:
 *     The snapshot after this attempt, or the cached one when no attempt was made.
 */
export async function refreshUsage({claudeDir, dataDir, maxAgeMs = 0, fetchImpl = fetch,
    readLogin = readClaudeLogin, nowMs = Date.now()}) {
    const cache = await readUsageCache(dataDir);
    if (nowMs - cache.lastAttemptMs < maxAgeMs || nowMs < cache.backoffUntilMs)
        return snapshotOf(cache);
    const release = await tryLock(path.join(dataDir, 'usage.lock'));
    if (!release)
        return snapshotOf(cache);
    try {
        const next = await attempt(cache, claudeDir, fetchImpl, readLogin, nowMs);
        await writeAtomically(usageCachePath(dataDir), JSON.stringify(next));
        return snapshotOf(next);
    } finally {
        await release();
    }
}

async function attempt(cache, claudeDir, fetchImpl, readLogin, nowMs) {
    const report = (state, detail = null, extra = {}) =>
        ({...cache, lastAttemptMs: nowMs, state, detail, ...extra});
    const login = await readLogin(claudeDir);
    if (!login)
        return report(State.NO_LOGIN);
    const token = hashToken(login.accessToken);
    // Waits for Claude Code to renew it
    if (isTokenExpired(login.expiresAt, nowMs) || token === cache.rejectedToken)
        return report(State.EXPIRED);
    if (nowMs - cache.lastResponseMs < MIN_GAP_MS)
        return cache;

    const response = await request(login.accessToken, fetchImpl);
    if (!response)
        return report(State.OFFLINE);
    const answered = {lastResponseMs: nowMs};
    const state = stateForStatus(response.status);
    if (state === State.EXPIRED)
        return report(State.EXPIRED, null, {...answered, rejectedToken: token});
    if (response.status === 429) {
        const seconds = backoffSeconds(response.retryAfter, cache.backoffSeconds);
        return report(State.FAILED, 'HTTP 429',
            {...answered, backoffSeconds: seconds, backoffUntilMs: nowMs + seconds * 1000});
    }
    if (state === State.FAILED)
        return report(State.FAILED, `HTTP ${response.status}`, answered);
    let data;
    try {
        data = JSON.parse(response.text);
    } catch {
        return report(State.FAILED, 'Invalid response', answered);
    }
    return report(State.FRESH, null, {...answered, data, lastSuccessMs: nowMs,
        backoffSeconds: 0, backoffUntilMs: 0});
}

/**
 * Keeps the usage limits up to date for a long-running process such as an editor extension.
 * Every refresh goes through the shared cache, so a status line or CLI that refreshed recently
 * saves a request.
 */
export class UsageClient {
    /**
     * Args:
     *     options: `claudeDir`, `dataDir`, `intervalSeconds` and `onChange(snapshot)`.
     */
    constructor({claudeDir, dataDir, intervalSeconds, onChange}) {
        this._claudeDir = claudeDir;
        this._dataDir = dataDir;
        this._onChange = onChange;
        this._intervalMs = intervalSeconds * 1000;
        // Claude Code replaces the file when it renews the login, so the folder is watched
        try {
            const file = path.basename(credentialsPath(claudeDir));
            this._watcher = watch(claudeDir, (event, name) => {
                if (name === file)
                    this._refreshSoon();
            });
            this._watcher.on('error', () => {});
        } catch {
            // No folder yet: the timer still notices a new login
        }
        this.setInterval(intervalSeconds);
        this.refresh();
    }

    setInterval(seconds) {
        this._intervalMs = seconds * 1000;
        clearInterval(this._intervalId);
        this._intervalId = setInterval(() => this.refresh(), this._intervalMs);
    }

    /** Args: `force` skips the shared cache's age (the service's own limits still apply). */
    async refresh({force = false} = {}) {
        if (this._disposed)
            return;
        const snapshot = await refreshUsage({claudeDir: this._claudeDir, dataDir: this._dataDir,
            maxAgeMs: force ? 0 : this._intervalMs - 5000}).catch(() => null);
        if (!snapshot || this._disposed)
            return;
        // While offline, try again soon; these requests never reach the service
        if (snapshot.state === State.OFFLINE && !this._retryId) {
            this._retryId = setTimeout(() => {
                this._retryId = null;
                this.refresh({force: true});
            }, OFFLINE_RETRY_MS);
        }
        this._onChange(snapshot);
    }

    _refreshSoon() {
        clearTimeout(this._eventId);
        this._eventId = setTimeout(() => this.refresh({force: true}), EVENT_DELAY_MS);
    }

    dispose() {
        this._disposed = true;
        clearInterval(this._intervalId);
        clearTimeout(this._eventId);
        clearTimeout(this._retryId);
        this._watcher?.close();
    }
}
