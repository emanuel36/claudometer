// Run with: gjs -m tests/convert.test.js
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';

import {convertExtension, convertModule} from '../legacy/convert.js';

let failures = 0;

function check(name, actual, expected) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
        print(`ok   ${name}`);
    } else {
        failures++;
        print(`FAIL ${name}\n     expected ${e}\n     got      ${a}`);
    }
}

const ME = "const Me = imports.misc.extensionUtils.getCurrentExtension();\n";

function convert(text, file = 'src/limits/cache.js') {
    return convertModule(text, file);
}

check('gi import', convert("import GLib from 'gi://GLib';\n"), 'const GLib = imports.gi.GLib;\n');
check('gi import with a version', convert("import Soup from 'gi://Soup?version=3.0';\n"),
    "imports.gi.versions.Soup = '3.0';\nconst Soup = imports.gi.Soup;\n");
check('cairo import', convert("import Cairo from 'cairo';\n"), 'const Cairo = imports.cairo;\n');
check('system import', convert("import System from 'system';\n"),
    'const System = imports.system;\n');
check('shell ui import',
    convert("import * as Main from 'resource:///org/gnome/shell/ui/main.js';\n"),
    'const Main = imports.ui.main;\n');
check('shell misc import',
    convert("import * as Util from 'resource:///org/gnome/shell/misc/util.js';\n"),
    'const Util = imports.misc.util;\n');
check('extension import', convert(
    "import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';\n"),
ME + "const {Extension} = Me.imports['src-legacy'].shim;\n");
check('preferences import', convert(
    "import {ExtensionPreferences} from " +
    "'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';\n"),
ME + "const {ExtensionPreferences} = Me.imports['src-legacy'].shim;\n");
check('local import', convert(
    "import {A, B} from './src/limits/usage-client.js';\nexport default class P {}\n",
    'prefs.js').split('\n')[1],
"const {A, B} = Me.imports['src-legacy'].limits['usage-client'];");
check('multi-line import', convert(
    "import {\n    A,\n    B,\n} from './status.js';\n"),
ME + "const {A, B} = Me.imports['src-legacy'].limits.status;\n");
check('relative import from src/popup/views.js', convert(
    "import {x} from '../history/stats.js';\n", 'src/popup/views.js'),
ME + "const {x} = Me.imports['src-legacy'].history.stats;\n");
check('Me line only when needed', convert("import GLib from 'gi://GLib';\nlet a;\n"),
    'const GLib = imports.gi.GLib;\nlet a;\n');
check('export function', convert('export function f() {}\n'), 'function f() {}\n');
check('export async function', convert('export async function f() {}\n'),
    'async function f() {}\n');
check('export const', convert('export const X = 1;\n'), 'var X = 1;\n');
check('export let', convert('export let X = 1;\n'), 'var X = 1;\n');
check('export class', convert('export class X {}\n'), 'var X = class X {}\n');
check('export default class', convert('export default class X {}\n'), 'class X {}\n');

check('extension entry', convert('export default class Ext extends Extension {}\n', 'extension.js')
    .endsWith('\nfunction init(meta) { return new Ext(meta.metadata); }\n'), true);
const prefs = convert('export default class Pref extends ExtensionPreferences {}\n', 'prefs.js');
check('prefs entry', prefs.endsWith(
    'function init() {}\nfunction fillPreferencesWindow(window) {\n' +
    '    new Pref(Me.metadata).fillPreferencesWindow(window);\n}\n'), true);
check('prefs entry has the Me line', prefs.startsWith(ME), true);

let message = '';
try {
    convert('export {a};\n', 'src/limits/cache.js');
} catch (e) {
    message = e instanceof Error ? e.message : '';
}
check('unknown syntax throws', message.includes('src/limits/cache.js'), true);

let renamed = '';
try {
    convert("import {a as b} from './status.js';\n");
} catch (e) {
    renamed = e instanceof Error ? e.message : '';
}
check('renamed import throws', renamed.includes('src/limits/cache.js'), true);

let unknownBinding = '';
try {
    convert("import {Extension, InjectionManager} from " +
        "'resource:///org/gnome/shell/extensions/extension.js';\n", 'src/limits/cache.js');
} catch (e) {
    unknownBinding = e instanceof Error ? e.message : '';
}
check('unknown shim binding throws', unknownBinding.includes('InjectionManager') &&
    unknownBinding.includes('src/limits/cache.js'), true);

function listJs(dir, base) {
    const found = [];
    const children = dir.enumerate_children('standard::name,standard::type', 0, null);
    for (let info = children.next_file(null); info; info = children.next_file(null)) {
        const name = `${base}/${info.get_name()}`;
        if (info.get_file_type() === Gio.FileType.DIRECTORY)
            found.push(...listJs(dir.get_child(info.get_name()), name));
        else if (name.endsWith('.js'))
            found.push(name);
    }
    return found;
}

const root = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent();
const files = ['extension.js', 'prefs.js', ...listJs(root.get_child('src'), 'src')];
let tree = 'ok';
for (const file of files) {
    try {
        const [, bytes] = root.resolve_relative_path(file).load_contents(null);
        const output = convertModule(new TextDecoder().decode(bytes), file);
        if (/^(import|export)\b/m.test(output))
            tree = `${file}: import or export left`;
        new Function(output.replace(/^#!.*/, ''));
    } catch (e) {
        tree = `${file}: ${e.message}`;
    }
    if (tree !== 'ok')
        break;
}
check('the real tree', tree, 'ok');

const decoder = new TextDecoder();

function read(dir, path) {
    return decoder.decode(dir.resolve_relative_path(path).load_contents(null)[1]);
}

function write(dir, path, text) {
    const file = dir.resolve_relative_path(path);
    if (!file.get_parent().query_exists(null))
        file.get_parent().make_directory_with_parents(null);
    file.replace_contents(new TextEncoder().encode(text), null, false, 0, null);
}

function copyTree(source, target) {
    target.make_directory_with_parents(null);
    const children = source.enumerate_children('standard::name,standard::type', 0, null);
    for (let info = children.next_file(null); info; info = children.next_file(null)) {
        const name = info.get_name();
        if (info.get_file_type() === Gio.FileType.DIRECTORY)
            copyTree(source.get_child(name), target.get_child(name));
        else
            source.get_child(name).copy(target.get_child(name), 0, null, null);
    }
}

// A copy of the files the installer converts, and a legacy folder made of `legacyFiles`
function fixture(legacyFiles = null) {
    const dir = Gio.File.new_for_path(GLib.dir_make_tmp('convert-XXXXXX'));
    for (const name of ['extension.js', 'prefs.js', 'metadata.json'])
        root.get_child(name).copy(dir.get_child(name), 0, null, null);
    copyTree(root.get_child('src'), dir.get_child('src'));
    if (!legacyFiles)
        return {dir, legacy: root.get_child('legacy')};
    const legacy = dir.get_child('legacy');
    for (const [path, text] of Object.entries(legacyFiles))
        write(legacy, path, text);
    return {dir, legacy};
}

function errorOf(fn) {
    try {
        fn();
    } catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
    return '';
}

const real = fixture();
convertExtension(real.dir.get_path(), real.legacy.get_path());
const client = read(real.dir, 'src-legacy/limits/usage-client.js');
check('convertExtension writes src-legacy', /^import /m.test(client), false);
check('src is left as it was', read(real.dir, 'src/limits/usage-client.js'),
    read(root, 'src/limits/usage-client.js'));
check('overrides win', read(real.dir, 'src-legacy/limits/http.js'),
    convertModule(read(root, 'legacy/overrides/src/limits/http.js'), 'src/limits/http.js'));
check('entry points converted in place',
    read(real.dir, 'extension.js'), convertModule(read(root, 'extension.js'), 'extension.js'));
check('shim copied', read(real.dir, 'src-legacy/shim.js'), read(root, 'legacy/shim.js'));
check('metadata versions',
    JSON.parse(read(real.dir, 'metadata.json'))['shell-version'], ['42', '43', '44']);

const stale = fixture({'shim.js': '// shim\n', 'overrides/src/nope.js': '// nope\n'});
check('stale override throws', errorOf(() =>
    convertExtension(stale.dir.get_path(), stale.legacy.get_path())).includes('src/nope.js'), true);

const broken = fixture({
    'shim.js': '// shim\n', 'overrides/src/limits/cache.js': 'export function f( {}\n',
});
check('a module that does not compile throws', errorOf(() =>
    convertExtension(broken.dir.get_path(), broken.legacy.get_path()))
    .includes('src/limits/cache.js'), true);

for (const {dir} of [real, stale, broken])
    GLib.spawn_command_line_sync(`rm -rf ${GLib.shell_quote(dir.get_path())}`);

if (failures > 0)
    System.exit(1);
