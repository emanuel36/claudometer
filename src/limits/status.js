// Pure helpers for the indicator state and its texts. No shell imports, so they can be
// checked under plain gjs (see tests/status.test.js).

export const State = Object.freeze({
    FRESH: 'fresh',
    OFFLINE: 'offline',
    EXPIRED: 'expired',
    FAILED: 'failed',
    // No Claude Code login on this computer
    NO_LOGIN: 'no-login',
});

export function isTokenExpired(expiresAt, nowMs) {
    return typeof expiresAt === 'number' && expiresAt <= nowMs;
}

export function stateForStatus(statusCode) {
    if (statusCode === 200)
        return State.FRESH;
    if (statusCode === 401)
        return State.EXPIRED;
    return State.FAILED;
}

const BACKOFF_BASE_SECONDS = 120;
const BACKOFF_MAX_SECONDS = 1800;

/**
 * Formats a span of minutes as a short countdown.
 *
 * Args:
 *     minutes: whole minutes, zero or more.
 *
 * Returns:
 *     "1d 1h", "1h 12m" or "4m".
 */
export function formatDuration(minutes) {
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor(minutes % 1440 / 60);
    const mins = minutes % 60;
    if (days > 0)
        return `${days}d ${hours}h`;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

/**
 * How long to stop calling the API after an HTTP 429.
 *
 * Args:
 *     retryAfter: The response's Retry-After header, or null.
 *     previousSeconds: The previous backoff, or 0 after a success.
 *
 * Returns:
 *     Retry-After when it is a number of seconds; otherwise the previous backoff doubled,
 *     from 2 min up to 30 min.
 */
export function backoffSeconds(retryAfter, previousSeconds) {
    const seconds = Number.parseInt(retryAfter, 10);
    if (seconds > 0)
        return seconds;
    return Math.min(previousSeconds ? previousSeconds * 2 : BACKOFF_BASE_SECONDS,
        BACKOFF_MAX_SECONDS);
}

function pad2(n) {
    return String(n).padStart(2, '0');
}

/**
 * Local time of day.
 *
 * Args:
 *     ms: Timestamp.
 *     use24h: `09:05` when true, `9:05 AM` when false.
 */
export function formatClock(ms, use24h = true) {
    const date = new Date(ms);
    if (use24h)
        return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
    const hour = date.getHours() % 12 || 12;
    return `${hour}:${pad2(date.getMinutes())} ${date.getHours() < 12 ? 'AM' : 'PM'}`;
}

export function formatAgo(thenMs, nowMs) {
    const mins = Math.floor((nowMs - thenMs) / 60000);
    if (mins < 1)
        return 'just now';
    if (mins < 60)
        return `${mins} min ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24)
        return `${hours} h ago`;
    return `${Math.floor(hours / 24)} d ago`;
}

/**
 * The status line at the bottom of the popup: how fresh the limits are, or what is wrong.
 *
 * Args:
 *     state: One of `State`.
 *     detail: Failure detail for `State.FAILED`, e.g. "HTTP 503".
 *     lastSuccessMs: Time of the last successful fetch, or 0 if there was none.
 *     nowMs: Current time.
 *     use24h: Clock format for "values from".
 *
 * Returns:
 *     `{icon, text}`, e.g. "Updated 2 min ago" or "Offline · values from 14:05".
 */
export function statusLine(state, detail, lastSuccessMs, nowMs, use24h = true) {
    switch (state) {
    case State.NO_LOGIN:
        return {icon: 'avatar-default-symbolic', text: 'Not signed in to Claude Code'};
    case State.OFFLINE:
        return {
            icon: 'network-offline-symbolic',
            text: lastSuccessMs
                ? `Offline · values from ${formatClock(lastSuccessMs, use24h)}` : 'Offline',
        };
    case State.EXPIRED:
        return {icon: 'dialog-password-symbolic', text: 'Login expired · open Claude Code'};
    case State.FAILED:
        return {icon: 'dialog-warning-symbolic', text: `${detail} · retrying`};
    default:
        return lastSuccessMs
            ? {icon: 'emblem-ok-symbolic', text: `Updated ${formatAgo(lastSuccessMs, nowMs)}`}
            : {icon: 'emblem-synchronizing-symbolic', text: 'Checking your limits'};
    }
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Short reset time for a limit row.
 *
 * Args:
 *     isoString: The limit's `resets_at` from the API.
 *     nowMs: Current time.
 *     options: `stale` (value comes from an older fetch), `style` (`countdown` or `clock`)
 *         and `use24h` (clock format).
 *
 * Returns:
 *     "—" for an invalid date; "now" once passed (the clock time when stale); a countdown
 *     ("3d 5h", "2h 14m", "14m") or a clock ("16:44", "Sun 19:20" from 24 h on).
 */
export function limitTimeText(isoString, nowMs, {stale, style, use24h}) {
    const resetMs = Date.parse(isoString);
    if (Number.isNaN(resetMs))
        return '—';
    if (resetMs <= nowMs)
        return stale ? formatClock(resetMs, use24h) : 'now';

    if (style === 'clock') {
        const clock = formatClock(resetMs, use24h);
        if (resetMs - nowMs < 24 * 3600000)
            return clock;
        return `${WEEKDAYS[new Date(resetMs).getDay()]} ${clock}`;
    }

    return formatDuration(Math.floor((resetMs - nowMs) / 60000));
}

export const SCREEN_STATES = {
    loadingLimits: {icon: 'emblem-synchronizing-symbolic', title: 'Checking your limits',
        line: 'This takes a few seconds.'},
    loadingActivity: {icon: 'emblem-synchronizing-symbolic', title: 'Reading your activity',
        line: 'This takes about a minute the first time.'},
    offline: {icon: 'network-offline-symbolic', title: 'You are offline',
        line: 'Limits will refresh when the network is back.'},
    noLogin: {icon: 'avatar-default-symbolic', title: 'Not signed in',
        line: 'Sign in to Claude Code to see your limits.'},
    expired: {icon: 'dialog-password-symbolic', title: 'Login expired',
        line: 'Open Claude Code to renew it.'},
    // The line is filled by limitsScreen
    failed: {icon: 'dialog-warning-symbolic', title: 'Limits unavailable',
        line: '<detail>. Trying again soon.'},
    empty: {icon: 'document-open-recent-symbolic', title: 'No activity yet',
        line: 'Use Claude Code and it will show up here.'},
};

/**
 * Args:
 *     state: One of `State`.
 *     detail: Failure detail for `State.FAILED`, e.g. "HTTP 503".
 *     hasData: Whether there are limit values to show.
 *
 * Returns:
 *     `{icon, title, line}` for the block that replaces the limits table, or null when there
 *     are values to show.
 */
export function limitsScreen(state, detail, hasData) {
    if (hasData)
        return null;
    switch (state) {
    case State.OFFLINE:
        return SCREEN_STATES.offline;
    case State.NO_LOGIN:
        return SCREEN_STATES.noLogin;
    case State.EXPIRED:
        return SCREEN_STATES.expired;
    case State.FAILED:
        return {...SCREEN_STATES.failed, line: `${detail}. Trying again soon.`};
    default:
        return SCREEN_STATES.loadingLimits;
    }
}
