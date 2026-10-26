import {copyFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {normalizeProjectPath} from '../paths.js';
import {readJson, readText, writeAtomically} from '../files.js';

// Cursor's dashboard knows each request's conversation; conversations started by the Cursor CLI
// are not in the editor's database, so this hook notes which folder each one runs in
const HOOK_EVENT = 'stop';
const SCRIPT_NAME = 'claudometer-cursor-hook';

export const hookLogPath = dataDir => path.join(dataDir, 'cursor-conversations.jsonl');

function powershellScript(log) {
    return `$ErrorActionPreference = 'SilentlyContinue'
$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
if ($payload.conversation_id) {
    $line = @{conversation_id = $payload.conversation_id; workspace_roots = @($payload.workspace_roots)} | ConvertTo-Json -Compress
    Add-Content -LiteralPath '${log.replaceAll("'", "''")}' -Value $line -Encoding utf8
}
'{}'
`;
}

function shellScript(log) {
    return `#!/bin/sh
payload=$(tr -d '\\n')
case "$payload" in
    *conversation_id*) printf '%s\\n' "$payload" >> '${log.replaceAll("'", "'\\''")}' ;;
esac
echo '{}'
`;
}

/** Returns: The hook's command line for this platform. */
export function hookCommand(dataDir, platform = process.platform) {
    if (platform === 'win32') {
        const script = path.win32.join(dataDir, `${SCRIPT_NAME}.ps1`);
        return `powershell -NoProfile -ExecutionPolicy Bypass -File "${script}"`;
    }
    return `sh "${path.posix.join(dataDir, `${SCRIPT_NAME}.sh`)}"`;
}

const isOurs = entry => typeof entry?.command === 'string' && entry.command.includes(SCRIPT_NAME);

/**
 * Args:
 *     config: The parsed `hooks.json`, or null when there is none.
 *     command: The hook's command line.
 *
 * Returns:
 *     The config with the hook added once; every other hook is kept as it was.
 */
export function withHook(config, command) {
    const next = {version: 1, ...config, hooks: {...config?.hooks}};
    const entries = (next.hooks[HOOK_EVENT] ?? []).filter(entry => !isOurs(entry));
    next.hooks[HOOK_EVENT] = [...entries, {command, timeout: 10}];
    return next;
}

/** Returns: The config without the hook; an event left with no hooks is dropped. */
export function withoutHook(config) {
    const next = {...config, hooks: {...config?.hooks}};
    const entries = (next.hooks[HOOK_EVENT] ?? []).filter(entry => !isOurs(entry));
    if (entries.length)
        next.hooks[HOOK_EVENT] = entries;
    else
        delete next.hooks[HOOK_EVENT];
    return next;
}

/** Returns: Whether the hook is in `~/.cursor/hooks.json`. */
export async function isHookInstalled(cursorHome) {
    const config = await readJson(path.join(cursorHome, 'hooks.json'));
    return (config?.hooks?.[HOOK_EVENT] ?? []).some(isOurs);
}

/**
 * Add the hook to the user's `~/.cursor/hooks.json`, keeping a backup of the file as it was.
 * Unparseable JSON is left alone.
 */
export async function installHook(cursorHome, dataDir, platform = process.platform) {
    const file = path.join(cursorHome, 'hooks.json');
    const text = await readText(file);
    let config = null;
    if (text !== null) {
        try {
            config = JSON.parse(text);
        } catch {
            throw new Error(`${file} is not valid JSON; fix it and try again`);
        }
        await copyFile(file, `${file}.claudometer-backup`);
    }
    const log = hookLogPath(dataDir);
    await writeAtomically(path.join(dataDir, `${SCRIPT_NAME}.ps1`), powershellScript(log));
    await writeAtomically(path.join(dataDir, `${SCRIPT_NAME}.sh`), shellScript(log));
    await writeFile(log, '', {flag: 'a'});
    await writeAtomically(file, `${JSON.stringify(withHook(config, hookCommand(dataDir,
        platform)), null, 2)}\n`);
}

export async function uninstallHook(cursorHome) {
    const file = path.join(cursorHome, 'hooks.json');
    const config = await readJson(file);
    if (config)
        await writeAtomically(file, `${JSON.stringify(withoutHook(config), null, 2)}\n`);
}

/**
 * Args:
 *     text: The hook's log, one payload per line.
 *
 * Returns:
 *     Map of conversation id to the folder it ran in (the first workspace root).
 */
export function parseHookLog(text) {
    const projects = new Map();
    for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
        let payload;
        try {
            payload = JSON.parse(line);
        } catch {
            continue;
        }
        const root = [payload?.workspace_roots ?? []].flat()[0];
        if (payload?.conversation_id && typeof root === 'string' && root) {
            // Windows roots may come as `/c:/Users/...`
            projects.set(payload.conversation_id,
                normalizeProjectPath(path.normalize(root.replace(/^\/([a-zA-Z]:)/, '$1'))));
        }
    }
    return projects;
}

export async function readHookProjects(dataDir) {
    return parseHookLog(await readText(hookLogPath(dataDir)) ?? '');
}
