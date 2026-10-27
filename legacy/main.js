// Converts an installed copy of the extension for GNOME Shell 42 to 44; install.sh runs it.
// Usage: gjs -m legacy/main.js <extensionDir>
import Gio from 'gi://Gio';
import System from 'system';

import {convertExtension} from './convert.js';

const [extensionDir] = ARGV;
if (!extensionDir) {
    printerr('usage: main.js <extensionDir>');
    System.exit(1);
}
try {
    const legacyDir = Gio.File.new_for_uri(import.meta.url).get_parent().get_path();
    convertExtension(extensionDir, legacyDir);
} catch (e) {
    printerr(e.message);
    System.exit(1);
}
