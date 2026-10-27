// Checks src/prefs/toolkit.js, or on GNOME 42 to 44 its converted override, against the toolkit
// this GNOME version ships.
// Usage: gjs -m toolkit-check.js <extensionDir>, on a display (WAYLAND_DISPLAY).
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
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

let toolkit;
if (GLib.file_test(`${dir}/src-legacy`, GLib.FileTest.IS_DIR)) {
    imports.searchPath.unshift(dir);
    toolkit = imports['src-legacy'].prefs.toolkit;
} else {
    toolkit = await import(`file://${dir}/src/prefs/toolkit.js`);
}
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

// A Gtk.MessageDialog (libadwaita 1.1) answers with response types instead of names
const GTK_RESPONSES = {cancel: Gtk.ResponseType.CANCEL, confirm: Gtk.ResponseType.OK};

attempt('confirm', () => {
    // The preferences' own copy: from GNOME 49 on, a one-letter heading makes GTK warn that
    // the label is measured too short
    const copy = {
        heading: 'Rebuild activity history?',
        body: 'Claudometer will read all Claude Code transcripts again. ' +
            'This can take about a minute.',
        cancelLabel: 'Cancel', confirmLabel: 'Rebuild',
    };
    let confirmed = 0;
    // One dialog per answer, as the dialog closes after it
    const answer = response => {
        const dialog = toolkit.confirm(window, copy, () => confirmed++);
        dialog.emit('response',
            dialog instanceof Gtk.MessageDialog ? GTK_RESPONSES[response] : response);
    };
    answer('cancel');
    if (confirmed !== 0)
        throw new Error('cancel confirmed');
    answer('confirm');
    if (confirmed !== 1)
        throw new Error(`confirmed ${confirmed} times`);
});

attempt('loadCss', () => toolkit.loadCss(new Gtk.CssProvider(), '.x {color: red;}'));
attempt('toast', () => toolkit.toast(window, 'a & b'));

attempt('externalLinkIcon', () => {
    const image = toolkit.externalLinkIcon(dir);
    const icon = image.gicon;
    const found = icon instanceof Gio.FileIcon
        ? icon.get_file().query_exists(null)
        : Gtk.IconTheme.get_for_display(Gdk.Display.get_default()).has_icon(image.icon_name);
    if (!found)
        throw new Error(`no icon ${icon ? icon.to_string() : image.icon_name}`);
});

System.exit(failed ? 1 : 0);
