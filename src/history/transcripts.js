// Pure helpers for Claude Code's transcripts: one record per assistant message, merged by id,
// and the index file that keeps those records. No shell imports, so they can be checked under
// plain gjs (see tests/transcripts.test.js). A record is `{id, t, model, out, input, cacheRead,
// cacheWrite, cwd, branch, sidechain}`, with `t` in ms.

const INDEX_VERSION = 1;

/**
 * Turn one transcript line into a record. Only metadata is read, never message content.
 *
 * Args:
 *     text: One line of a `.jsonl` transcript.
 *
 * Returns:
 *     The record, or null for anything that is not an assistant message with output tokens:
 *     other line types, no usage, the `<synthetic>` model, zero output, no id, or text that is
 *     not complete JSON (for example a line still being written).
 */
export function parseTranscriptLine(text) {
    let line;
    try {
        line = JSON.parse(text);
    } catch {
        return null;
    }
    const message = line?.message;
    const usage = message?.usage;
    if (line?.type !== 'assistant' || !usage || message.model === '<synthetic>')
        return null;

    const id = message.id ?? line.uuid;
    const t = Date.parse(line.timestamp);
    const out = usage.output_tokens;
    if (!id || Number.isNaN(t) || !(out > 0))
        return null;

    return {
        id,
        t,
        model: message.model ?? '',
        out,
        input: usage.input_tokens ?? 0,
        cacheRead: usage.cache_read_input_tokens ?? 0,
        cacheWrite: usage.cache_creation_input_tokens ?? 0,
        cwd: line.cwd ?? '',
        branch: line.gitBranch ?? '',
        sidechain: line.isSidechain === true,
    };
}

/**
 * Add a record, merging with any record of the same id. A streamed reply is written on several
 * lines: the line with the most output has the final counts, and the earliest timestamp is
 * kept. Merging the same record again changes nothing.
 *
 * Args:
 *     records: Map of id to record, updated in place.
 *     record: The record to add.
 */
export function mergeMessage(records, record) {
    const known = records.get(record.id);
    if (!known) {
        records.set(record.id, record);
        return;
    }
    const winner = record.out > known.out ? record : known;
    records.set(record.id, {...winner, t: Math.min(known.t, record.t)});
}

/**
 * Args:
 *     files: Object of transcript path to `{mtime, size}`, as last read.
 *     records: Map of id to record.
 *
 * Returns:
 *     The index file's text.
 */
export function serializeIndex(files, records) {
    return JSON.stringify({
        version: INDEX_VERSION,
        files,
        // `cents` (what the tokens cost, Cursor only) is an extra last column, left out when
        // there is none, so a Claude Code index keeps its shape
        records: [...records.values()].map(r => [
            r.id, r.t, r.model, r.out, r.input, r.cacheRead, r.cacheWrite, r.cwd, r.branch,
            r.sidechain, ...(r.cents > 0 ? [r.cents] : []),
        ]),
    });
}

/**
 * Read the index file's text. Anything unusable gives an empty index, so the caller rebuilds
 * it from the transcripts.
 *
 * Returns:
 *     `{files, records}`, with `records` a Map.
 */
export function parseIndex(text) {
    const empty = {files: {}, records: new Map()};
    let index;
    try {
        index = JSON.parse(text);
    } catch {
        return empty;
    }
    if (index?.version !== INDEX_VERSION || !Array.isArray(index.records))
        return empty;

    const records = new Map();
    for (const row of index.records) {
        if (!Array.isArray(row))
            continue;
        const [id, t, model, out, input, cacheRead, cacheWrite, cwd, branch, sidechain,
            cents] = row;
        if (![t, out, input, cacheRead, cacheWrite].every(Number.isFinite))
            continue;
        records.set(id, {id, t, model, out, input, cacheRead, cacheWrite, cwd, branch,
            sidechain: sidechain === true, ...(cents > 0 ? {cents} : {})});
    }
    return {files: index.files ?? {}, records};
}
