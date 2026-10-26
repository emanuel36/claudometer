import {spawn} from 'node:child_process';
import path from 'node:path';

import {
    Source, State, indexGapSeconds, limitTimeText, loadRecords, normalizeProjectPath,
    rangeStart, readHistoryState, readUsageCache,
} from '@claudometer/core';

import {renderStatusLine} from './render.js';

/**
 * Starts `claudometer refresh` on its own, so the status line never waits on the network or on
 * reading the history.
 */
export function refreshInBackground(script = process.argv[1]) {
    const child = spawn(process.execPath, [script, 'refresh'], {
        detached: true, stdio: 'ignore', windowsHide: true,
    });
    child.unref();
}

function parseInput(text) {
    try {
        return JSON.parse(text) ?? {};
    } catch {
        return {};
    }
}

/**
 * The line Claude Code shows under its prompt. Claude Code runs this often, so it only reads
 * Claudometer's files.
 *
 * Args:
 *     stdinText: The session's JSON from Claude Code (`workspace.current_dir`, `cwd`...).
 *     options: `dataDir`, `config`, `paint`, `nowMs` and `refresh`, called when the cached
 *         values are older than the refresh interval.
 */
export async function statusLine(stdinText, {dataDir, config, paint, nowMs = Date.now(),
    refresh = refreshInBackground}) {
    const input = parseInput(stdinText);
    const [cache, history] = await Promise.all([readUsageCache(dataDir),
        readHistoryState(dataDir)]);
    const usageOld = nowMs - cache.lastAttemptMs >= config.refreshInterval * 1000;
    const historyOld = nowMs - history.claude.ms >=
        Math.max(indexGapSeconds(config.readActivity), 60) * 1000;
    if (usageOld || historyOld)
        refresh();

    const stale = cache.state !== State.FRESH;
    const data = cache.data;
    const folder = input.workspace?.current_dir ?? input.cwd;
    let today = 0;
    if (folder) {
        const cwd = normalizeProjectPath(path.normalize(folder));
        const from = rangeStart(nowMs, 1);
        for (const record of await loadRecords(dataDir, [Source.CLAUDE])) {
            if (record.cwd === cwd && record.t >= from)
                today += record.out;
        }
    }
    return renderStatusLine({
        five: data?.five_hour?.utilization,
        week: data?.seven_day?.utilization,
        fiveLeft: data?.five_hour?.resets_at
            ? limitTimeText(data.five_hour.resets_at, nowMs,
                {stale, style: config.resetStyle, use24h: true})
            : null,
        today,
    }, {paint, colorScale: config.colorScale, stale});
}
