import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

/**
 * Creates the session that sends the usage requests.
 *
 * Args:
 *     timeoutSeconds: A stalled connection fails after this long.
 *     userAgent: Sent with every request.
 *
 * Returns:
 *     The session, to pass to `getUrl` and `abortSession`.
 */
export function createSession({timeoutSeconds, userAgent}) {
    return new Soup.Session({timeout: timeoutSeconds, user_agent: userAgent});
}

/**
 * Sends a GET request on a new connection.
 *
 * Args:
 *     session: From `createSession`.
 *     url: The address to request.
 *     headers: The request headers, as `[[name, value], ...]`.
 *     callback: Called once with `(error, response)`. `error` is an `Error` when the request did
 *         not complete (network, TLS, timeout), else null and `response` is
 *         `{status, retryAfter, body}`: the status code, the `Retry-After` header or null, and
 *         the body bytes as a Uint8Array, empty when there is no body.
 */
export function getUrl(session, url, headers, callback) {
    const message = Soup.Message.new('GET', url);
    for (const [name, value] of headers)
        message.request_headers.append(name, value);
    // A pooled connection that reaches Soup's 60 s idle limit fails at once with "Socket
    // I/O timed out", and refresh intervals are often 60 s
    message.add_flags(Soup.MessageFlags.NEW_CONNECTION);

    session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (source, result) => {
        let bytes;
        try {
            bytes = source.send_and_read_finish(result);
        } catch (e) {
            callback(e, null);
            return;
        }
        callback(null, {
            status: message.status_code,
            retryAfter: message.response_headers.get_one('Retry-After'),
            body: bytes.get_data() ?? new Uint8Array(),
        });
    });
}

/**
 * Cancels the requests still in flight.
 *
 * Args:
 *     session: From `createSession`.
 */
export function abortSession(session) {
    session.abort();
}
