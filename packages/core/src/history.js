import path from 'node:path';

import {parseIndex} from '../../../src/history/transcripts.js';
import {claudeSummaryPath, updateClaudeIndex} from './claude-index.js';
import {CursorState, cursorSummaryPath, updateCursorIndex} from './cursor/cursor-index.js';
import {readJson, readText, tryLock, writeAtomically} from './files.js';

export const Source = Object.freeze({CLAUDE: 'claude', CURSOR: 'cursor'});

const statePath = dataDir => path.join(dataDir, 'history-state.json');

/** Returns: `{claude: {ms}, cursor: {ms, state, detail}}` from the last runs, any process. */
export async function readHistoryState(dataDir) {
    const state = await readJson(statePath(dataDir));
    return {claude: {ms: 0, ...state?.claude}, cursor: {ms: 0, state: null, ...state?.cursor}};
}

/**
 * Bring the summaries of the chosen sources up to date. One process at a time does it; the
 * others return the state as it is.
 *
 * Args:
 *     options: `claudeDir`, `cursorUserDir`, `dataDir`, `sources` (a list of `Source`),
 *         `keepDays`, `minGapMs` (sources read more recently than this are skipped) and
 *         `rebuild` (forget the Claude Code index and read every transcript again).
 *
 * Returns:
 *     The history state after the run.
 */
export async function updateHistory({claudeDir, cursorUserDir, dataDir, sources, keepDays = 0,
    minGapMs = 0, rebuild = false}) {
    const release = await tryLock(path.join(dataDir, 'history.lock'), 10 * 60000);
    if (!release)
        return readHistoryState(dataDir);
    try {
        const state = await readHistoryState(dataDir);
        const now = Date.now();
        if (sources.includes(Source.CLAUDE) && (rebuild || now - state.claude.ms >= minGapMs)) {
            if (rebuild)
                await writeAtomically(path.join(dataDir, 'claude-index.json'), '');
            const result = await updateClaudeIndex({claudeDir, dataDir, keepDays, nowMs: now});
            state.claude = {ms: now, records: result.records};
        }
        if (sources.includes(Source.CURSOR) && (rebuild || now - state.cursor.ms >= minGapMs)) {
            const result = await updateCursorIndex({userDir: cursorUserDir, dataDir, keepDays,
                nowMs: now});
            state.cursor = {...state.cursor, ms: now, state: result.state, detail: result.detail};
            if (result.state === CursorState.FRESH)
                state.cursor.events = result.events;
        }
        await writeAtomically(statePath(dataDir), JSON.stringify(state));
        return state;
    } finally {
        await release();
    }
}

async function loadSummary(file, source) {
    const {records} = parseIndex(await readText(file) ?? '');
    return [...records.values()].map(record => ({...record, source}));
}

/**
 * Returns:
 *     The hourly records of the chosen sources, each with a `source`, as one list. A source
 *     never read yet adds nothing.
 */
export async function loadRecords(dataDir, sources) {
    const lists = await Promise.all([
        sources.includes(Source.CLAUDE) ? loadSummary(claudeSummaryPath(dataDir), Source.CLAUDE)
            : [],
        sources.includes(Source.CURSOR) ? loadSummary(cursorSummaryPath(dataDir), Source.CURSOR)
            : [],
    ]);
    return lists.flat();
}
