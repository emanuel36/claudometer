import path from 'node:path';

import {bucketRecords, rangeStart} from '../../../../src/history/stats.js';
import {serializeIndex} from '../../../../src/history/transcripts.js';
import {readJson, writeAtomically} from '../files.js';
import {CursorApiError, fetchCursorEvents, fetchCursorSummary} from './api.js';
import {conversationProjects, openCursorDb, readAccessToken} from './db.js';
import {readHookProjects} from './hook.js';

const INDEX_VERSION = 1;
const DAY_MS = 86400000;
// Events of the last day are fetched again, in case some arrived late
const OVERLAP_MS = DAY_MS;
// How far back the first run goes when all history is kept
const FIRST_RUN_DAYS = 365;

export const CursorState = Object.freeze({
    FRESH: 'fresh',
    OFFLINE: 'offline',
    // Signed out of Cursor, or the session was rejected
    NO_LOGIN: 'no-login',
    FAILED: 'failed',
    // Cursor is not installed, or this Node has no node:sqlite
    UNAVAILABLE: 'unavailable',
});

export const cursorIndexPath = dataDir => path.join(dataDir, 'cursor-index.json');
export const cursorSummaryPath = dataDir => path.join(dataDir, 'cursor-summary.json');
export const cursorPlanPath = dataDir => path.join(dataDir, 'cursor-plan.json');

/**
 * Args:
 *     event: One usage event from the dashboard.
 *
 * Returns:
 *     `[id, t, model, out, input, cacheRead, cacheWrite, conversationId]`, or null for an
 *     event without tokens.
 */
export function eventRow(event) {
    const t = Number(event?.timestamp);
    const usage = event?.tokenUsage ?? {};
    const amounts = [usage.outputTokens, usage.inputTokens, usage.cacheReadTokens,
        usage.cacheWriteTokens].map(n => Number.isFinite(n) ? n : 0);
    if (!Number.isFinite(t) || amounts.every(n => n === 0))
        return null;
    const model = event.model || 'default';
    const conversation = event.conversationId ?? '';
    return [event.usageEventId || `${t}|${model}|${conversation}`, t, model, ...amounts,
        conversation];
}

/**
 * Args:
 *     rows: Index rows from `eventRow`.
 *     projects: Map of conversation id to project folder.
 *
 * Returns:
 *     Records in the shape of src/history/transcripts.js; requests whose conversation is
 *     unknown have an empty `cwd`.
 */
export function eventRecords(rows, projects) {
    return rows.map(([id, t, model, out, input, cacheRead, cacheWrite, conversation]) => ({
        id, t, model, out, input, cacheRead, cacheWrite, cwd: projects.get(conversation) ?? '',
        branch: '', sidechain: false,
    }));
}

function stateForError(e) {
    if (e instanceof CursorApiError) {
        if (e.status === 0)
            return {state: CursorState.OFFLINE, detail: null};
        if (e.status === 401 || e.status === 403)
            return {state: CursorState.NO_LOGIN, detail: null};
        return {state: CursorState.FAILED, detail: e.message};
    }
    return {state: CursorState.FAILED, detail: e.message};
}

/** Returns: The plan's usage as last fetched: `{fetchedMs, summary}`, or null. */
export function readCursorPlan(dataDir) {
    return readJson(cursorPlanPath(dataDir));
}

/**
 * Fetch Cursor's usage events since the last run and write a summary per hour, project and
 * model, in the same format as the Claude Code summary. Also saves the plan's usage.
 *
 * Args:
 *     options: `userDir` (Cursor's User folder), `dataDir`, `keepDays` (0 keeps everything),
 *         `nowMs`, and `fetchImpl` for tests.
 *
 * Returns:
 *     `{state, detail, events}`; on any state but fresh the previous summary is kept.
 */
export async function updateCursorIndex({userDir, dataDir, keepDays = 0, nowMs = Date.now(),
    fetchImpl = fetch}) {
    let db;
    try {
        db = await openCursorDb(userDir);
    } catch (e) {
        return {state: CursorState.UNAVAILABLE, detail: `node:sqlite: ${e.message}`, events: 0};
    }
    if (!db)
        return {state: CursorState.UNAVAILABLE, detail: 'Cursor not found', events: 0};
    let token;
    let projects;
    try {
        token = readAccessToken(db);
        projects = conversationProjects(db, userDir);
    } finally {
        db.close();
    }
    if (!token)
        return {state: CursorState.NO_LOGIN, detail: null, events: 0};
    for (const [conversation, folder] of await readHookProjects(dataDir)) {
        if (!projects.has(conversation))
            projects.set(conversation, folder);
    }

    const index = await readJson(cursorIndexPath(dataDir));
    const known = index?.version === INDEX_VERSION ? index : {fetchedUntilMs: 0, events: []};
    const keepFrom = keepDays > 0 ? rangeStart(nowMs, keepDays) : 0;
    const from = known.fetchedUntilMs
        ? known.fetchedUntilMs - OVERLAP_MS
        : keepFrom || nowMs - FIRST_RUN_DAYS * DAY_MS;

    let events;
    let summary;
    try {
        [events, summary] = await Promise.all([
            fetchCursorEvents(token, from, nowMs, fetchImpl),
            fetchCursorSummary(token, fetchImpl).catch(() => null),
        ]);
    } catch (e) {
        return {...stateForError(e), events: 0};
    }

    const rows = new Map(known.events.map(row => [row[0], row]));
    for (const event of events) {
        const row = eventRow(event);
        if (row)
            rows.set(row[0], row);
    }
    const kept = [...rows.values()].filter(row => row[1] >= keepFrom);
    await writeAtomically(cursorIndexPath(dataDir),
        JSON.stringify({version: INDEX_VERSION, fetchedUntilMs: nowMs, events: kept}));
    const buckets = new Map(bucketRecords(eventRecords(kept, projects), {keepModel: true})
        .map(b => [b.id, b]));
    await writeAtomically(cursorSummaryPath(dataDir), serializeIndex({}, buckets));
    if (summary)
        await writeAtomically(cursorPlanPath(dataDir), JSON.stringify({fetchedMs: nowMs, summary}));
    return {state: CursorState.FRESH, detail: null, events: kept.length};
}
