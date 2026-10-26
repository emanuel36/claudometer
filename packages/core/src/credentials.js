import {execFile} from 'node:child_process';
import path from 'node:path';

import {readText} from './files.js';

// The Keychain item Claude Code keeps its login in on macOS
const KEYCHAIN_SERVICE = 'Claude Code-credentials';

function parseLogin(text) {
    try {
        const login = JSON.parse(text)?.claudeAiOauth;
        return login?.accessToken ? login : null;
    } catch {
        return null;
    }
}

function readKeychain() {
    return new Promise(resolve => {
        execFile('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'],
            {timeout: 10000}, (error, stdout) => resolve(error ? null : parseLogin(stdout.trim())));
    });
}

/**
 * Claude Code's login. It is only read: renewing it here would sign Claude Code out.
 *
 * Args:
 *     claudeDir: Claude Code's folder.
 *     platform: On macOS the Keychain is read first, then the file.
 *
 * Returns:
 *     `{accessToken, expiresAt, ...}`, or null when not signed in.
 */
export async function readClaudeLogin(claudeDir, platform = process.platform) {
    if (platform === 'darwin') {
        const login = await readKeychain();
        if (login)
            return login;
    }
    return parseLogin(await readText(credentialsPath(claudeDir)) ?? '');
}

/** Returns: The file Claude Code rewrites when it renews the login (Linux and Windows). */
export function credentialsPath(claudeDir) {
    return path.join(claudeDir, '.credentials.json');
}
