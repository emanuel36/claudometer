import {writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parseArgs} from 'node:util';

import {
    CursorState, EXPORT_FILE_NAME, Source, State, activityView, chosenRecords, claudeDir,
    cursorHomeDir, cursorUserDir, dataDir as defaultDataDir, exportCsv, indexGapSeconds,
    installHook, limitRows, loadRecords, modelsView, projectsView, readCursorPlan,
    readHistoryState, refreshUsage, statusText, uninstallHook, updateHistory,
} from '@claudometer/core';

import {readConfig, updateConfig} from './config.js';
import {installStatusLine, statusLineCommand, uninstallStatusLine} from './install.js';
import {
    colorsWanted, painter, renderActivity, renderLimits, renderModels, renderProjects,
} from './render.js';
import {statusLine} from './statusline.js';

const VERSION = '1.0.0';

const HELP = `claudometer ${VERSION}: your Claude Code limits, and how you use Claude Code and Cursor

Usage: claudometer [command] [options]

Commands:
  limits                 The plan limits and when they reset (the default)
  projects               Tokens per project, each split by model
  models                 Tokens per model
  activity               Tokens per day and per hour of the day
  export [file]          Save the history as CSV (default: ${EXPORT_FILE_NAME})
  statusline             The line for Claude Code's status line (reads its JSON on stdin)
  install-statusline     Show Claudometer in Claude Code's status line (--force replaces another)
  uninstall-statusline   Remove it again
  cursor on|off          Add Cursor's usage, all models, to the history (reads Cursor's login)
  cursor hook on|off     Also note the projects of Cursor CLI chats, with a Cursor hook
  rebuild                Read the whole history again

Options:
  --range <r>     today, 7d, 30d, 6m or all
  --source <s>    claude, cursor or all (default: all the sources turned on)
  --count <c>     output, output-input or all (tokens counted), or cost: what the tokens cost
                  in dollars, for Cursor usage only
  --json          Print JSON instead of a table
  -h, --help      Show this help
  -v, --version   Show the version
`;

const RANGES = ['today', '7d', '30d', '6m', 'all'];
const COUNTS = ['output', 'output-input', 'all', 'cost'];

function fail(message) {
    process.stderr.write(`claudometer: ${message}\n`);
    process.exit(1);
}

async function readStdin() {
    if (process.stdin.isTTY)
        return '';
    const chunks = [];
    for await (const chunk of process.stdin)
        chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8');
}

function sourcesOf(config) {
    return config.cursor ? [Source.CLAUDE, Source.CURSOR] : [Source.CLAUDE];
}

function cursorNote(history, config) {
    if (!config.cursor)
        return null;
    const {state, detail} = history.cursor;
    if (state === CursorState.NO_LOGIN)
        return 'Cursor: not signed in, open Cursor to sign in';
    if (state === CursorState.UNAVAILABLE)
        return `Cursor: unavailable (${detail})`;
    if (state === CursorState.OFFLINE)
        return 'Cursor: offline';
    if (state === CursorState.FAILED)
        return `Cursor: ${detail}`;
    return null;
}

async function main() {
    let parsed;
    try {
        parsed = parseArgs({
            allowPositionals: true,
            options: {
                range: {type: 'string'},
                source: {type: 'string'},
                count: {type: 'string'},
                json: {type: 'boolean'},
                force: {type: 'boolean'},
                help: {type: 'boolean', short: 'h'},
                version: {type: 'boolean', short: 'v'},
            },
        });
    } catch (e) {
        fail(e.message);
    }
    const {values, positionals} = parsed;
    if (values.help)
        return void process.stdout.write(HELP);
    if (values.version)
        return void process.stdout.write(`${VERSION}\n`);

    const data = defaultDataDir();
    const config = await readConfig(data);
    const claude = claudeDir(config.claudeDir);
    const paint = painter(colorsWanted());
    const [command = 'limits', ...rest] = positionals;
    const historyOptions = minGapMs => ({
        claudeDir: claude, cursorUserDir: cursorUserDir(), dataDir: data,
        sources: sourcesOf(config), keepDays: config.keepDays, minGapMs,
    });

    if (command === 'statusline') {
        process.stdout.write(`${await statusLine(await readStdin(), {
            dataDir: data, config, paint: painter(!process.env.NO_COLOR),
        })}\n`);
        return;
    }
    if (command === 'refresh') {
        await refreshUsage({claudeDir: claude, dataDir: data,
            maxAgeMs: config.refreshInterval * 1000 - 5000});
        await updateHistory(historyOptions(indexGapSeconds(config.readActivity) * 1000));
        return;
    }
    if (command === 'install-statusline') {
        const command = statusLineCommand();
        const result = await installStatusLine({claudeDir: claude, command, force: values.force});
        if (!result.installed) {
            fail(`Claude Code already has a status line (${result.existing.command ?? 'set'}). ` +
                'Run with --force to replace it.');
        }
        process.stdout.write(`Claude Code's status line now runs:\n  ${command}\n`);
        if (process.argv[1].includes('_npx'))
            process.stdout.write('This points at npx\'s cache: install it with `npm i -g claudometer-cli` and run this again.\n');
        return;
    }
    if (command === 'uninstall-statusline') {
        const removed = await uninstallStatusLine({claudeDir: claude});
        process.stdout.write(removed ? 'Removed Claudometer from Claude Code\'s status line.\n'
            : 'Claude Code\'s status line is not Claudometer\'s; nothing changed.\n');
        return;
    }
    if (command === 'cursor') {
        const [what, onOff] = rest[0] === 'hook' ? ['hook', rest[1]] : ['source', rest[0]];
        if (!['on', 'off'].includes(onOff))
            fail('use `claudometer cursor on|off` or `claudometer cursor hook on|off`');
        if (what === 'hook') {
            if (onOff === 'on')
                await installHook(cursorHomeDir(), data);
            else
                await uninstallHook(cursorHomeDir());
            process.stdout.write(`Cursor hook ${onOff === 'on' ? 'added to' : 'removed from'} ${
                path.join(cursorHomeDir(), 'hooks.json')}\n`);
            return;
        }
        await updateConfig(data, {cursor: onOff === 'on'});
        process.stdout.write(onOff === 'on'
            ? 'Cursor usage is on. Claudometer reads Cursor\'s login on this computer and sends it only to cursor.com.\n'
            : 'Cursor usage is off.\n');
        return;
    }

    if (command === 'limits') {
        const snapshot = await refreshUsage({claudeDir: claude, dataDir: data, maxAgeMs: 60000});
        if (config.cursor)
            await updateHistory({...historyOptions(indexGapSeconds(config.readActivity) * 1000),
                sources: [Source.CURSOR]});
        const plan = config.cursor ? await readCursorPlan(data) : null;
        const rows = limitRows(snapshot, plan, {modelLimits: true, resetStyle: config.resetStyle});
        if (values.json)
            return void process.stdout.write(`${JSON.stringify({...snapshot, rows, cursorPlan: plan?.summary ?? null}, null, 2)}\n`);
        process.stdout.write(`${renderLimits(rows, statusText(snapshot),
            {paint, stale: snapshot.state !== State.FRESH})}\n`);
        return;
    }

    const views = ['projects', 'models', 'activity', 'export', 'rebuild'];
    if (!views.includes(command))
        fail(`unknown command "${command}"; see claudometer --help`);
    const range = values.range ?? (command === 'activity' ? config.activityRange : config.listsRange);
    if (!RANGES.includes(range))
        fail(`--range must be one of ${RANGES.join(', ')}`);
    const source = values.source ?? (config.cursor ? 'all' : 'claude');
    if (!['claude', 'cursor', 'all'].includes(source))
        fail('--source must be claude, cursor or all');
    if (source === 'cursor' && !config.cursor)
        fail('Cursor usage is off; turn it on with `claudometer cursor on`');
    const count = values.count ?? config.count;
    if (!COUNTS.includes(count))
        fail(`--count must be one of ${COUNTS.join(', ')}`);
    // Claude Code's transcripts have no cost, so the cost is Cursor's alone
    if (count === 'cost' && !config.cursor)
        fail('--count cost needs Cursor usage; turn it on with `claudometer cursor on`');
    if (count === 'cost' && source === 'claude')
        fail('--count cost is for Cursor usage only; Claude Code has no cost to show');
    const unit = count === 'cost' ? 'cost' : 'tokens';

    const first = (await readHistoryState(data)).claude.ms === 0;
    if (first && process.stderr.isTTY)
        process.stderr.write(paint.dim('Reading your history, this takes about a minute the first time…\n'));
    const history = await updateHistory({...historyOptions(command === 'rebuild' ? 0 : 60000),
        rebuild: command === 'rebuild'});
    const note = cursorNote(history, config);
    if (note && process.stderr.isTTY)
        process.stderr.write(paint.dim(`${note}\n`));
    if (command === 'rebuild')
        return void process.stdout.write('History read again.\n');

    const all = await loadRecords(data, sourcesOf(config));
    if (command === 'export') {
        const file = path.resolve(rest[0] ?? EXPORT_FILE_NAME);
        const picked = source === 'all' ? all : all.filter(r => r.source === source);
        await writeFile(file, exportCsv(picked));
        return void process.stdout.write(`Saved ${file}\n`);
    }
    const records = chosenRecords(all, source, {count, hiddenProjects: config.hiddenProjects});
    const build = {
        projects: () => projectsView(records, {range, projectNames: config.projectNames,
            home: os.homedir(), unit}),
        models: () => modelsView(records, {range, unit}),
        activity: () => activityView(records, {range, unit}),
    }[command];
    const view = build();
    if (values.json)
        return void process.stdout.write(`${JSON.stringify(view, null, 2)}\n`);
    const render = {projects: renderProjects, models: renderModels, activity: renderActivity}[command];
    process.stdout.write(`${render(view, {paint})}\n`);
}

main().catch(e => fail(e.message));
