// Brings a session's Ghostty tab to the front: a token written to the session's terminal makes
// Ghostty send a desktop notification, the catcher swallows it and hands over the tab's surface
// id, and Ghostty's `present-surface` action shows that tab. Gio and GLib only, so it runs under
// plain gjs (see tests/focus.test.js).
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {loadText} from '../files.js';
import {isGhostty, ttyFromStat} from './sessions.js';

/** How long Ghostty's notification may take before the click gives up. */
export const TOKEN_TIMEOUT_MS = 1000;
/** How long a token that timed out is still swallowed, so a late banner never shows. */
export const LATE_TOKEN_MS = 60000;

const PTS = /^\/dev\/pts\/\d+$/;
// The apps whose notifications carry a surface id that `present-surface` takes
const GHOSTTY_IDS = ['com.mitchellh.ghostty', 'com.mitchellh.ghostty-debug'];

/**
 * The tokens written to terminals, waiting for the notification that carries them back.
 */
export class TokenBook {
    constructor() {
        // token -> {resolve, timerId}
        this._pending = new Map();
        // token -> monotonic time in ms when it timed out
        this._expired = new Map();
        this._destroyed = false;
    }

    /**
     * Waits for the notification that carries `token`.
     *
     * Args:
     *     token: the text written to the terminal.
     *     timeoutMs: how long to wait.
     *
     * Returns:
     *     A promise of `{appId, target}`, the notifying Ghostty and its `default-action-target`
     *     Variant, or of null on timeout, on a notification without a target or from another
     *     app, or on `destroy()`.
     */
    expect(token, timeoutMs) {
        if (this._destroyed)
            return Promise.resolve(null);
        return new Promise(resolve => {
            const timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeoutMs, () => {
                this._pending.delete(token);
                this._dropExpired();
                this._expired.set(token, nowMs());
                resolve(null);
                return GLib.SOURCE_REMOVE;
            });
            this._pending.set(token, {resolve, timerId});
        });
    }

    /**
     * Matches a notification against the tokens.
     *
     * Args:
     *     appId: the app that sent it.
     *     notification: its fields, as `GLib.Variant`s.
     *
     * Returns:
     *     True when the title or body holds a pending token or one that timed out less than
     *     `LATE_TOKEN_MS` ago: the notification must be swallowed.
     */
    take(appId, notification) {
        const texts = ['title', 'body'].map(key => notification[key]?.unpack())
            .filter(text => typeof text === 'string');
        const holds = token => texts.some(text => text.includes(token));

        for (const [token, {resolve, timerId}] of this._pending) {
            if (holds(token)) {
                GLib.source_remove(timerId);
                this._pending.delete(token);
                const target = notification['default-action-target'] ?? null;
                resolve(target === null || !GHOSTTY_IDS.includes(appId) ? null
                    : {appId, target});
                return true;
            }
        }
        this._dropExpired();
        return [...this._expired.keys()].some(holds);
    }

    // Forgets the tokens that timed out `LATE_TOKEN_MS` ago or more
    _dropExpired() {
        const now = nowMs();
        for (const [token, expiredMs] of this._expired) {
            if (now - expiredMs >= LATE_TOKEN_MS)
                this._expired.delete(token);
        }
    }

    destroy() {
        this._destroyed = true;
        for (const {resolve, timerId} of this._pending.values()) {
            GLib.source_remove(timerId);
            resolve(null);
        }
        this._pending.clear();
        this._expired.clear();
    }
}

/**
 * Wraps the shell's handler of incoming GTK notifications so the ones `book` claims are
 * answered without a source, so nothing is ever shown, and every other one reaches `original`.
 *
 * Args:
 *     book: the `TokenBook` that tells which notifications to swallow.
 *     original: the handler, called with the same `this`, `params` and `invocation`.
 *
 * Returns:
 *     The `AddNotificationAsync(params, invocation)` replacement.
 */
export function swallowTokens(book, original) {
    let warned = false;
    return function (params, invocation) {
        const [appId, , notification] = params;
        let taken = false;
        // A failure here must never cost the user a notification
        try {
            taken = book.take(appId, notification);
        } catch (e) {
            if (!warned)
                console.warn('Claudometer: Cannot match a notification:', e.message);
            warned = true;
        }
        if (taken)
            invocation.return_value(null);
        else
            original.call(this, params, invocation);
    };
}

/**
 * Brings the Ghostty tab of a Claude Code session to the front, and keeps each session's
 * surface id while its process runs.
 */
export class SessionFocus {
    /**
     * Args:
     *     book: the `TokenBook` the notification catcher feeds.
     *     available: tells whether the catcher is in place; nothing is written without it.
     *     x11: whether the shell runs on X11.
     */
    constructor({book, available, x11}) {
        this._book = book;
        this._available = available;
        this._x11 = x11;
        // `${pid}:${procStart}` -> {appId, target}
        this._surfaces = new Map();
        this._cancellable = new Gio.Cancellable();
    }

    /**
     * Brings the session's tab and window to the front.
     *
     * Writes to the session's terminal only on X11, for an interactive session in Ghostty whose
     * stdin is a terminal, with the catcher in place, and only when the surface id is not
     * known yet.
     *
     * Returns:
     *     A promise of whether the tab was presented. It never rejects.
     */
    async focus(session) {
        try {
            return await this._focus(session);
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) &&
                !e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                console.warn('Claudometer: Cannot focus the session:', e.message);
            return false;
        }
    }

    async _focus(session) {
        if (!this._x11 || session.kind !== 'interactive' || !this._available())
            return false;
        const proc = `/proc/${session.pid}`;
        const environ = await loadText(`${proc}/environ`, this._cancellable);
        if (environ === null || !isGhostty(environ))
            return false;

        const key = `${session.pid}:${session.procStart}`;
        let surface = this._surfaces.get(key);
        if (!surface) {
            const terminal = await symlinkTarget(`${proc}/fd/0`, this._cancellable);
            if (!PTS.test(terminal ?? ''))
                return false;
            // Only the session's controlling terminal is opened: the shell has none, and
            // opening a terminal without a session would make it the shell's own
            const [stat, device] = await Promise.all([
                loadText(`${proc}/stat`, this._cancellable),
                deviceNumber(terminal, this._cancellable),
            ]);
            // Checked again: the catcher may have gone during the reads
            if (stat === null || ttyFromStat(stat) !== device ||
                this._cancellable.is_cancelled() || !this._available())
                return false;
            const token = `cm-${GLib.uuid_string_random()}`;
            // Waiting before the write, so even a fast notification is caught
            const caught = this._book.expect(token, TOKEN_TIMEOUT_MS);
            await writeOnce(terminal, `\x1b]9;${token}\x07`, this._cancellable);
            surface = await caught;
            if (!surface || this._cancellable.is_cancelled())
                return false;
            this._surfaces.set(key, surface);
        }
        await present(surface, this._cancellable);
        return true;
    }

    /** Drops the surface ids of sessions that are no longer in `live`. */
    forget(live) {
        const keys = new Set(live.map(s => `${s.pid}:${s.procStart}`));
        for (const key of this._surfaces.keys()) {
            if (!keys.has(key))
                this._surfaces.delete(key);
        }
    }

    destroy() {
        this._cancellable.cancel();
        this._surfaces.clear();
    }
}

function nowMs() {
    return GLib.get_monotonic_time() / 1000;
}

function symlinkTarget(path, cancellable) {
    return new Promise((resolve, reject) => {
        Gio.File.new_for_path(path).query_info_async('standard::symlink-target',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, GLib.PRIORITY_DEFAULT, cancellable,
            (file, result) => {
                try {
                    resolve(file.query_info_finish(result).get_symlink_target());
                } catch (e) {
                    reject(e);
                }
            });
    });
}

function deviceNumber(path, cancellable) {
    return new Promise((resolve, reject) => {
        Gio.File.new_for_path(path).query_info_async('unix::rdev', Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_DEFAULT, cancellable, (file, result) => {
                try {
                    resolve(file.query_info_finish(result).get_attribute_uint32('unix::rdev'));
                } catch (e) {
                    reject(e);
                }
            });
    });
}

// One write, so the sequence never reaches the terminal in pieces
function writeOnce(path, text, cancellable) {
    const bytes = new GLib.Bytes(new TextEncoder().encode(text));
    return new Promise((resolve, reject) => {
        Gio.File.new_for_path(path).append_to_async(Gio.FileCreateFlags.NONE,
            GLib.PRIORITY_DEFAULT, cancellable, (file, opened) => {
                let stream;
                try {
                    stream = file.append_to_finish(opened);
                } catch (e) {
                    reject(e);
                    return;
                }
                stream.write_bytes_async(bytes, GLib.PRIORITY_DEFAULT, cancellable,
                    (s, written) => {
                        let error = null;
                        try {
                            s.write_bytes_finish(written);
                        } catch (e) {
                            error = e;
                        }
                        // Not cancellable, so the terminal is always closed
                        s.close_async(GLib.PRIORITY_DEFAULT, null, (c, closed) => {
                            try {
                                c.close_finish(closed);
                            } catch (e) {
                                error ??= e;
                            }
                            if (error)
                                reject(error);
                            else
                                resolve();
                        });
                    });
            });
    });
}

// Ghostty's `present-surface` action, with the surface id exactly as Ghostty sent it. Never
// starts Ghostty: a surface id only means something to the instance that sent it.
function present({appId, target}, cancellable) {
    // GApplication's object path for an app ID
    const path = `/${appId.replaceAll('.', '/').replaceAll('-', '_')}`;
    if (!Gio.dbus_is_name(appId) || !GLib.Variant.is_object_path(path))
        throw new Error(`Invalid app ID ${appId}`);
    return new Promise((resolve, reject) => {
        Gio.DBus.session.call(appId, path, 'org.freedesktop.Application', 'ActivateAction',
            new GLib.Variant('(sava{sv})', ['present-surface', [target], {}]), null,
            Gio.DBusCallFlags.NO_AUTO_START, -1, cancellable, (connection, result) => {
                try {
                    connection.call_finish(result);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });
    });
}
