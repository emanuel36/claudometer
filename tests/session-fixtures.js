// Shared helpers for the asynchronous session tests (watcher.test.js, monitor.test.js). Tests
// may spawn processes and use synchronous file IO; the extension may not.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import System from 'system';

let failures = 0;
const children = [];
const folders = [];

export function check(name, actual, expected) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
        print(`ok   ${name}`);
    } else {
        failures++;
        print(`FAIL ${name}\n     expected ${e}\n     got      ${a}`);
    }
}

/**
 * Iterates the default main context until `predicate` holds; throws on timeout.
 */
export function waitFor(predicate, timeoutMs = 5000) {
    const context = GLib.MainContext.default();
    const end = GLib.get_monotonic_time() + timeoutMs * 1000;
    // Wakes the blocking iteration so the deadline is checked
    const tick = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => GLib.SOURCE_CONTINUE);
    while (!predicate() && GLib.get_monotonic_time() < end)
        context.iteration(true);
    GLib.source_remove(tick);
    if (!predicate())
        throw new Error(`timed out after ${timeoutMs} ms waiting for ${predicate}`);
}

/** Lets the main context run for `ms` milliseconds. */
export function idle(ms) {
    let done = false;
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        done = true;
        return GLib.SOURCE_REMOVE;
    });
    waitFor(() => done, ms + 1000);
}

export function tempFolder() {
    const path = GLib.dir_make_tmp('claudometer-XXXXXX');
    folders.push(path);
    return path;
}

/** Starts a `sleep 60` child and returns its pid. */
export function spawnSleep() {
    const child = Gio.Subprocess.new(['sleep', '60'], Gio.SubprocessFlags.NONE);
    children.push(child);
    return Number(child.get_identifier());
}

/** Kills a child started by `spawnSleep` and waits until it is reaped. */
export function killChild(pid) {
    const child = children.find(c => Number(c.get_identifier()) === pid);
    child.force_exit();
    child.wait(null);
}

export function procStartOf(pid) {
    const [, bytes] = GLib.file_get_contents(`/proc/${pid}/stat`);
    const text = new TextDecoder().decode(bytes);
    return text.slice(text.lastIndexOf(')') + 1).trim().split(/\s+/)[19];
}

export function writeRaw(dir, name, text) {
    GLib.file_set_contents(GLib.build_filenamev([dir, name]), text);
}

/** Writes `<dir>/<pid>.json`, with an interactive kind and the start times set to now. */
export function writeSession(dir, pid, fields) {
    const now = Date.now();
    const session = {pid, sessionId: `session-${pid}`, cwd: `/home/u/project-${pid}`,
        startedAt: now, statusUpdatedAt: now, kind: 'interactive', status: 'idle',
        ...fields};
    session.procStart ??= procStartOf(pid);
    writeRaw(dir, `${pid}.json`, JSON.stringify(session));
}

export function deleteFile(dir, name) {
    Gio.File.new_for_path(GLib.build_filenamev([dir, name])).delete(null);
}

/** Sets the permission bits of a file or folder. */
export function setMode(path, mode) {
    Gio.File.new_for_path(path).set_attribute_uint32('unix::mode', mode,
        Gio.FileQueryInfoFlags.NONE, null);
}

function removeTree(file) {
    const info = file.query_info('standard::type', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
        null);
    if (info.get_file_type() === Gio.FileType.DIRECTORY) {
        const entries = file.enumerate_children('standard::name',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        let entry;
        while ((entry = entries.next_file(null)) !== null)
            removeTree(file.get_child(entry.get_name()));
        entries.close(null);
    }
    file.delete(null);
}

/**
 * Runs the test body, then kills every child, removes every temp folder and exits with the
 * test's result.
 */
export function run(body) {
    try {
        body();
    } catch (e) {
        failures++;
        print(`FAIL ${e.message}\n${e.stack}`);
    } finally {
        for (const child of children) {
            child.force_exit();
            child.wait(null);
        }
        for (const path of folders) {
            const file = Gio.File.new_for_path(path);
            if (file.query_exists(null))
                removeTree(file);
        }
    }
    if (failures > 0) {
        print(`\n${failures} failed`);
        System.exit(1);
    }
    print('\nall passed');
}
