import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {bucketRecords, rangeStart} from './stats.js';
import {mergeMessage, parseIndex, parseTranscriptLine, serializeIndex} from './transcripts.js';

const ATTRIBUTES = 'standard::name,standard::type,standard::size,time::modified';

// Transcript files under projectsDir, however deep, as {path, mtime (ms), size}
function listTranscripts(dir) {
    const found = [];
    let children;
    try {
        children = dir.enumerate_children(ATTRIBUTES, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
            null);
    } catch {
        return found;
    }
    for (const info of children) {
        const child = dir.get_child(info.get_name());
        if (info.get_file_type() === Gio.FileType.DIRECTORY) {
            found.push(...listTranscripts(child));
        } else if (info.get_name().endsWith('.jsonl')) {
            found.push({
                path: child.get_path(),
                mtime: info.get_attribute_uint64('time::modified') * 1000,
                size: info.get_size(),
            });
        }
    }
    return found;
}

/** Returns: The records of an index or summary file; an empty Map when it is unusable. */
export function loadIndex(path) {
    return readIndex(path).records;
}

function readIndex(indexPath) {
    try {
        const [, bytes] = Gio.File.new_for_path(indexPath).load_contents(null);
        return parseIndex(new TextDecoder().decode(bytes));
    } catch {
        return parseIndex('');
    }
}

// replace_contents writes a temp file and renames it, so a reader never sees half a file
function writeAtomically(path, text) {
    GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o700);
    Gio.File.new_for_path(path).replace_contents(new TextEncoder().encode(text), null, false,
        Gio.FileCreateFlags.REPLACE_DESTINATION, null);
}

/**
 * Bring the index up to date with the transcripts, and write the summary the shell reads.
 * Runs synchronously: it is meant for the helper process, never for the shell.
 *
 * The index keeps one record per message, for as long as `keepDays` allows, so repeated lines
 * and messages copied into resumed sessions count once. Only files that changed since the last
 * run (modified time or size) are read. A line that is still being written fails to parse and
 * is skipped; the file's size changes again, so the next run reads it whole. The summary holds
 * the same data summed per hour, project and model, which is far smaller.
 *
 * Args:
 *     projectsDir: Claude Code's `projects` folder.
 *     indexPath: The index file, read only by this helper.
 *     summaryPath: The summary file, read by the shell.
 *     keepDays: Days of history to keep, counted like a range ending today; records before its
 *         first day are dropped from the index and the summary. 0 keeps everything.
 *     nowMs: Current time.
 *
 * Returns:
 *     `{records, filesRead}`: messages in the index, and transcript files read in this run.
 */
export function updateIndex(projectsDir, indexPath, summaryPath, keepDays = 0, nowMs = Date.now()) {
    const {files, records} = readIndex(indexPath);
    const decoder = new TextDecoder();
    // Only transcripts seen in this run are kept, so deleted ones leave the list
    const seen = {};
    let filesRead = 0;

    for (const {path, mtime, size} of listTranscripts(Gio.File.new_for_path(projectsDir))) {
        const known = files[path];
        if (known?.mtime === mtime && known?.size === size) {
            seen[path] = known;
            continue;
        }
        // One unreadable file must not stop the others; it is tried again on the next run
        let bytes;
        try {
            [, bytes] = Gio.File.new_for_path(path).load_contents(null);
        } catch (e) {
            console.warn(`Claudometer: Cannot read ${path}:`, e.message);
            continue;
        }
        for (const text of decoder.decode(bytes).split('\n')) {
            const record = text ? parseTranscriptLine(text) : null;
            if (record)
                mergeMessage(records, record);
        }
        seen[path] = {mtime, size};
        filesRead++;
    }

    if (keepDays > 0) {
        const from = rangeStart(nowMs, keepDays);
        for (const [id, record] of records) {
            if (record.t < from)
                records.delete(id);
        }
    }

    writeAtomically(indexPath, serializeIndex(seen, records));
    const buckets = new Map(bucketRecords(records.values()).map(b => [b.id, b]));
    writeAtomically(summaryPath, serializeIndex({}, buckets));
    return {records: records.size, filesRead};
}
