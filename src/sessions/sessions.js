// Pure helpers for reading Claude Code session files. No shell imports, so they can be
// checked under plain gjs (see tests/sessions.test.js).

/**
 * Parses the text of a session file (`<pid>.json`).
 *
 * Args:
 *     text: the file contents.
 *
 * Returns:
 *     A session `{pid, procStart, sessionId, name, kind, status, waitingFor, startedAt,
 *     statusUpdatedAt}`, or null for invalid JSON, missing fields, spare sessions and any
 *     kind other than `interactive` or `bg`.
 */
export function parseSession(text) {
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        return null;
    }
    if (data === null || typeof data !== 'object' || Array.isArray(data))
        return null;

    const {pid, sessionId, procStart, startedAt, statusUpdatedAt, status} = data;
    if (!Number.isInteger(pid) || pid <= 0)
        return null;
    if (typeof sessionId !== 'string' || sessionId === '')
        return null;
    if (typeof procStart !== 'string' && typeof procStart !== 'number')
        return null;
    if (!Number.isFinite(startedAt) || !Number.isFinite(statusUpdatedAt))
        return null;
    if (typeof status !== 'string')
        return null;
    if (data.spare === true)
        return null;
    const kind = data.kind ?? 'interactive';
    if (kind !== 'interactive' && kind !== 'bg')
        return null;

    return {
        pid,
        procStart: String(procStart),
        sessionId,
        name: sessionName(data),
        kind,
        status,
        waitingFor: typeof data.waitingFor === 'string' ? data.waitingFor : null,
        startedAt,
        statusUpdatedAt,
    };
}

function sessionName({name, cwd, sessionId}) {
    if (typeof name === 'string' && name !== '')
        return name;
    if (typeof cwd === 'string') {
        const folder = cwd.split('/').filter(part => part !== '').pop();
        if (folder)
            return folder;
    }
    return sessionId.slice(0, 8);
}

/**
 * Reads the process start time (field 22) from the text of `/proc/<pid>/stat`.
 *
 * Returns:
 *     The start time in clock ticks as a string, or null when the text is malformed.
 */
export function procStartFromStat(text) {
    const close = text.lastIndexOf(')');
    if (close < 0)
        return null;
    const fields = text.slice(close + 1).trim().split(/\s+/);
    return fields.length > 19 && /^\d+$/.test(fields[19]) ? fields[19] : null;
}

/**
 * Reads the controlling terminal (field 7) from the text of `/proc/<pid>/stat`.
 *
 * Returns:
 *     The terminal's device number, or null when the process has none or the text is
 *     malformed.
 */
export function ttyFromStat(text) {
    const close = text.lastIndexOf(')');
    if (close < 0)
        return null;
    const field = text.slice(close + 1).trim().split(/\s+/)[4];
    return /^\d+$/.test(field ?? '') && Number(field) > 0 ? Number(field) : null;
}

/**
 * Tells whether a `/proc/<pid>/environ` text (NUL-separated) belongs to a Ghostty terminal.
 */
export function isGhostty(environ) {
    return environ.split('\0').includes('TERM_PROGRAM=ghostty');
}

/**
 * Maps a session status to `waiting`, `working` or `idle`; unknown statuses count as working.
 */
export function sessionState(status) {
    if (status === 'waiting')
        return 'waiting';
    return status === 'idle' ? 'idle' : 'working';
}

/**
 * Names what a waiting session needs: `Permission`, `Question` or `Waiting`.
 */
export function waitingLabel(waitingFor) {
    if (waitingFor === null || waitingFor === 'permission prompt' ||
        waitingFor === 'sandbox request')
        return 'Permission';
    return waitingFor === 'input needed' ? 'Question' : 'Waiting';
}

/**
 * Keeps one session per `sessionId`: the one with the latest `statusUpdatedAt`.
 */
export function latestPerSession(sessions) {
    const latest = new Map();
    for (const session of sessions) {
        const known = latest.get(session.sessionId);
        if (!known || session.statusUpdatedAt > known.statusUpdatedAt)
            latest.set(session.sessionId, session);
    }
    return [...latest.values()];
}
