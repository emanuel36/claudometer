import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {abortSession, createSession, getUrl} from './http.js';
import {firstRequestDelayMs, parseCache, serializeCache} from './cache.js';
import {State, backoffSeconds, isTokenExpired, stateForStatus} from './status.js';

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const USAGE_BETA = 'oauth-2025-04-20';
// While offline, try again this often; these requests never reach the service
const OFFLINE_RETRY_SECONDS = 30;
// Several network and credential events arrive together
const EVENT_DELAY_SECONDS = 1;
// The service answers 429 when asked too often, so events never ask again sooner than this
const EVENT_MIN_GAP_SECONDS = 60;
// A stalled connection fails after this long instead of leaving the limits loading
const REQUEST_TIMEOUT_SECONDS = 30;

/**
 * Keeps the plan's usage limits up to date, using Claude Code's own login. The login is never
 * renewed here: only Claude Code does that, and renewing it elsewhere would sign it out.
 *
 * `onChange` gets `{state, detail, data, lastSuccessMs}` after every attempt. `data` is the
 * last good response and is kept while the state is not fresh, so the last values can still be
 * shown.
 *
 * What the client knows is saved in the cache file after every request. A new client starts
 * from it: it shows the saved values at once and keeps the interval and any 429 backoff, so a
 * screen lock and unlock does not ask the service again.
 */
export class UsageClient {
    /**
     * Args:
     *     credentialsPath: Claude Code's `.credentials.json`.
     *     cachePath: The cache file, in the extension's data folder.
     *     intervalSeconds: Seconds between refreshes.
     *     userAgent: Sent with every request.
     *     onChange: Called with the snapshot after every attempt.
     */
    constructor({credentialsPath, cachePath, intervalSeconds, userAgent, onChange}) {
        this._credentialsPath = credentialsPath;
        this._cachePath = cachePath;
        this._onChange = onChange;
        this._cancellable = new Gio.Cancellable();
        this._session = createSession({timeoutSeconds: REQUEST_TIMEOUT_SECONDS, userAgent});
        this._snapshot = {state: State.FRESH, detail: null, data: null, lastSuccessMs: 0};
        this._rejectedToken = null;
        this._lastRequestMs = 0;
        this._backoffSeconds = 0;
        this._backoffUntilMs = 0;

        this._networkMonitor = Gio.NetworkMonitor.get_default();
        this._networkId = this._networkMonitor.connect('network-changed', (monitor, up) => {
            if (up)
                this._refreshSoon();
        });
        // Claude Code rewrites this file when it renews or replaces the login
        try {
            this._credentialsMonitor = Gio.File.new_for_path(credentialsPath)
                .monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._credentialsId = this._credentialsMonitor.connect('changed',
                () => this._refreshSoon());
        } catch (e) {
            console.warn('Claudometer: Cannot watch the Claude Code login:', e.message);
        }

        this._intervalSeconds = intervalSeconds;
        this._loadCache();
    }

    // The interval timer starts with the first request
    _loadCache() {
        Gio.File.new_for_path(this._cachePath).load_contents_async(this._cancellable,
            (file, result) => {
                if (this._destroyed)
                    return;
                let cache = null;
                try {
                    const [, bytes] = file.load_contents_finish(result);
                    cache = parseCache(new TextDecoder().decode(bytes), this._credentialsPath);
                } catch {
                    // Missing or unreadable: start without it
                }
                if (cache) {
                    this._lastRequestMs = cache.lastRequestMs;
                    this._backoffSeconds = cache.backoffSeconds;
                    this._backoffUntilMs = cache.backoffUntilMs;
                    if (cache.data) {
                        this._snapshot.data = cache.data;
                        this._snapshot.lastSuccessMs = cache.lastSuccessMs;
                        this._report(State.FRESH);
                    }
                }
                const delayMs = firstRequestDelayMs(cache, this._intervalSeconds, Date.now());
                if (delayMs === 0) {
                    this._start();
                    return;
                }
                this._startId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, () => {
                    this._startId = null;
                    this._start();
                    return GLib.SOURCE_REMOVE;
                });
            });
    }

    _start() {
        this._started = true;
        this.setInterval(this._intervalSeconds);
        this.refresh();
    }

    setInterval(seconds) {
        this._intervalSeconds = seconds;
        // Before the first request, the new interval waits for it
        if (!this._started)
            return;
        if (this._timerId)
            GLib.source_remove(this._timerId);
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
            this.refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    refresh() {
        Gio.File.new_for_path(this._credentialsPath).load_contents_async(null, (file, result) => {
            if (this._destroyed)
                return;
            let login = null;
            try {
                const [, bytes] = file.load_contents_finish(result);
                login = JSON.parse(new TextDecoder().decode(bytes)).claudeAiOauth ?? null;
            } catch {
                // Missing or unreadable: the same as not signed in
            }

            if (!login?.accessToken) {
                this._cancelRetry();
                this._report(State.NO_LOGIN);
            } else if (isTokenExpired(login.expiresAt, Date.now()) ||
                login.accessToken === this._rejectedToken) {
                // Waits for Claude Code to renew it; the file monitor notices
                this._cancelRetry();
                this._report(State.EXPIRED);
            } else {
                this._request(login.accessToken);
            }
        });
    }

    // Before the first request, events wait for it: unlocking the screen often changes the
    // network too
    _refreshSoon() {
        if (!this._started)
            return;
        if (this._eventId)
            GLib.source_remove(this._eventId);
        this._eventId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, EVENT_DELAY_SECONDS,
            () => {
                this._eventId = null;
                if (Date.now() - this._lastRequestMs >= EVENT_MIN_GAP_SECONDS * 1000)
                    this.refresh();
                return GLib.SOURCE_REMOVE;
            });
    }

    _retryOffline() {
        if (this._retryId)
            return;
        this._retryId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, OFFLINE_RETRY_SECONDS,
            () => {
                this._retryId = null;
                this.refresh();
                return GLib.SOURCE_REMOVE;
            });
    }

    _cancelRetry() {
        if (this._retryId) {
            GLib.source_remove(this._retryId);
            this._retryId = null;
        }
    }

    _request(token) {
        if (Date.now() < this._backoffUntilMs)
            return;
        this._lastRequestMs = Date.now();

        const headers = [['Authorization', `Bearer ${token}`], ['anthropic-beta', USAGE_BETA]];
        getUrl(this._session, USAGE_URL, headers, (error, response) => {
            if (this._destroyed)
                return;
            if (error) {
                console.warn('Claudometer: Cannot reach the usage service:', error.message);
                this._report(State.OFFLINE);
                this._retryOffline();
                return;
            }
            this._cancelRetry();
            this._handleResponse(response, token);
            this._saveCache();
        });
    }

    // Requests that never reach the service change nothing worth saving
    _saveCache() {
        const text = serializeCache({
            credentialsPath: this._credentialsPath,
            data: this._snapshot.data,
            lastSuccessMs: this._snapshot.lastSuccessMs,
            lastRequestMs: this._lastRequestMs,
            backoffSeconds: this._backoffSeconds,
            backoffUntilMs: this._backoffUntilMs,
        });
        const file = Gio.File.new_for_path(this._cachePath);
        // The data folder may not exist yet; the index helper also creates it
        file.get_parent().make_directory_async(GLib.PRIORITY_DEFAULT, this._cancellable,
            (dir, result) => {
                try {
                    dir.make_directory_finish(result);
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
                        return;
                }
                file.replace_contents_bytes_async(new GLib.Bytes(new TextEncoder().encode(text)),
                    null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, this._cancellable,
                    (f, res) => {
                        try {
                            f.replace_contents_finish(res);
                        } catch (e) {
                            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                                console.warn('Claudometer: Cannot save the usage cache:',
                                    e.message);
                        }
                    });
            });
    }

    _handleResponse(response, token) {
        const {status} = response;
        const state = stateForStatus(status);
        if (state === State.EXPIRED) {
            this._rejectedToken = token;
            this._report(State.EXPIRED);
            return;
        }
        if (status === 429) {
            this._backoffSeconds = backoffSeconds(
                response.retryAfter, this._backoffSeconds);
            this._backoffUntilMs = Date.now() + this._backoffSeconds * 1000;
        }
        if (state === State.FAILED) {
            this._report(State.FAILED, `HTTP ${status}`);
            return;
        }

        let data;
        try {
            data = JSON.parse(new TextDecoder().decode(response.body));
        } catch {
            this._report(State.FAILED, 'Invalid response');
            return;
        }
        this._backoffSeconds = 0;
        this._backoffUntilMs = 0;
        this._snapshot.data = data;
        this._snapshot.lastSuccessMs = Date.now();
        this._report(State.FRESH);
    }

    _report(state, detail = null) {
        this._snapshot.state = state;
        this._snapshot.detail = detail;
        this._onChange({...this._snapshot});
    }

    destroy() {
        this._destroyed = true;
        for (const id of [this._timerId, this._retryId, this._eventId, this._startId]) {
            if (id)
                GLib.source_remove(id);
        }
        this._timerId = null;
        this._retryId = null;
        this._eventId = null;
        this._startId = null;
        this._cancellable.cancel();
        this._networkMonitor.disconnect(this._networkId);
        if (this._credentialsId)
            this._credentialsMonitor.disconnect(this._credentialsId);
        this._credentialsMonitor?.cancel();
        this._credentialsMonitor = null;
        abortSession(this._session);
        this._session = null;
    }
}
