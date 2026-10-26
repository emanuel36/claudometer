import os from 'node:os';
import path from 'node:path';
import {Worker} from 'node:worker_threads';

import * as vscode from 'vscode';

import {
    CursorState, EXPORT_FILE_NAME, NO_PROJECT, Source, State, UsageClient, activityView,
    chosenRecords, claudeDir, cursorHomeDir, cursorUserDir, dataDir, exportCsv, indexGapSeconds,
    installHook, isHookInstalled, limitRows, limitsScreen, loadRecords, modelsView, projectsView,
    readCursorPlan, readHistoryState, statusText, uninstallHook,
} from '@claudometer/core';

import {SECTION, readSettings, updateSetting, use24h} from './settings.js';
import {StatusBar} from './status-bar.js';
import {UsageViewProvider} from './view-provider.js';

// "Updated N min ago" and the reset times move on
const TICK_MS = 60000;
const UI_KEY = 'claudometer.ui';
const CURSOR_ASKED_KEY = 'claudometer.cursorAsked';
const RANGES = {activity: ['7d', '30d', '6m', 'all'], lists: ['today', '7d', '30d', 'all']};

class Controller {
    constructor(context) {
        this._context = context;
        this._dataDir = dataDir();
        this._settings = readSettings();
        this._snapshot = {state: State.FRESH, detail: null, data: null, lastSuccessMs: 0};
        this._cursorPlan = null;
        this._history = null;
        // Hourly totals of every source; null until the first summary is read
        this._records = null;
        this._indexing = false;
        this._rebuildPending = false;
        this._ui = {tab: 'Limits', source: 'all', measure: 'tokens', activityRange: null,
            listsRange: null, ...context.globalState.get(UI_KEY)};

        this._statusBar = new StatusBar(this._settings.alignment);
        this._provider = new UsageViewProvider(context.extensionUri,
            message => this._onMessage(message), () => this._onVisible());
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider('claudometer.view', this._provider),
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration(SECTION))
                    this._onSettings();
            }),
            ...this._commands(),
        );
        this._startClient();
        this._tickId = setInterval(() => this._tick(), TICK_MS);
        this._loadSummaries().then(() => this._runHistory());
        this._askAboutCursor();
    }

    _commands() {
        const register = (name, fn) => vscode.commands.registerCommand(`claudometer.${name}`, fn);
        return [
            register('show', () => vscode.commands.executeCommand('claudometer.view.focus')),
            register('refresh', () => {
                this._client.refresh({force: true});
                this._runHistory({minGapMs: 0});
            }),
            register('rebuild', () => this._runHistory({rebuild: true})),
            register('exportCsv', () => this._exportCsv()),
            register('enableCursor', () => updateSetting('cursor.enabled', true)),
            register('disableCursor', () => updateSetting('cursor.enabled', false)),
            register('installCursorHook', () => this._installHook()),
            register('removeCursorHook', async () => {
                await uninstallHook(cursorHomeDir());
                vscode.window.showInformationMessage('Claudometer: the Cursor hook is removed.');
            }),
            register('openSettings', () => vscode.commands.executeCommand(
                'workbench.action.openSettings', `@ext:${this._context.extension.id}`)),
        ];
    }

    _sources() {
        return this._settings.cursor ? [Source.CLAUDE, Source.CURSOR] : [Source.CLAUDE];
    }

    _startClient() {
        this._client?.dispose();
        this._client = new UsageClient({
            claudeDir: claudeDir(this._settings.claudeDir),
            dataDir: this._dataDir,
            intervalSeconds: this._settings.refreshInterval,
            onChange: snapshot => {
                this._snapshot = snapshot;
                this._render();
            },
        });
    }

    _onSettings() {
        const before = this._settings;
        this._settings = readSettings();
        if (before.claudeDir !== this._settings.claudeDir) {
            this._startClient();
            this._runHistory({rebuild: true});
        } else if (before.refreshInterval !== this._settings.refreshInterval) {
            this._client.setInterval(this._settings.refreshInterval);
        }
        if (before.cursor !== this._settings.cursor) {
            this._loadSummaries();
            if (this._settings.cursor)
                this._runHistory({minGapMs: 0});
        }
        this._render();
    }

    _tick() {
        const gap = indexGapSeconds(this._settings.readActivity);
        if (gap > 0)
            this._runHistory({minGapMs: gap * 1000});
        this._render();
    }

    _onVisible() {
        this._client?.refresh();
        const gap = indexGapSeconds(this._settings.readActivity);
        this._runHistory({minGapMs: gap * 1000});
        this._render();
    }

    async _loadSummaries() {
        const [records, plan, history] = await Promise.all([
            loadRecords(this._dataDir, this._sources()),
            this._settings.cursor ? readCursorPlan(this._dataDir) : null,
            readHistoryState(this._dataDir),
        ]);
        this._history = history;
        this._cursorPlan = plan;
        // Before the first read of the history an empty summary means nothing yet
        if (records.length || history.claude.ms)
            this._records = records;
        this._render();
    }

    /**
     * Reads the history in a worker thread, at most one at a time. A rebuild asked for while
     * one runs waits for it to end.
     */
    _runHistory({minGapMs = 0, rebuild = false} = {}) {
        if (this._indexing) {
            this._rebuildPending ||= rebuild;
            return;
        }
        this._indexing = true;
        if (rebuild) {
            this._records = null;
            this._render();
        }
        const worker = new Worker(path.join(__dirname, 'worker.cjs'), {workerData: {
            claudeDir: claudeDir(this._settings.claudeDir),
            cursorUserDir: cursorUserDir(),
            dataDir: this._dataDir,
            sources: this._sources(),
            keepDays: this._settings.keepDays,
            minGapMs,
            rebuild,
        }});
        const done = async () => {
            this._indexing = false;
            if (this._disposed)
                return;
            await this._loadSummaries();
            if (this._rebuildPending) {
                this._rebuildPending = false;
                this._runHistory({rebuild: true});
            }
        };
        worker.once('message', message => {
            if (!message.ok)
                console.warn('Claudometer: Cannot read the history:', message.error);
        });
        worker.once('error', e => console.warn('Claudometer: The history worker failed:', e));
        worker.once('exit', done);
        this._worker = worker;
    }

    _render() {
        if (this._disposed)
            return;
        const settings = this._settings;
        const now = Date.now();
        const clock24 = use24h();
        const rows = limitRows(this._snapshot, this._cursorPlan,
            {modelLimits: settings.modelLimits, resetStyle: settings.resetStyle, use24h: clock24,
                nowMs: now});
        const status = statusText(this._snapshot, now, clock24);
        this._statusBar.update({snapshot: this._snapshot, cursorPlan: this._cursorPlan, rows,
            status, settings});
        if (this._provider.visible)
            this._provider.post(this._viewState(rows, status, now));
    }

    _viewState(rows, status, now) {
        const settings = this._settings;
        const {state, detail, data} = this._snapshot;
        const source = settings.cursor ? this._ui.source : 'claude';
        const activityRange = this._ui.activityRange ?? settings.activityRange;
        const listsRange = this._ui.listsRange ?? settings.listsRange;
        // Only Cursor's events have a cost, so the switch to it only exists on that source
        const unit = source === 'cursor' && this._ui.measure === 'cost' ? 'cost' : 'tokens';
        let views = null;
        if (this._records) {
            const records = chosenRecords(this._records, source, {
                count: unit === 'cost' ? 'cost' : settings.count,
                hiddenProjects: settings.hiddenProjects,
            });
            views = {
                projects: projectsView(records, {range: listsRange,
                    projectNames: settings.projectNames, home: os.homedir(), unit, nowMs: now}),
                models: modelsView(records, {range: listsRange, unit, nowMs: now}),
                activity: activityView(records, {range: activityRange, unit, nowMs: now}),
            };
        }
        const tabs = ['Limits', ...settings.tabs.filter(tab => tab !== 'Limits')];
        return {
            tabs,
            tab: tabs.includes(this._ui.tab) ? this._ui.tab : 'Limits',
            sources: settings.cursor ? ['all', 'claude', 'cursor'] : null,
            source,
            measures: source === 'cursor' ? ['tokens', 'cost'] : null,
            measure: unit,
            activityRange,
            listsRange,
            limits: {
                rows,
                stale: state !== State.FRESH,
                screen: rows.length ? null : limitsScreen(state, detail, Boolean(data)),
            },
            views,
            noProject: NO_PROJECT,
            status,
            cursorNote: this._cursorNote(),
        };
    }

    _cursorNote() {
        const cursor = this._history?.cursor;
        if (!this._settings.cursor || !cursor?.state)
            return null;
        return {
            [CursorState.NO_LOGIN]: 'Cursor: not signed in. Sign in to Cursor to add its usage.',
            [CursorState.OFFLINE]: 'Cursor: offline, showing the last values.',
            [CursorState.UNAVAILABLE]: `Cursor: unavailable (${cursor.detail}).`,
            [CursorState.FAILED]: `Cursor: ${cursor.detail}. Trying again soon.`,
        }[cursor.state] ?? null;
    }

    _onMessage(message) {
        if (message?.type === 'select') {
            const {key, value} = message;
            const allowed = {
                tab: ['Limits', 'Projects', 'Activity', 'Models'],
                source: ['all', 'claude', 'cursor'],
                measure: ['tokens', 'cost'],
                activityRange: RANGES.activity,
                listsRange: RANGES.lists,
            }[key];
            if (!allowed?.includes(value))
                return;
            this._ui = {...this._ui, [key]: value};
            this._context.globalState.update(UI_KEY, this._ui);
            this._render();
        } else if (message?.type === 'command') {
            const allowed = ['openSettings', 'refresh', 'exportCsv', 'enableCursor'];
            if (allowed.includes(message.command))
                vscode.commands.executeCommand(`claudometer.${message.command}`);
        }
    }

    async _exportCsv() {
        const target = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(os.homedir(), EXPORT_FILE_NAME)),
            filters: {CSV: ['csv']},
        });
        if (!target)
            return;
        const source = this._settings.cursor ? this._ui.source : 'claude';
        const records = await loadRecords(this._dataDir, this._sources());
        const picked = source === 'all' ? records : records.filter(r => r.source === source);
        await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(exportCsv(picked)));
        vscode.window.showInformationMessage(`Claudometer: saved ${target.fsPath}`);
    }

    async _installHook() {
        const installed = await isHookInstalled(cursorHomeDir());
        const choice = await vscode.window.showInformationMessage(
            'Claudometer can add a hook to ~/.cursor/hooks.json that notes the folder of each ' +
            'Cursor CLI chat, so its tokens land in the right project. Chats in the editor ' +
            'need no hook.', {modal: true}, installed ? 'Update the hook' : 'Add the hook');
        if (!choice)
            return;
        try {
            await installHook(cursorHomeDir(), this._dataDir);
            vscode.window.showInformationMessage('Claudometer: the Cursor hook is in place.');
        } catch (e) {
            vscode.window.showErrorMessage(`Claudometer: ${e.message}`);
        }
    }

    // In Cursor, offer the Cursor source once; it stays off until the user turns it on
    async _askAboutCursor() {
        const state = this._context.globalState;
        if (this._settings.cursor || state.get(CURSOR_ASKED_KEY) ||
            !vscode.env.appName.toLowerCase().includes('cursor'))
            return;
        await state.update(CURSOR_ASKED_KEY, true);
        const choice = await vscode.window.showInformationMessage(
            'Claudometer can also show Cursor\'s usage, every model, per project. It reads ' +
            'Cursor\'s login on this computer and sends it only to cursor.com.',
            'Add Cursor usage', 'Not now');
        if (choice === 'Add Cursor usage')
            await updateSetting('cursor.enabled', true);
    }

    dispose() {
        this._disposed = true;
        clearInterval(this._tickId);
        this._client?.dispose();
        this._worker?.terminate();
        this._statusBar.dispose();
    }
}

export function activate(context) {
    context.subscriptions.push(new Controller(context));
}

export function deactivate() {}
