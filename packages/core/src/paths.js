import os from 'node:os';
import path from 'node:path';

import {resolveClaudeDir} from '../../../src/prefs/config.js';

/**
 * Folder for Claudometer's index, summaries and caches, shared by the CLI and the editors.
 *
 * Returns:
 *     `%LOCALAPPDATA%\claudometer` on Windows, `~/Library/Application Support/claudometer` on
 *     macOS, and `$XDG_DATA_HOME/claudometer` (or `~/.local/share/claudometer`) elsewhere.
 */
export function dataDir(env = process.env, platform = process.platform, home = os.homedir()) {
    if (env.CLAUDOMETER_DATA_DIR)
        return env.CLAUDOMETER_DATA_DIR;
    if (platform === 'win32')
        return path.win32.join(env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local'),
            'claudometer');
    if (platform === 'darwin')
        return path.posix.join(home, 'Library', 'Application Support', 'claudometer');
    return path.posix.join(env.XDG_DATA_HOME || path.posix.join(home, '.local', 'share'),
        'claudometer');
}

/** Returns: Claude Code's folder, from the setting, `CLAUDE_CONFIG_DIR` or `~/.claude`. */
export function claudeDir(setting = '', env = process.env, home = os.homedir()) {
    return path.normalize(resolveClaudeDir(setting, env.CLAUDE_CONFIG_DIR ?? null, home));
}

/** Returns: Cursor's `User` folder, which holds `globalStorage/state.vscdb`. */
export function cursorUserDir(env = process.env, platform = process.platform,
    home = os.homedir()) {
    if (platform === 'win32')
        return path.win32.join(env.APPDATA || path.win32.join(home, 'AppData', 'Roaming'),
            'Cursor', 'User');
    if (platform === 'darwin')
        return path.posix.join(home, 'Library', 'Application Support', 'Cursor', 'User');
    return path.posix.join(env.XDG_CONFIG_HOME || path.posix.join(home, '.config'), 'Cursor',
        'User');
}

/** Returns: `~/.cursor`, which holds the user hooks. */
export function cursorHomeDir(home = os.homedir()) {
    return path.join(home, '.cursor');
}

/**
 * Windows drive letters come in either case (`c:\` from Cursor, `C:\` from Claude Code), so the
 * same folder is one project.
 */
export function normalizeProjectPath(folder) {
    return /^[a-z]:\\/.test(folder) ? folder[0].toUpperCase() + folder.slice(1) : folder;
}
