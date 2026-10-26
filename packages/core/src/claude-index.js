import {readFile, readdir, stat} from 'node:fs/promises';
import path from 'node:path';

import {bucketRecords, rangeStart} from '../../../src/history/stats.js';
import {
    mergeMessage, parseIndex, parseTranscriptLine, serializeIndex,
} from '../../../src/history/transcripts.js';
import {readText, writeAtomically} from './files.js';
import {normalizeProjectPath} from './paths.js';

export const claudeIndexPath = dataDir => path.join(dataDir, 'claude-index.json');
export const claudeSummaryPath = dataDir => path.join(dataDir, 'claude-summary.json');

// Transcript files under projectsDir, however deep, as {path, mtime (ms), size}
async function listTranscripts(dir) {
    let entries;
    try {
        entries = await readdir(dir, {withFileTypes: true});
    } catch {
        return [];
    }
    const found = [];
    for (const entry of entries) {
        const child = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            found.push(...await listTranscripts(child));
        } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
            const info = await stat(child).catch(() => null);
            if (info)
                found.push({path: child, mtime: Math.floor(info.mtimeMs), size: info.size});
        }
    }
    return found;
}

/**
 * Bring the Claude Code index up to date and write the summary the views read, like the GNOME
 * helper does (see src/history/indexer-core.js), with the summary kept per model id.
 *
 * Args:
 *     options: `claudeDir`, `dataDir`, `keepDays` (0 keeps everything) and `nowMs`.
 *
 * Returns:
 *     `{records, filesRead}`.
 */
export async function updateClaudeIndex({claudeDir, dataDir, keepDays = 0, nowMs = Date.now()}) {
    const {files, records} = parseIndex(await readText(claudeIndexPath(dataDir)) ?? '');
    // Only transcripts seen in this run are kept, so deleted ones leave the list
    const seen = {};
    let filesRead = 0;

    for (const {path: file, mtime, size} of await listTranscripts(
        path.join(claudeDir, 'projects'))) {
        const known = files[file];
        if (known?.mtime === mtime && known?.size === size) {
            seen[file] = known;
            continue;
        }
        let text;
        try {
            text = await readFile(file, 'utf8');
        } catch {
            // Tried again on the next run
            continue;
        }
        for (const line of text.split('\n')) {
            const record = line ? parseTranscriptLine(line) : null;
            if (record)
                mergeMessage(records, {...record, cwd: normalizeProjectPath(record.cwd)});
        }
        seen[file] = {mtime, size};
        filesRead++;
    }

    if (keepDays > 0) {
        const from = rangeStart(nowMs, keepDays);
        for (const [id, record] of records) {
            if (record.t < from)
                records.delete(id);
        }
    }

    await writeAtomically(claudeIndexPath(dataDir), serializeIndex(seen, records));
    const buckets = new Map(bucketRecords(records.values(), {keepModel: true})
        .map(b => [b.id, b]));
    await writeAtomically(claudeSummaryPath(dataDir), serializeIndex({}, buckets));
    return {records: records.size, filesRead};
}
