// Run with: gjs -m tests/focus.test.js
// Every terminal written to here is one the test creates (`script` with its output piped), and
// the D-Bus calls go to a private bus, so nothing reaches a real terminal or app.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {SessionFocus, TokenBook, swallowTokens} from '../src/sessions/focus.js';
import {check, idle, procStartOf, run, spawnPiped, waitFor} from './session-fixtures.js';

// Owned on the private bus only; its object path follows GApplication's rule
const APP_ID = 'com.mitchellh.ghostty-debug';
const APP_PATH = '/com/mitchellh/ghostty_debug';
const APP_IFACE = `<node><interface name="org.freedesktop.Application">
    <method name="ActivateAction">
        <arg type="s" name="action" direction="in"/>
        <arg type="av" name="parameter" direction="in"/>
        <arg type="a{sv}" name="platform_data" direction="in"/>
    </method></interface></node>`;
// Above 2^53: a round trip through a JS number would change it
const BIG_TARGET = GLib.Variant.parse(new GLib.VariantType('t'), '18446744073709551615',
    null, null);

const v = (type, value) => new GLib.Variant(type, value);
const note = (body, target = 42) => ({title: v('s', 'Ghostty'), body: v('s', body),
    'default-action': v('s', 'app.present-surface'), 'default-action-target': v('t', target)});

function readLink(path) {
    try {
        return GLib.file_read_link(path);
    } catch {
        return '';
    }
}

function readText(path) {
    try {
        return new TextDecoder().decode(GLib.file_get_contents(path)[1]);
    } catch {
        return '';
    }
}

const firstChild = pid => Number(readText(`/proc/${pid}/task/${pid}/children`).trim()
    .split(' ')[0]);

// The `sleep` that `script` runs on its new terminal, `depth` processes down, once it has
// replaced the shell
function terminalChild(scriptPid, depth = 1) {
    let pid = 0;
    waitFor(() => {
        pid = scriptPid;
        for (let i = 0; i < depth && pid > 0; i++)
            pid = firstChild(pid);
        return pid > 0 && readText(`/proc/${pid}/comm`) === 'sleep\n' &&
            readLink(`/proc/${pid}/fd/0`).startsWith('/dev/pts/');
    });
    return pid;
}

// Appends everything the stream gives to `sink` until it ends
function readAll(stream, sink) {
    stream.read_bytes_async(4096, GLib.PRIORITY_DEFAULT, null, (s, result) => {
        const bytes = s.read_bytes_finish(result);
        if (bytes.get_size() === 0)
            return;
        sink(new TextDecoder().decode(bytes.toArray()));
        readAll(stream, sink);
    });
}

// The tokens written as `ESC ] 9 ; <token> BEL`
const tokensIn = text => text.split('\x1b]9;').slice(1).map(part => part.split('\x07')[0]);

function focusOnce(focus, session) {
    let result;
    focus.focus(session).then(x => (result = x));
    waitFor(() => result !== undefined);
    return result;
}

function testBook() {
    const book = new TokenBook();
    let hit;
    book.expect('cm-1', 1000).then(x => (hit = x));
    check('unrelated notification passes', book.take('org.app', note('hello')), false);
    check('token swallowed', book.take('com.mitchellh.ghostty', note('cm-1')), true);
    waitFor(() => hit !== undefined);
    check('surface id', [hit.appId, hit.target.unpack()], ['com.mitchellh.ghostty', 42]);
    let late;
    book.expect('cm-2', 50).then(x => (late = x));
    waitFor(() => late !== undefined);
    check('timeout gives null', late, null);
    check('late token still swallowed', book.take('com.mitchellh.ghostty', note('cm-2')), true);

    let untargeted;
    book.expect('cm-3', 1000).then(x => (untargeted = x));
    const {title, body} = note('cm-3');
    check('token without a target swallowed', book.take('com.mitchellh.ghostty', {title, body}),
        true);
    waitFor(() => untargeted !== undefined);
    check('no target gives null', untargeted, null);

    let other;
    book.expect('cm-5', 1000).then(x => (other = x));
    check('token from another app swallowed', book.take('org.app', note('cm-5')), true);
    waitFor(() => other !== undefined);
    check('another app gives null', other, null);

    let debug;
    book.expect('cm-6', 1000).then(x => (debug = x));
    book.take('com.mitchellh.ghostty-debug', note('cm-6'));
    waitFor(() => debug !== undefined);
    check('debug Ghostty gives its surface id', debug?.appId, 'com.mitchellh.ghostty-debug');

    let dropped;
    book.expect('cm-4', 60000).then(x => (dropped = x));
    book.destroy();
    waitFor(() => dropped !== undefined);
    check('destroy gives null', dropped, null);
}

function testSwallow() {
    const passed = [];
    const answered = [];
    const invocation = {return_value: value => answered.push(value)};
    const daemon = {
        name: 'daemon',
        original(params) {
            passed.push([this.name, params[0]]);
        },
    };
    const book = new TokenBook();
    book.expect('cm-7', 1000);
    daemon.add = swallowTokens(book, daemon.original);
    daemon.add(['com.mitchellh.ghostty', 'n1', note('cm-7')], invocation);
    daemon.add(['org.app', 'n2', note('hello')], invocation);
    check('claimed notification answered without a source', answered, [null]);
    check('other notification reaches the shell', passed, [['daemon', 'org.app']]);
    book.destroy();

    passed.length = 0;
    let tries = 0;
    const broken = {take: () => {
        tries++;
        throw new Error('broken book');
    }};
    daemon.add = swallowTokens(broken, daemon.original);
    let threw = false;
    try {
        daemon.add(['org.app', 'n3', note('hello')], invocation);
        daemon.add(['org.app', 'n4', note('hello')], invocation);
    } catch {
        threw = true;
    }
    check('failing book: notifications reach the shell', [threw, tries, passed],
        [false, 2, [['daemon', 'org.app'], ['daemon', 'org.app']]]);
}

function testNoWrite() {
    // Only the pipe on stdin stops the write in the last case
    const child = Number(spawnPiped(['sleep', '60'], {TERM_PROGRAM: 'ghostty'})
        .get_identifier());
    const procStart = procStartOf(child);
    let expected = 0;
    const fakeBook = {expect: () => {
        expected++;
        return Promise.resolve(null);
    }};
    const session = {pid: child, procStart, kind: 'interactive', sessionId: 'x'};
    const cases = [
        ['no catcher', {available: () => false, x11: true}, session],
        ['wayland', {available: () => true, x11: false}, session],
        ['background session', {available: () => true, x11: true}, {...session, kind: 'bg'}],
        ['stdin is a pipe', {available: () => true, x11: true}, session],
    ];
    for (const [name, options, target] of cases) {
        expected = 0;
        const result = focusOnce(new SessionFocus({book: fakeBook, ...options}), target);
        check(`${name}: no focus, nothing written`, [result, expected], [false, 0]);
    }
}

// A terminal that is not the session's controlling one is never opened: the shell has none,
// so opening it could make it the shell's own
function testNotControlling() {
    // `setsid` moves the `sleep` to a session of its own, without a controlling terminal
    const terminal = spawnPiped(['script', '-qfc', 'exec setsid -w sleep 60', '/dev/null'],
        {TERM_PROGRAM: 'ghostty', SHELL: '/bin/sh'});
    let output = '';
    readAll(terminal.get_stdout_pipe(), text => (output += text));
    const pid = terminalChild(Number(terminal.get_identifier()), 2);
    let expected = 0;
    const fakeBook = {expect: () => {
        expected++;
        return Promise.resolve(null);
    }};
    const focus = new SessionFocus({book: fakeBook, available: () => true, x11: true});
    const result = focusOnce(focus, {pid, procStart: procStartOf(pid), kind: 'interactive',
        sessionId: 'z'});
    idle(200);
    check('not the controlling terminal: no focus, nothing written',
        [result, expected, tokensIn(output).length], [false, 0, 0]);
    focus.destroy();
}

function testFocus() {
    const calls = [];
    const app = Gio.DBusExportedObject.wrapJSObject(APP_IFACE, {
        ActivateActionAsync([action, parameter], invocation) {
            calls.push([action, parameter.map(p => p.print(true))]);
            invocation.return_value(null);
        },
    });
    app.export(Gio.DBus.session, APP_PATH);
    let owned = false;
    const ownerId = Gio.bus_own_name_on_connection(Gio.DBus.session, APP_ID,
        Gio.BusNameOwnerFlags.NONE, () => (owned = true), null);
    waitFor(() => owned);

    const terminal = spawnPiped(['script', '-qfc', 'exec sleep 60', '/dev/null'],
        {TERM_PROGRAM: 'ghostty', SHELL: '/bin/sh'});
    let output = '';
    readAll(terminal.get_stdout_pipe(), text => (output += text));
    const pid = terminalChild(Number(terminal.get_identifier()));
    const session = {pid, procStart: procStartOf(pid), kind: 'interactive', sessionId: 'y'};

    const book = new TokenBook();
    const focus = new SessionFocus({book, available: () => true, x11: true});
    let result;
    focus.focus(session).then(x => (result = x));
    // Answers as Ghostty does once the token reaches the terminal
    waitFor(() => tokensIn(output).length === 1);
    const [token] = tokensIn(output);
    check('token written to the terminal', token.startsWith('cm-'), true);
    check('notification swallowed',
        book.take(APP_ID, {...note(token), 'default-action-target': BIG_TARGET}), true);
    waitFor(() => result !== undefined);
    check('focused', result, true);
    check('surface presented unchanged', calls,
        [['present-surface', ['uint64 18446744073709551615']]]);

    focus.forget([session]);
    check('cached surface: focused', focusOnce(focus, session), true);
    check('cached surface: nothing written', tokensIn(output).length, 1);
    check('cached surface presented', calls.length, 2);

    focus.forget([]);
    check('no notification: no focus', focusOnce(focus, session), false);
    check('forgotten surface: token written again', tokensIn(output).length, 2);
    check('no notification: nothing presented', calls.length, 2);

    focus.destroy();
    book.destroy();
    Gio.bus_unown_name(ownerId);
    app.unexport();
}

// A private session bus, so the test never reaches the session's real apps
function usePrivateBus() {
    const daemon = spawnPiped(['dbus-daemon', '--session', '--nofork', '--print-address']);
    const [address] = new Gio.DataInputStream({base_stream: daemon.get_stdout_pipe()})
        .read_line_utf8(null);
    GLib.setenv('DBUS_SESSION_BUS_ADDRESS', address, true);
    // The daemon is killed when the test ends, before the process exits
    Gio.DBus.session.set_exit_on_close(false);
}

run(() => {
    usePrivateBus();
    testBook();
    testSwallow();
    testNoWrite();
    testNotControlling();
    testFocus();
});
