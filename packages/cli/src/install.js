import {copyFile} from 'node:fs/promises';
import path from 'node:path';

import {readJson, readText, writeAtomically} from '@claudometer/core';

const MARKER = 'statusline';

/**
 * Returns:
 *     The command Claude Code runs for the status line: this Node and this script, by full
 *     path, so it works whatever the PATH. Forward slashes work in every Windows shell.
 */
export function statusLineCommand(node = process.execPath, script = process.argv[1],
    platform = process.platform) {
    const slashes = text => platform === 'win32' ? text.replaceAll('\\', '/') : text;
    return `"${slashes(node)}" "${slashes(path.resolve(script))}" ${MARKER}`;
}

const isOurs = statusLine => typeof statusLine?.command === 'string' &&
    statusLine.command.includes('claudometer') && statusLine.command.includes(MARKER);

/**
 * Point Claude Code's status line at Claudometer, in `<claudeDir>/settings.json`.
 *
 * Args:
 *     options: `claudeDir`, `command`, and `force` to replace another status line.
 *
 * Returns:
 *     `{installed: true}`, or `{installed: false, existing}` when another status line is set
 *     and `force` is off.
 */
export async function installStatusLine({claudeDir, command, force = false}) {
    const file = path.join(claudeDir, 'settings.json');
    const text = await readText(file);
    let settings = null;
    if (text !== null) {
        try {
            settings = JSON.parse(text);
        } catch {
            throw new Error(`${file} is not valid JSON; fix it and try again`);
        }
    }
    const existing = settings?.statusLine;
    if (existing && !isOurs(existing) && !force)
        return {installed: false, existing};
    if (settings)
        await copyFile(file, `${file}.claudometer-backup`);
    await writeAtomically(file, `${JSON.stringify({
        ...settings, statusLine: {type: 'command', command, padding: 0},
    }, null, 2)}\n`);
    return {installed: true};
}

/** Removes the status line when it is Claudometer's. Returns: whether it was removed. */
export async function uninstallStatusLine({claudeDir}) {
    const file = path.join(claudeDir, 'settings.json');
    const settings = await readJson(file);
    if (!isOurs(settings?.statusLine))
        return false;
    const {statusLine, ...rest} = settings;
    await writeAtomically(file, `${JSON.stringify(rest, null, 2)}\n`);
    return true;
}
