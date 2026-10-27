// The preferences' only contact with the newer libadwaita and GTK widgets, so a build for an older
// GNOME can swap this file for one with the same exports.
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

Gio._promisify(Gtk.FileDialog.prototype, 'save', 'save_finish');

/**
 * A row with a switch, under a title.
 *
 * Args:
 *     title: Row title.
 *
 * Returns:
 *     `{row, toggle}`: `row` goes in a group or an expander; `toggle` has a boolean `active`
 *     property that can be bound and emits `notify::active`.
 */
export function switchRow({title}) {
    const row = new Adw.SwitchRow({title});
    return {row, toggle: row};
}

/**
 * Asks a question over a window, with a Cancel and a suggested confirm button.
 *
 * Args:
 *     window: The window the dialog covers.
 *     copy: `{heading, body, cancelLabel, confirmLabel}`.
 *     onConfirm: Called with no arguments when the confirm button is chosen.
 *
 * Returns:
 *     The dialog; it emits `response` with `'cancel'` or `'confirm'`.
 */
export function confirm(window, {heading, body, cancelLabel, confirmLabel}, onConfirm) {
    const options = {heading, body, default_response: 'cancel', close_response: 'cancel'};
    const dialog = Adw.AlertDialog
        ? new Adw.AlertDialog(options)
        : new Adw.MessageDialog({...options, transient_for: window, modal: true});
    dialog.add_response('cancel', cancelLabel);
    dialog.add_response('confirm', confirmLabel);
    dialog.set_response_appearance('confirm', Adw.ResponseAppearance.SUGGESTED);
    dialog.connect('response', (_dialog, response) => {
        if (response === 'confirm')
            onConfirm();
    });
    if (Adw.AlertDialog)
        dialog.present(window);
    else
        dialog.present();
    return dialog;
}

/**
 * Asks where to save a file.
 *
 * Args:
 *     window: The window the dialog covers.
 *     initialName: The file name offered.
 *
 * Returns:
 *     A promise of the chosen Gio.File, or null when the dialog is dismissed.
 */
export async function chooseSaveFile(window, initialName) {
    try {
        return await new Gtk.FileDialog({initial_name: initialName}).save(window, null);
    } catch {
        return null;
    }
}

/**
 * Opens a web address in the default browser.
 *
 * Args:
 *     window: The window the request comes from.
 *     uri: The address.
 */
export function openUri(window, uri) {
    new Gtk.UriLauncher({uri}).launch(window, null, null);
}

/**
 * Loads CSS into a provider.
 *
 * Args:
 *     provider: A Gtk.CssProvider.
 *     css: The style sheet text.
 */
export function loadCss(provider, css) {
    provider.load_from_string(css);
}

/**
 * Shows a short message at the bottom of a window.
 *
 * Args:
 *     window: An Adw.PreferencesWindow.
 *     title: The message, shown as plain text.
 */
export function toast(window, title) {
    window.add_toast(new Adw.Toast({title, use_markup: false}));
}

/**
 * An icon that marks a row as a link to a web page.
 *
 * Args:
 *     _extensionDir: Path of the extension folder; only the GNOME 42 version uses it.
 *
 * Returns:
 *     A Gtk.Image that follows the theme colors.
 */
export function externalLinkIcon(_extensionDir) {
    return new Gtk.Image({icon_name: 'adw-external-link-symbolic'});
}
