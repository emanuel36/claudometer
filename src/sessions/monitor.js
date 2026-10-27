// Owns the session watcher and the Done/seen records behind the Status tab, and keeps the
// records in a state file so they survive a screen lock. Gio and GLib only, so it runs under
// plain gjs (see tests/monitor.test.js).
import Gio from 'gi://Gio';

import {loadText, saveText} from '../files.js';
import {
    clearDone, listing, markSeen, parseRecords, reconcile, serializeRecords,
} from './tracker.js';
import {SessionWatcher} from './watcher.js';

/**
 * Keeps the live sessions and their Done/seen records up to date.
 *
 * The state file is read before the watcher starts, so the records from before a screen lock
 * are never overwritten. Saves are not cancelled by `destroy()`: seen marks made just before
 * a lock are kept.
 */
export class SessionMonitor {
    /**
     * Args:
     *     dir: Claude Code's sessions folder.
     *     statePath: the file that keeps the records.
     *     keepMinutes: how long a Done session stays after it was seen.
     *     onChange: called after every change of the sessions or the records.
     *     intervalSeconds: seconds between the watcher's periodic scans.
     */
    constructor({dir, statePath, keepMinutes, onChange, intervalSeconds = 30}) {
        this._statePath = statePath;
        this._keepMs = keepMinutes * 60000;
        this._onChange = onChange;
        this._cancellable = new Gio.Cancellable();
        this._records = new Map();
        this._savedText = null;
        this._pendingText = null;
        this._saving = false;
        this._loaded = false;
        this._destroyed = false;
        /** The live sessions, one per `sessionId`. */
        this.sessions = [];

        loadText(statePath, this._cancellable).then(text => {
            if (this._destroyed)
                return;
            this._records = text === null ? new Map() : parseRecords(text);
            this._savedText = text;
            this._loaded = true;
            this._watcher = new SessionWatcher({
                dir,
                intervalSeconds,
                onSessions: sessions => this._onSessions(sessions),
            });
        });
    }

    /**
     * Builds what the Status tab shows; see `listing` in `tracker.js`.
     *
     * Args:
     *     nowMs: the current time in milliseconds.
     *     freshSinceMs: seen marks from this time on still look fresh.
     */
    listing(nowMs, freshSinceMs = Infinity) {
        return listing(this._records, this.sessions, nowMs, freshSinceMs);
    }

    /** Marks every Done session as seen. */
    markSeen() {
        this._update(markSeen(this._records, Date.now()));
    }

    /** Drops the Done mark of a session the user went to. */
    handled(sessionId) {
        this._update(clearDone(this._records, sessionId));
    }

    /** Changes how long a Done session stays after it was seen. */
    setKeepMinutes(minutes) {
        this._keepMs = minutes * 60000;
        this._update(reconcile(this._records, this.sessions, Date.now(), this._keepMs));
    }

    _onSessions(sessions) {
        this.sessions = sessions;
        this._update(reconcile(this._records, sessions, Date.now(), this._keepMs));
    }

    // Before the state file is read, a change would overwrite it with nothing
    _update(records) {
        if (!this._loaded || this._destroyed)
            return;
        this._records = records;
        this._save();
        this._onChange();
    }

    // One save at a time, so an older save never lands after a newer one
    _save() {
        const text = serializeRecords(this._records);
        if (text === this._savedText)
            return;
        this._savedText = text;
        this._pendingText = text;
        if (!this._saving)
            this._saveNext();
    }

    // Not cancelled by destroy(), so the last marks reach the file
    _saveNext() {
        const text = this._pendingText;
        this._pendingText = null;
        this._saving = text !== null;
        if (this._saving)
            saveText(this._statePath, text, null, 'Status tab state').then(() => this._saveNext());
    }

    destroy() {
        this._destroyed = true;
        this._cancellable.cancel();
        this._watcher?.destroy();
        this._watcher = null;
    }
}
