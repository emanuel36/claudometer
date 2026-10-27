// Asynchronous file helpers shared by the shell-side modules. Gio and GLib only, so they run
// under plain gjs in tests.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

/**
 * Reads a text file.
 *
 * Args:
 *     path: the file to read.
 *     cancellable: cancels the read, or null.
 *
 * Returns:
 *     A promise of the text, or of null when the file is missing, unreadable or the read was
 *     cancelled. It never rejects.
 */
export function loadText(path, cancellable) {
    return new Promise(resolve => {
        Gio.File.new_for_path(path).load_contents_async(cancellable, (file, result) => {
            try {
                const [, bytes] = file.load_contents_finish(result);
                resolve(new TextDecoder().decode(bytes));
            } catch {
                resolve(null);
            }
        });
    });
}

/**
 * Replaces a text file, creating its parent folder if needed. A failure other than a
 * cancellation is logged as `Claudometer: Cannot save the <what>: <message>`.
 *
 * Args:
 *     path: the file to write.
 *     text: its new contents.
 *     cancellable: cancels the save, or null to let it complete in any case.
 *     what: names the file in the warning.
 *
 * Returns:
 *     A promise that resolves once the save has ended, whether it worked or not.
 */
export function saveText(path, text, cancellable, what) {
    const warn = e => {
        if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
            console.warn(`Claudometer: Cannot save the ${what}:`, e.message);
    };
    const file = Gio.File.new_for_path(path);
    return new Promise(resolve => {
        file.get_parent().make_directory_async(GLib.PRIORITY_DEFAULT, cancellable,
            (dir, result) => {
                try {
                    dir.make_directory_finish(result);
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS)) {
                        warn(e);
                        resolve();
                        return;
                    }
                }
                file.replace_contents_bytes_async(new GLib.Bytes(new TextEncoder().encode(text)),
                    null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, cancellable,
                    (f, res) => {
                        try {
                            f.replace_contents_finish(res);
                        } catch (e) {
                            warn(e);
                        }
                        resolve();
                    });
            });
    });
}
