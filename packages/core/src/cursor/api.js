// Cursor's dashboard endpoints, the ones its web dashboard calls. They are not a public API, so
// any change in them only turns the Cursor source off.
const BASE_URL = 'https://cursor.com';
const PAGE_SIZE = 500;
const MAX_PAGES = 100;
const REQUEST_TIMEOUT_MS = 20000;

export class CursorApiError extends Error {
    /** Args: `status` is the HTTP status, or 0 when the service could not be reached. */
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

/** Returns: The dashboard's session cookie, built from the editor's own session token. */
export function sessionCookie(token) {
    let subject = '';
    try {
        subject = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub ?? '';
    } catch {
        throw new CursorApiError(401, 'Unreadable session');
    }
    const userId = String(subject).split('|').pop();
    return `WorkosCursorSessionToken=${userId}%3A%3A${token}`;
}

async function call(token, pathname, body, fetchImpl) {
    let response;
    try {
        response = await fetchImpl(`${BASE_URL}${pathname}`, {
            method: body ? 'POST' : 'GET',
            headers: {
                'Cookie': sessionCookie(token),
                'Origin': BASE_URL,
                'Content-Type': 'application/json',
            },
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    } catch (e) {
        if (e instanceof CursorApiError)
            throw e;
        throw new CursorApiError(0, 'Offline');
    }
    if (!response.ok)
        throw new CursorApiError(response.status, `HTTP ${response.status}`);
    try {
        return await response.json();
    } catch {
        throw new CursorApiError(response.status, 'Invalid response');
    }
}

/**
 * Returns:
 *     The plan's usage in the current billing cycle: `{billingCycleStart, billingCycleEnd,
 *     membershipType, isUnlimited, individualUsage: {plan: {used, limit, totalPercentUsed},
 *     onDemand: {enabled, used}}}`, the amounts in cents; `onDemand.used` is what was billed
 *     beyond the plan.
 */
export function fetchCursorSummary(token, fetchImpl = fetch) {
    return call(token, '/api/usage-summary', null, fetchImpl);
}

/**
 * Every usage event between two times: one per model request, with its tokens.
 *
 * Returns:
 *     `[{timestamp, model, kind, conversationId, usageEventId, tokenUsage: {inputTokens,
 *     outputTokens, cacheReadTokens, cacheWriteTokens, totalCents}}]`, `totalCents` being the
 *     cost of the tokens at the model's rates, and `kind` how Cursor billed the event.
 */
export async function fetchCursorEvents(token, startMs, endMs, fetchImpl = fetch) {
    const events = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
        const result = await call(token, '/api/dashboard/get-filtered-usage-events', {
            teamId: 0, startDate: String(startMs), endDate: String(endMs), page,
            pageSize: PAGE_SIZE,
        }, fetchImpl);
        const batch = result?.usageEventsDisplay ?? [];
        events.push(...batch);
        if (batch.length < PAGE_SIZE || events.length >= (result.totalUsageEventsCount ?? 0))
            break;
    }
    return events;
}
