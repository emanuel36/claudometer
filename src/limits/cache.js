// Pure helpers for the usage cache. GNOME Shell disables extensions while the screen is locked,
// so the client saves what it knows after every request and reads it back when enabled again.
// No gi:// imports, so gjs tests can load it.

const VERSION = 1;

/**
 * Returns:
 *     The cache as text: the last good response and when it arrived, when the last request
 *     was sent, and the 429 backoff.
 */
export function serializeCache({credentialsPath, data, lastSuccessMs, lastRequestMs,
    backoffSeconds, backoffUntilMs}) {
    return JSON.stringify({version: VERSION, credentialsPath, data, lastSuccessMs,
        lastRequestMs, backoffSeconds, backoffUntilMs});
}

/**
 * Args:
 *     text: The cache file's contents.
 *     credentialsPath: The login the client uses now; a cache saved for another one is ignored.
 *
 * Returns:
 *     `{data, lastSuccessMs, lastRequestMs, backoffSeconds, backoffUntilMs}`, or null when the
 *     text is not a usable cache.
 */
export function parseCache(text, credentialsPath) {
    let cache;
    try {
        cache = JSON.parse(text);
    } catch {
        return null;
    }
    if (cache?.version !== VERSION || cache.credentialsPath !== credentialsPath)
        return null;
    const times = ['lastSuccessMs', 'lastRequestMs', 'backoffSeconds', 'backoffUntilMs'];
    if (times.some(key => !Number.isFinite(cache[key])))
        return null;
    const {data, lastSuccessMs, lastRequestMs, backoffSeconds, backoffUntilMs} = cache;
    return {
        data: data && typeof data === 'object' ? data : null,
        lastSuccessMs, lastRequestMs, backoffSeconds, backoffUntilMs,
    };
}

/**
 * Milliseconds to wait before the first request after a restart: the regular interval counted
 * from the last request, and never inside a 429 backoff.
 *
 * Returns:
 *     0 to ask now, also when there is no cache or the clock went back.
 */
export function firstRequestDelayMs(cache, intervalSeconds, nowMs) {
    if (!cache || cache.lastRequestMs > nowMs)
        return 0;
    const wait = Math.max(cache.lastRequestMs + intervalSeconds * 1000, cache.backoffUntilMs);
    return Math.max(0, wait - nowMs);
}
