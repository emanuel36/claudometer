import Gio from 'gi://Gio';

import {parseIndex} from './transcripts.js';

/**
 * Read the summary the indexer writes, without blocking the shell.
 *
 * Args:
 *     path: The summary file.
 *     cancellable: A `Gio.Cancellable`, cancelled when the extension is disabled.
 *     callback: Called with a Map of hourly totals; empty when the file is missing or
 *         unusable, or the read was cancelled.
 */
export function loadSummary(path, cancellable, callback) {
    Gio.File.new_for_path(path).load_contents_async(cancellable, (file, result) => {
        let records = new Map();
        try {
            const [, bytes] = file.load_contents_finish(result);
            records = parseIndex(new TextDecoder().decode(bytes)).records;
        } catch {
            // Missing or cancelled: nothing to show yet
        }
        callback(records);
    });
}
