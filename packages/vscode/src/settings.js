import * as vscode from 'vscode';

import {DEFAULTS} from '@claudometer/core';

export const SECTION = 'claudometer';

/** Returns: The extension's settings, in the shape the core takes. */
export function readSettings() {
    const config = vscode.workspace.getConfiguration(SECTION);
    const get = (key, fallback) => config.get(key, fallback);
    return {
        ...DEFAULTS,
        refreshInterval: get('refreshInterval', DEFAULTS.refreshInterval),
        panelLimit: get('statusBar.limit', DEFAULTS.panelLimit),
        panelColor: get('statusBar.color', DEFAULTS.panelColor),
        colorScale: get('statusBar.colorScale', DEFAULTS.colorScale),
        showIcon: get('statusBar.showIcon', DEFAULTS.showIcon),
        alignment: get('statusBar.alignment', 'right'),
        tabs: get('tabs', ['Projects', 'Activity', 'Models']),
        modelLimits: get('modelLimits', DEFAULTS.modelLimits),
        resetStyle: get('resetStyle', DEFAULTS.resetStyle),
        count: get('count', DEFAULTS.count),
        activityRange: get('activityRange', DEFAULTS.activityRange),
        listsRange: get('listsRange', DEFAULTS.listsRange),
        projectNames: get('projectNames', DEFAULTS.projectNames),
        hiddenProjects: get('hiddenProjects', []).map(name => name.trim()).filter(Boolean),
        readActivity: get('readActivity', DEFAULTS.readActivity),
        claudeDir: get('claudeDir', ''),
        keepDays: get('keepDays', 0),
        cursor: get('cursor.enabled', false),
    };
}

export function updateSetting(key, value) {
    return vscode.workspace.getConfiguration(SECTION).update(key, value,
        vscode.ConfigurationTarget.Global);
}

/** Returns: Whether the system clock shows 24 hours, as the reset times should. */
export function use24h() {
    const cycle = new Intl.DateTimeFormat(undefined, {hour: 'numeric'}).resolvedOptions()
        .hourCycle;
    return cycle !== 'h12' && cycle !== 'h11';
}
