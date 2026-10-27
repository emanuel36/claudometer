// src/prefs/toolkit.js for GNOME Shell 42 to 44, with the widgets of GTK 4.6 and libadwaita 1.1
// (GNOME 42) that the newer ones replace.
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

// The save dialogs on screen: GTK does not keep a native dialog alive until it answers
const openChoosers = new Set();

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
    const toggle = new Gtk.Switch({valign: Gtk.Align.CENTER});
    const row = new Adw.ActionRow({title, activatable_widget: toggle});
    row.add_suffix(toggle);
    return {row, toggle};
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
 *     The dialog. An Adw.MessageDialog emits `response` with `'cancel'` or `'confirm'`; a
 *     Gtk.MessageDialog (libadwaita 1.1) with Gtk.ResponseType.CANCEL or OK.
 */
export function confirm(window, {heading, body, cancelLabel, confirmLabel}, onConfirm) {
    if (Adw.MessageDialog) {
        const dialog = new Adw.MessageDialog({
            heading, body, default_response: 'cancel', close_response: 'cancel',
            transient_for: window, modal: true,
        });
        dialog.add_response('cancel', cancelLabel);
        dialog.add_response('confirm', confirmLabel);
        dialog.set_response_appearance('confirm', Adw.ResponseAppearance.SUGGESTED);
        dialog.connect('response', (_dialog, response) => {
            if (response === 'confirm')
                onConfirm();
        });
        dialog.present();
        return dialog;
    }
    const dialog = new Gtk.MessageDialog({
        text: heading, secondary_text: body, transient_for: window, modal: true,
    });
    dialog.add_button(cancelLabel, Gtk.ResponseType.CANCEL);
    dialog.add_button(confirmLabel, Gtk.ResponseType.OK)
        .add_css_class('suggested-action');
    dialog.set_default_response(Gtk.ResponseType.CANCEL);
    // Unlike Adw.MessageDialog, it stays open after a response
    dialog.connect('response', (_dialog, response) => {
        dialog.destroy();
        if (response === Gtk.ResponseType.OK)
            onConfirm();
    });
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
export function chooseSaveFile(window, initialName) {
    const chooser = new Gtk.FileChooserNative({
        action: Gtk.FileChooserAction.SAVE, transient_for: window, modal: true,
    });
    chooser.set_current_name(initialName);
    return new Promise(resolve => {
        chooser.connect('response', (_chooser, response) => {
            openChoosers.delete(chooser);
            resolve(response === Gtk.ResponseType.ACCEPT ? chooser.get_file() : null);
            chooser.destroy();
        });
        openChoosers.add(chooser);
        chooser.show();
    });
}

/**
 * Opens a web address in the default browser.
 *
 * Args:
 *     window: The window the request comes from.
 *     uri: The address.
 */
export function openUri(window, uri) {
    Gtk.show_uri(window, uri, Gdk.CURRENT_TIME);
}

/**
 * Loads CSS into a provider.
 *
 * Args:
 *     provider: A Gtk.CssProvider.
 *     css: The style sheet text.
 */
export function loadCss(provider, css) {
    // GTK 4.10 (GNOME 44) takes the text and its length; 4.6 and 4.8 take the text alone
    if (Gtk.get_minor_version() >= 10)
        provider.load_from_data(css, -1);
    else
        provider.load_from_data(css);
}

/**
 * Shows a short message at the bottom of a window.
 *
 * Args:
 *     window: An Adw.PreferencesWindow.
 *     title: The message, shown as plain text.
 */
export function toast(window, title) {
    // Before libadwaita 1.4 a toast title is always markup
    window.add_toast(new Adw.Toast({title: GLib.markup_escape_text(title, -1)}));
}

/**
 * An icon that marks a row as a link to a web page.
 *
 * Args:
 *     extensionDir: Path of the extension folder.
 *
 * Returns:
 *     A Gtk.Image that follows the theme colors.
 */
export function externalLinkIcon(extensionDir) {
    const name = 'adw-external-link-symbolic';
    // libadwaita 1.1 (GNOME 42) does not ship it
    if (Gtk.IconTheme.get_for_display(Gdk.Display.get_default()).has_icon(name))
        return new Gtk.Image({icon_name: name});
    return new Gtk.Image({
        gicon: Gio.icon_new_for_string(
            GLib.build_filenamev([extensionDir, 'icons', 'external-link-symbolic.svg'])),
    });
}
