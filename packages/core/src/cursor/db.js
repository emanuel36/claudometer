import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {normalizeProjectPath} from '../paths.js';

let sqlite;

// node:sqlite warns that it is experimental on every import; Claudometer only reads with it
async function loadSqlite() {
    if (sqlite)
        return sqlite;
    const emitWarning = process.emitWarning;
    process.emitWarning = (warning, ...args) => {
        if (!String(warning?.message ?? warning).includes('SQLite'))
            emitWarning.call(process, warning, ...args);
    };
    try {
        sqlite = await import('node:sqlite');
    } finally {
        process.emitWarning = emitWarning;
    }
    return sqlite;
}

export function cursorDbPath(userDir) {
    return path.join(userDir, 'globalStorage', 'state.vscdb');
}

/**
 * Open Cursor's state database read-only. It can be many gigabytes, so only indexed lookups
 * are made on it.
 *
 * Returns:
 *     The database, or null when Cursor is not installed.
 *
 * Throws:
 *     When this Node has no `node:sqlite` (before 22.13).
 */
export async function openCursorDb(userDir) {
    const file = cursorDbPath(userDir);
    if (!existsSync(file))
        return null;
    const {DatabaseSync} = await loadSqlite();
    return new DatabaseSync(file, {readOnly: true});
}

/** Returns: The signed-in user's session token, or null when signed out. */
export function readAccessToken(db) {
    const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?')
        .get('cursorAuth/accessToken');
    return typeof row?.value === 'string' && row.value ? row.value : null;
}

function workspaceFolder(userDir, workspaceId) {
    try {
        const file = path.join(userDir, 'workspaceStorage', workspaceId, 'workspace.json');
        const folder = JSON.parse(readFileSync(file, 'utf8')).folder;
        return folder?.startsWith('file:') ? fileURLToPath(folder) : null;
    } catch {
        return null;
    }
}

/**
 * Returns:
 *     Map of conversation id (the `conversationId` of a usage event) to its project folder,
 *     for every agent conversation Cursor keeps.
 */
export function conversationProjects(db, userDir) {
    const projects = new Map();
    let rows;
    try {
        rows = db.prepare('SELECT composerId, workspaceId, value FROM composerHeaders').all();
    } catch {
        // Older Cursor versions have no such table
        return projects;
    }
    const byWorkspace = new Map();
    for (const {composerId, workspaceId, value} of rows) {
        let folder = null;
        try {
            folder = JSON.parse(value)?.workspaceIdentifier?.uri?.fsPath ?? null;
        } catch {
            // Falls back to the workspace's folder
        }
        if (!folder && workspaceId) {
            if (!byWorkspace.has(workspaceId))
                byWorkspace.set(workspaceId, workspaceFolder(userDir, workspaceId));
            folder = byWorkspace.get(workspaceId);
        }
        if (folder)
            projects.set(composerId, normalizeProjectPath(folder));
    }
    return projects;
}
