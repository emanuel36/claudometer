// Checks src/prefs/toolkit.js against the toolkit this GNOME version ships.
// Usage: gjs -m toolkit-check.js <extensionDir>, on a display (WAYLAND_DISPLAY).
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import System from 'system';

const [dir] = ARGV;
let failed = false;

function check(name, ok) {
    print(`${ok ? 'ok' : 'FAIL'}: ${name}`);
    if (!ok)
        failed = true;
}

function attempt(name, fn) {
    try {
        fn();
        check(name, true);
    } catch (e) {
        print(`  ${e.message}`);
        check(name, false);
    }
}

Gtk.init();
Adw.init();

const toolkit = await import(`file://${dir}/src/prefs/toolkit.js`);
const window = new Adw.PreferencesWindow();

attempt('switchRow', () => {
    const {row, toggle} = toolkit.switchRow({title: 'T'});
    let notified = 0;
    toggle.connect('notify::active', () => notified++);
    toggle.active = true;
    if (notified !== 1 || toggle.active !== true)
        throw new Error(`notified ${notified}, active ${toggle.active}`);
    new Adw.PreferencesGroup().add(row);
});

attempt('confirm', () => {
    const copy = {
        heading: 'H', body: 'B', cancelLabel: 'Cancel', confirmLabel: 'Go',
    };
    let confirmed = 0;
    const dialog = toolkit.confirm(window, copy, () => confirmed++);
    dialog.emit('response', 'cancel');
    if (confirmed !== 0)
        throw new Error('cancel confirmed');
    dialog.emit('response', 'confirm');
    if (confirmed !== 1)
        throw new Error(`confirmed ${confirmed} times`);
});

attempt('loadCss', () => toolkit.loadCss(new Gtk.CssProvider(), '.x {color: red;}'));
attempt('toast', () => toolkit.toast(window, 'a & b'));

System.exit(failed ? 1 : 0);
