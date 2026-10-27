// Pure state machine behind the Status tab: which sessions are Done and seen, when a seen mark
// expires, the row order and texts, and the state file format. No shell imports, so it can be
// checked under plain gjs (see tests/tracker.test.js).
import {formatDuration} from '../limits/status.js';
import {sessionState, waitingLabel} from './sessions.js';

/** A session that went idle this soon after it started never ran a turn. */
export const STARTUP_GRACE_MS = 10000;

const STATES = ['waiting', 'working', 'idle'];

/**
 * Brings the records up to date with the current sessions. Records are never mutated.
 *
 * Args:
 *     records: `Map<sessionId, {state, statusUpdatedAt, done, seenAt}>`.
 *     sessions: the current sessions.
 *     nowMs: the current time in milliseconds.
 *     keepMs: how long a Done session stays after it was seen.
 *
 * Returns:
 *     A new map holding one record per session in `sessions`.
 */
export function reconcile(records, sessions, nowMs, keepMs) {
    const next = new Map();
    for (const session of sessions) {
        const state = sessionState(session.status);
        const {statusUpdatedAt} = session;
        const known = records.get(session.sessionId);
        let done = false;
        let seenAt = null;
        if (state === 'idle') {
            if (!known)
                done = statusUpdatedAt - session.startedAt > STARTUP_GRACE_MS;
            else if (known.statusUpdatedAt !== statusUpdatedAt)
                done = true;
            else
                ({done, seenAt} = known);
            if (done && seenAt !== null && nowMs - seenAt >= keepMs)
                done = false;
        }
        next.set(session.sessionId, {state, statusUpdatedAt, done, seenAt});
    }
    return next;
}

/**
 * Marks every Done session that is not seen yet as seen now.
 */
export function markSeen(records, nowMs) {
    const next = new Map();
    for (const [id, record] of records) {
        const mark = record.done && record.seenAt === null;
        next.set(id, mark ? {...record, seenAt: nowMs} : record);
    }
    return next;
}

/**
 * Drops the Done mark of one session; it stays off until the session changes status again.
 */
export function clearDone(records, sessionId) {
    const next = new Map(records);
    const record = records.get(sessionId);
    if (record)
        next.set(sessionId, {...record, done: false});
    return next;
}

/**
 * Builds what the Status tab shows.
 *
 * Rows are Waiting sessions (oldest first), then Done sessions not seen (newest first), then
 * Done sessions seen (newest first). A Done row is fresh (accent marker, counted in the header)
 * when it is not seen or was seen at or after `freshSinceMs`.
 *
 * Args:
 *     records: the records from `reconcile`.
 *     sessions: the current sessions.
 *     nowMs: the current time in milliseconds.
 *     freshSinceMs: seen marks from this time on still look fresh (the current popup opening).
 *
 * Returns:
 *     `{rows: [{sessionId, name, label, time, marker}], header, summary, newCount}`, where
 *     `header` is the right-hand text of the section header (the view draws `SESSIONS`) and
 *     `newCount` counts Waiting plus Done sessions not seen yet.
 */
export function listing(records, sessions, nowMs, freshSinceMs = Infinity) {
    const waiting = [];
    const doneNew = [];
    const doneSeen = [];
    let working = 0;
    let idle = 0;
    for (const session of sessions) {
        const state = sessionState(session.status);
        const record = records.get(session.sessionId);
        if (state === 'waiting') {
            waiting.push(session);
        } else if (state === 'idle' && record?.done) {
            (record.seenAt === null ? doneNew : doneSeen).push(session);
        } else if (state === 'idle') {
            idle++;
        } else {
            working++;
        }
    }
    const byTime = (a, b) => a.statusUpdatedAt - b.statusUpdatedAt;
    waiting.sort(byTime);
    doneNew.sort((a, b) => byTime(b, a));
    doneSeen.sort((a, b) => byTime(b, a));

    const row = (session, label, marker) => ({
        sessionId: session.sessionId,
        name: session.name,
        label,
        time: formatDuration(Math.max(0, Math.floor((nowMs - session.statusUpdatedAt) / 60000))),
        marker,
    });
    const rows = [
        ...waiting.map(s => row(s, waitingLabel(s.waitingFor), 'accent')),
        ...doneNew.map(s => row(s, 'Done', 'accent')),
        ...doneSeen.map(s => {
            const open = records.get(s.sessionId).seenAt >= freshSinceMs;
            return row(s, 'Done', open ? 'accent' : 'dim');
        }),
    ];

    const fresh = rows.filter(r => r.marker === 'accent').length;
    const header = fresh > 0 ? `${fresh} WAITING FOR YOU` : 'NOTHING WAITING';
    const summary = sessions.length === 0 ? 'No Claude Code sessions' :
        `${working} working · ${idle} idle`;

    return {rows, header, summary, newCount: waiting.length + doneNew.length};
}

/**
 * Serializes the records to the text of the state file.
 */
export function serializeRecords(records) {
    return JSON.stringify({version: 1, records: Object.fromEntries(records)});
}

/**
 * Parses the state file. Returns an empty map for invalid JSON or another version, and skips
 * the records with a wrong shape.
 */
export function parseRecords(text) {
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        return new Map();
    }
    const stored = data?.records;
    const records = new Map();
    if (data?.version !== 1 || stored === null || typeof stored !== 'object')
        return records;
    for (const [id, r] of Object.entries(stored)) {
        if (r === null || typeof r !== 'object' || !STATES.includes(r.state))
            continue;
        if (!Number.isFinite(r.statusUpdatedAt) || typeof r.done !== 'boolean')
            continue;
        if (r.seenAt !== null && !Number.isFinite(r.seenAt))
            continue;
        records.set(id, {state: r.state, statusUpdatedAt: r.statusUpdatedAt, done: r.done,
            seenAt: r.seenAt});
    }
    return records;
}
