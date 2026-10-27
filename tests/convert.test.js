// Run with: gjs -m tests/convert.test.js
import Gio from 'gi://Gio';
import System from 'system';

import {convertModule} from '../legacy/convert.js';

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

if (failures > 0)
    System.exit(1);
