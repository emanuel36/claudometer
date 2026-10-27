// Watches Claude Code's sessions folder and reports the sessions whose process is alive. Gio
// and GLib only, so it runs under plain gjs (see tests/watcher.test.js).
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {loadText} from '../files.js';
import {latestPerSession, parseSession, procStartFromStat} from './sessions.js';

// Claude Code rewrites a file several times in a row; one scan follows them all
const DEBOUNCE_MS = 300;
// Only these files are opened; the folder also holds key files that must never be read
const SESSION_FILE = /^\d+\.json$/;
const ENUMERATE_BATCH = 50;

/**
 * Reports the live Claude Code sessions in a folder of `<pid>.json` files.
 *
 * A folder monitor triggers a scan shortly after every change, and a periodic scan catches
 * processes that ended without removing their file. A session counts only while its process
 * runs with the start time written in the file, so a reused pid does not count.
 */
export class SessionWatcher {
    /**
     * Args:
     *     dir: the sessions folder; it may not exist yet.
     *     onSessions: called with the live sessions (one per `sessionId`) after every scan.
     *     intervalSeconds: seconds between periodic scans.
     */
    constructor({dir, onSessions, intervalSeconds = 30}) {
        this._dir = Gio.File.new_for_path(dir);
        this._onSessions = onSessions;
        this._cancellable = new Gio.Cancellable();
        // File name to the session it held at the last scan that parsed it
        this._known = new Map();
        this._scanning = false;
        this._again = false;

        try {
            this._monitor = this._dir.monitor_directory(Gio.FileMonitorFlags.NONE, null);
            this._monitorId = this._monitor.connect('changed', () => this._scanSoon());
        } catch (e) {
            console.warn('Claudometer: Cannot watch the Claude Code sessions, checking every ' +
                `${intervalSeconds} s:`, e.message);
        }
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, intervalSeconds, () => {
            this.refresh();
            return GLib.SOURCE_CONTINUE;
        });
        this.refresh();
    }

    /**
     * Scans the folder now, or once more right after the scan that is running.
     */
    refresh() {
        if (this._destroyed)
            return;
        if (this._scanning) {
            this._again = true;
            return;
        }
        this._scanning = true;
        this._scan().then(sessions => {
            this._scanning = false;
            if (this._destroyed)
                return;
            if (sessions)
                this._onSessions(sessions);
            if (this._again) {
                this._again = false;
                this.refresh();
            }
        }).catch(e => {
            this._scanning = false;
            console.error('Claudometer: Cannot read the Claude Code sessions:', e);
        });
    }

    _scanSoon() {
        if (this._debounceId)
            return;
        this._debounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DEBOUNCE_MS, () => {
            this._debounceId = null;
            this.refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    // Null when the folder cannot be read: the last report stands
    async _scan() {
        const listed = await this._listNames();
        if (!listed)
            return null;
        const names = listed.filter(name => SESSION_FILE.test(name));
        const known = new Map();
        const candidates = await Promise.all(names.map(async name => {
            const text = await loadText(this._dir.get_child(name).get_path(), this._cancellable);
            const parsed = text === null ? null : parseSession(text);
            // A file read in the middle of a rewrite keeps the session it held before, as long
            // as the same process still runs
            const session = parsed ?? this._known.get(name) ?? null;
            if (session)
                known.set(name, session);
            return session;
        }));
        const alive = await Promise.all(candidates.map(session =>
            session ? this._isAlive(session) : false));
        this._known = known;
        return latestPerSession(candidates.filter((session, i) => alive[i]));
    }

    async _isAlive({pid, procStart}) {
        const text = await loadText(`/proc/${pid}/stat`, this._cancellable);
        return text !== null && procStartFromStat(text) === procStart;
    }

    // A missing folder has no sessions; any other error gives null, as an unreadable folder
    // is not an empty one
    async _listNames() {
        const enumerator = await new Promise(resolve => {
            this._dir.enumerate_children_async('standard::name', Gio.FileQueryInfoFlags.NONE,
                GLib.PRIORITY_DEFAULT, this._cancellable, (dir, result) => {
                    try {
                        resolve(dir.enumerate_children_finish(result));
                    } catch (e) {
                        resolve(e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND) ? []
                            : this._readFailed(e));
                    }
                });
        });
        if (!enumerator || Array.isArray(enumerator))
            return enumerator;
        const names = await this._readNames(enumerator);
        enumerator.close_async(GLib.PRIORITY_DEFAULT, null, (e, result) => {
            try {
                e.close_finish(result);
            } catch {
                // Nothing to do: the names are read
            }
        });
        return names;
    }

    async _readNames(enumerator) {
        const infos = await new Promise(resolve => {
            enumerator.next_files_async(ENUMERATE_BATCH, GLib.PRIORITY_DEFAULT,
                this._cancellable, (e, result) => {
                    try {
                        resolve(e.next_files_finish(result));
                    } catch (error) {
                        resolve(this._readFailed(error));
                    }
                });
        });
        if (!infos)
            return null;
        if (infos.length === 0)
            return [];
        const rest = await this._readNames(enumerator);
        return rest && [...infos.map(info => info.get_name()), ...rest];
    }

    // Warns once per watcher; returns null for the callers
    _readFailed(e) {
        if (!this._warned && !e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
            this._warned = true;
            console.warn('Claudometer: Cannot read the Claude Code sessions folder:', e.message);
        }
        return null;
    }

    destroy() {
        this._destroyed = true;
        for (const id of [this._timerId, this._debounceId]) {
            if (id)
                GLib.source_remove(id);
        }
        this._timerId = null;
        this._debounceId = null;
        this._cancellable.cancel();
        if (this._monitorId)
            this._monitor.disconnect(this._monitorId);
        this._monitor?.cancel();
        this._monitor = null;
    }
}
