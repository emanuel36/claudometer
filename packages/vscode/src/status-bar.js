import * as vscode from 'vscode';

import {State, barValues, cursorPlanUsage, usageColor} from '@claudometer/core';

// Faded like the GNOME indicator while values are outdated
const STALE_ALPHA = '80';

function escapeCell(text) {
    return String(text).replace(/[|\\`*_[\]<>]/g, '\\$&');
}

/**
 * The status bar item: the chosen limits, like the GNOME top bar, and a tooltip with every
 * limit.
 */
export class StatusBar {
    constructor(alignment) {
        this._create(alignment);
    }

    _create(alignment) {
        this._alignment = alignment;
        this._item = vscode.window.createStatusBarItem('claudometer.usage',
            alignment === 'left' ? vscode.StatusBarAlignment.Left
                : vscode.StatusBarAlignment.Right, 100);
        this._item.name = 'Claudometer';
        this._item.command = 'claudometer.show';
        this._item.text = '$(sparkle) …';
        this._item.show();
    }

    /**
     * Args:
     *     state: `{snapshot, cursorPlan, rows, status, settings}`.
     */
    update({snapshot, cursorPlan, rows, status, settings}) {
        if (settings.alignment !== this._alignment) {
            this._item.dispose();
            this._create(settings.alignment);
        }
        const stale = snapshot.state !== State.FRESH;
        let values = barValues(snapshot, settings.panelLimit);
        let label = values.map(v => `${Math.round(v)}%`).join(' · ');
        // Without Claude Code values, the Cursor plan stands in
        const cursor = cursorPlanUsage(cursorPlan);
        const standIn = !values.length && cursor;
        if (standIn) {
            values = [cursor.percent];
            label = `Cursor ${Math.round(cursor.percent)}%`;
        }
        if (!label)
            label = snapshot.state === State.FRESH ? '…' : '—';
        this._item.text = `${settings.showIcon ? '$(sparkle) ' : ''}${label}`;

        // One color for the item, so with both limits it follows the higher one
        let color = values.length && settings.panelColor !== 'white'
            ? usageColor(Math.max(...values), settings.panelColor, settings.colorScale)
            : undefined;
        if (color && stale && !standIn)
            color += STALE_ALPHA;
        this._item.color = color;

        const tooltip = new vscode.MarkdownString(undefined, true);
        tooltip.appendMarkdown('**Claudometer**\n\n');
        if (rows.length) {
            tooltip.appendMarkdown('| Limit | Used | Left |\n|:--|--:|--:|\n');
            for (const row of rows) {
                tooltip.appendMarkdown(`| ${escapeCell(row.name)} | ${Math.round(row.percent)}% | ${
                    escapeCell(row.left)} |\n`);
            }
            tooltip.appendMarkdown('\n');
        }
        tooltip.appendMarkdown(`${escapeCell(status)}\n\nClick to open the usage panel.`);
        this._item.tooltip = tooltip;
    }

    dispose() {
        this._item.dispose();
    }
}
