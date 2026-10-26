// Terminal output: plain text, with colors only on a terminal that wants them.
import {formatAmount, formatTokens, usageColor} from '@claudometer/core';

const ACCENT = '#d97757';
const METER_WIDTH = 10;
// Wide enough for `100%` and for dollars such as `$13.68`
const USED_WIDTH = 6;

export function colorsWanted(stream = process.stdout, env = process.env) {
    return Boolean(stream.isTTY) && !env.NO_COLOR && env.TERM !== 'dumb';
}

/** Returns: Functions that wrap text in ANSI colors, or leave it alone. */
export function painter(enabled) {
    const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(';');
    const wrap = (open, text) => enabled ? `\x1b[${open}m${text}\x1b[0m` : text;
    return {
        color: (hex, text) => wrap(`38;2;${rgb(hex)}`, text),
        dim: text => wrap('2', text),
        bold: text => wrap('1', text),
    };
}

const pad = (text, width) => text + ' '.repeat(Math.max(0, width - [...text].length));
const padStart = (text, width) => ' '.repeat(Math.max(0, width - [...text].length)) + text;
const percent = share => `${Math.round(share * 100)}%`;
// A view's amounts are tokens, or the cost of the tokens in dollars
const amountOf = (n, view) => formatAmount(n, view.unit);
const totalOf = view => `${amountOf(view.total, view)} ${view.unit === 'cost' ? 'token cost' : 'tokens'}`;

function meter(paint, share) {
    const filled = Math.round(Math.min(1, Math.max(0, share)) * METER_WIDTH);
    return paint.color(ACCENT, '█'.repeat(filled)) + paint.dim('░'.repeat(METER_WIDTH - filled));
}

/**
 * Args:
 *     rows: From `limitRows`.
 *     status: The footer line.
 *     options: `paint`, and `stale` to fade the values.
 */
export function renderLimits(rows, status, {paint, stale}) {
    const lines = [paint.bold('LIMITS')];
    if (rows.length === 0) {
        lines.push(paint.dim(status));
        return lines.join('\n');
    }
    const width = Math.max(...rows.map(r => r.name.length)) + 2;
    lines.push(paint.dim(`${pad('LIMIT', width)}${pad('', METER_WIDTH + 1)}${padStart('USED', USED_WIDTH)}  LEFT`));
    for (const row of rows) {
        // The on-demand row has dollars billed and no limit, so no meter
        const meterText = row.percent === null ? ' '.repeat(METER_WIDTH)
            : meter(paint, row.percent / 100);
        const value = padStart(row.percent === null ? row.text : `${Math.round(row.percent)}%`,
            USED_WIDTH);
        const line = `${pad(row.name, width)}${meterText} ${value}  ${row.left}`;
        lines.push(stale && row.source === 'claude' ? paint.dim(line) : line);
    }
    lines.push(paint.dim(status));
    return lines.join('\n');
}

/** Renders the Projects view, every project followed by its models. */
export function renderProjects(view, {paint}) {
    const lines = [paint.bold(`PROJECTS · ${view.header} · ${totalOf(view)}`)];
    if (view.total === 0)
        return [...lines, paint.dim('No activity yet')].join('\n');
    const rows = view.other ? [...view.rows, {label: 'Other', ...view.other}] : view.rows;
    const width = Math.max(18, ...rows.flatMap(r => [r.label.length,
        ...r.models.map(m => m.label.length + 2)])) + 2;
    for (const row of rows) {
        lines.push(`${paint.bold(pad(row.label, width))}${padStart(percent(row.share), 5)}  ${
            padStart(amountOf(row.out, view), 6)}`);
        for (const model of row.models) {
            lines.push(paint.dim(`  ${pad(model.label, width - 2)}${padStart(percent(model.share), 5)}  ${
                padStart(amountOf(model.out, view), 6)}`));
        }
    }
    return lines.join('\n');
}

export function renderModels(view, {paint}) {
    const lines = [paint.bold(`MODELS · ${view.header} · ${totalOf(view)}`)];
    if (view.total === 0)
        return [...lines, paint.dim('No activity yet')].join('\n');
    const width = Math.max(18, ...view.rows.map(r => r.label.length)) + 2;
    for (const row of view.rows) {
        lines.push(`${pad(row.label, width)}${meter(paint, row.share)} ${padStart(percent(row.share), 5)}  ${
            padStart(amountOf(row.out, view), 6)}`);
    }
    return lines.join('\n');
}

const SPARKS = ' ▁▂▃▄▅▆▇█';

function spark(values) {
    const max = Math.max(...values, 1);
    return values.map(v => SPARKS[Math.round(v / max * (SPARKS.length - 1))]).join('');
}

export function renderActivity(view, {paint}) {
    const lines = [paint.bold(`ACTIVITY · ${view.header} · ${totalOf(view)}`)];
    if (view.total === 0)
        return [...lines, paint.dim('No activity yet')].join('\n');
    const width = Math.max(...view.periods.map(p => p.label.length)) + 2;
    const max = Math.max(...view.periods.map(p => p.total), 1);
    for (const period of view.periods) {
        const bar = '█'.repeat(Math.round(period.total / max * 30));
        lines.push(`${pad(period.label, width)}${paint.color(ACCENT, bar)} ${
            paint.dim(amountOf(period.total, view))}`);
    }
    lines.push('', `${paint.dim('When you work  0h')} ${paint.color(ACCENT, spark(view.hours))} ${
        paint.dim('23h')}`);
    lines.push(paint.dim(view.families.map(f => `${f.name} ${amountOf(f.out, view)}`).join(' · ')));
    return lines.join('\n');
}

/**
 * The one-line status for Claude Code's status line.
 *
 * Args:
 *     values: `{five, week, fiveLeft, today}`; each may be missing.
 *     options: `paint`, `colorScale`, `stale`.
 */
export function renderStatusLine({five, week, fiveLeft, today}, {paint, colorScale, stale}) {
    const parts = [];
    const value = n => {
        const text = `${Math.round(n)}%`;
        return stale ? paint.dim(text) : paint.color(usageColor(n, 'usage', colorScale), text);
    };
    if (Number.isFinite(five))
        parts.push(`5h ${value(five)}${fiveLeft ? paint.dim(` ${fiveLeft}`) : ''}`);
    if (Number.isFinite(week))
        parts.push(`wk ${value(week)}`);
    if (today)
        parts.push(`today ${formatTokens(today)}`);
    return `${paint.color(ACCENT, '✻')} ${parts.length ? parts.join(paint.dim(' · ')) : '…'}`;
}
