import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup';

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
 */
export class UsageClient {
    constructor(credentialsPath, intervalSeconds, userAgent, onChange) {
        this._credentialsPath = credentialsPath;
        this._onChange = onChange;
        this._session = new Soup.Session({
            timeout: REQUEST_TIMEOUT_SECONDS,
            user_agent: userAgent,
        });
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

        this.setInterval(intervalSeconds);
        this.refresh();
    }

    setInterval(seconds) {
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

    _refreshSoon() {
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

        const message = Soup.Message.new('GET', USAGE_URL);
        message.request_headers.append('Authorization', `Bearer ${token}`);
        message.request_headers.append('anthropic-beta', USAGE_BETA);
        // A pooled connection that reaches Soup's 60 s idle limit fails at once with "Socket
        // I/O timed out", and refresh intervals are often 60 s
        message.add_flags(Soup.MessageFlags.NEW_CONNECTION);

        this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null,
            (session, result) => {
                if (this._destroyed)
                    return;
                let bytes;
                try {
                    bytes = session.send_and_read_finish(result);
                } catch (e) {
                    console.warn('Claudometer: Cannot reach the usage service:', e.message);
                    this._report(State.OFFLINE);
                    this._retryOffline();
                    return;
                }
                this._cancelRetry();
                this._handleResponse(message, bytes, token);
            });
    }

    _handleResponse(message, bytes, token) {
        const status = message.status_code;
        const state = stateForStatus(status);
        if (state === State.EXPIRED) {
            this._rejectedToken = token;
            this._report(State.EXPIRED);
            return;
        }
        if (status === 429) {
            this._backoffSeconds = backoffSeconds(
                message.response_headers.get_one('Retry-After'), this._backoffSeconds);
            this._backoffUntilMs = Date.now() + this._backoffSeconds * 1000;
        }
        if (state === State.FAILED) {
            this._report(State.FAILED, `HTTP ${status}`);
            return;
        }

        let data;
        try {
            data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
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
        for (const id of [this._timerId, this._retryId, this._eventId]) {
            if (id)
                GLib.source_remove(id);
        }
        this._timerId = null;
        this._retryId = null;
        this._eventId = null;
        this._networkMonitor.disconnect(this._networkId);
        if (this._credentialsId)
            this._credentialsMonitor.disconnect(this._credentialsId);
        this._credentialsMonitor?.cancel();
        this._credentialsMonitor = null;
        this._session.abort();
        this._session = null;
    }
}
