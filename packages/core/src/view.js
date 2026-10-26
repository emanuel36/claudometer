// What the CLI and the editors show, built from the shared pure modules. Pure: no IO.
import {scopedLimits} from '../../../src/limits/limits.js';
import {limitTimeText, statusLine, State} from '../../../src/limits/status.js';
import {
    FAMILY_NAMES, formatCost, formatTokens, hourStats, modelFamily, modelIdTotals, periodStats,
    projectModelStats, rangeFrom, rangeHeader, selectRecords,
} from '../../../src/history/stats.js';
import {panelValues} from '../../../src/topbar/panel.js';

/** The settings both front ends take, with the GNOME extension's defaults. */
export const DEFAULTS = Object.freeze({
    refreshInterval: 300,
    panelLimit: 'five-hour',
    panelColor: 'usage',
    colorScale: 'orange',
    showIcon: true,
    modelLimits: false,
    resetStyle: 'countdown',
    count: 'output',
    activityRange: '7d',
    listsRange: '7d',
    projectNames: 'folder',
    hiddenProjects: [],
    readActivity: 'every-5',
    claudeDir: '',
    keepDays: 0,
    cursor: false,
});

export const NO_PROJECT = 'No project';
// Like the GNOME popup: the top four projects, then everything else
const TOP_PROJECTS = 4;

// Billing dates come as ISO text or as milliseconds in a string
function isoDate(value) {
    if (typeof value === 'number' || /^\d+$/.test(String(value ?? '')))
        return new Date(Number(value)).toISOString();
    return value ?? null;
}

/**
 * Returns:
 *     The Cursor plan's share used, `{percent, resetsAt}`, or null without a plan summary.
 */
export function cursorPlanUsage(plan) {
    const summary = plan?.summary;
    const usage = summary?.individualUsage?.plan;
    if (!usage)
        return null;
    let percent = usage.totalPercentUsed;
    if (!Number.isFinite(percent))
        percent = usage.limit > 0 ? usage.used / usage.limit * 100 : 0;
    return {percent, resetsAt: isoDate(summary.billingCycleEnd)};
}

/**
 * Returns:
 *     What Cursor billed beyond the plan this billing cycle, `{cents, resetsAt}` (`resetsAt`
 *     is the end of the cycle), or null when on-demand usage is off or there is no summary.
 */
export function cursorOnDemand(plan) {
    const usage = plan?.summary?.individualUsage?.onDemand;
    if (!usage?.enabled || !Number.isFinite(usage.used))
        return null;
    return {cents: usage.used, resetsAt: isoDate(plan.summary.billingCycleEnd)};
}

/**
 * Rows of the Limits table.
 *
 * Args:
 *     snapshot: `{state, data}` from the usage cache.
 *     cursorPlan: The saved Cursor plan, or null.
 *     options: `modelLimits`, `resetStyle`, `use24h` and `nowMs`.
 *
 * Returns:
 *     `[{name, percent, left, source}]`, `left` being the reset text. The `On demand` row has
 *     no limit: its `percent` is null and `text` holds the dollars billed this cycle.
 */
export function limitRows(snapshot, cursorPlan, {modelLimits, resetStyle, use24h = true,
    nowMs = Date.now()}) {
    const rows = [];
    const data = snapshot?.data;
    const stale = snapshot?.state !== State.FRESH;
    const time = resetsAt => limitTimeText(resetsAt, nowMs, {stale, style: resetStyle, use24h});
    if (data) {
        rows.push({name: '5-hour', percent: data.five_hour?.utilization ?? 0,
            left: time(data.five_hour?.resets_at), source: 'claude'});
        rows.push({name: 'Weekly', percent: data.seven_day?.utilization ?? 0,
            left: time(data.seven_day?.resets_at), source: 'claude'});
        if (modelLimits) {
            for (const limit of scopedLimits(data)) {
                rows.push({name: `${limit.name} weekly`, percent: limit.percent,
                    left: time(limit.resetsAt), source: 'claude'});
            }
        }
    }
    const cursor = cursorPlanUsage(cursorPlan);
    const cycleLeft = resetsAt => resetsAt ? limitTimeText(resetsAt, nowMs,
        {stale: false, style: resetStyle, use24h}) : '—';
    if (cursor) {
        rows.push({name: 'Cursor plan', percent: cursor.percent, left: cycleLeft(cursor.resetsAt),
            source: 'cursor'});
    }
    const onDemand = cursorOnDemand(cursorPlan);
    if (onDemand) {
        rows.push({name: 'On demand', percent: null, text: formatCost(onDemand.cents),
            left: cycleLeft(onDemand.resetsAt), source: 'cursor'});
    }
    return rows;
}

/** Returns: The status bar values, 5-hour first, as in the GNOME top bar. */
export function barValues(snapshot, panelLimit) {
    return snapshot?.data ? panelValues(snapshot.data, panelLimit) : [];
}

/** Returns: The footer line, e.g. "Updated 2 min ago". */
export function statusText(snapshot, nowMs = Date.now(), use24h = true) {
    return statusLine(snapshot.state, snapshot.detail, snapshot.lastSuccessMs, nowMs, use24h).text;
}

/**
 * Args:
 *     records: Records from `loadRecords`.
 *     source: `claude`, `cursor` or `all`.
 *     options: `count` and `hiddenProjects`. With `count: 'cost'` only Cursor's records are
 *         used whatever the source, as Claude Code's transcripts have no cost.
 */
export function chosenRecords(records, source, {count, hiddenProjects}) {
    const only = count === 'cost' ? 'cursor' : source;
    const picked = only === 'all' ? records : records.filter(r => r.source === only);
    return selectRecords(picked, {count, hidden: hiddenProjects});
}

const withShare = (rows, total) => rows.map(row => ({...row, share: total ? row.out / total : 0}));

/**
 * Every view says what its amounts are in `unit`: `tokens`, or `cost` (cents) when the records
 * were chosen with `count: 'cost'`; pass it as `unit`.
 *
 * Returns:
 *     `{header, unit, total, rows: [{cwd, label, out, share, models}], other}` for the Projects
 *     tab; every project lists the amount of each model it used.
 */
export function projectsView(records, {range, projectNames, home, unit = 'tokens',
    nowMs = Date.now()}) {
    const from = rangeFrom(range, nowMs, records);
    const stats = projectModelStats(records, from, nowMs, TOP_PROJECTS, projectNames, home);
    return {
        header: rangeHeader(range, from),
        unit,
        total: stats.total,
        rows: stats.rows.map(row => ({...row, label: row.cwd ? row.label : NO_PROJECT})),
        other: stats.other,
    };
}

/** Returns: `{header, unit, total, rows: [{model, label, family, out, share}]}` for Models. */
export function modelsView(records, {range, unit = 'tokens', nowMs = Date.now()}) {
    const from = rangeFrom(range, nowMs, records);
    const rows = modelIdTotals(records, from, nowMs)
        .map(row => ({...row, family: modelFamily(row.model)}));
    const total = rows.reduce((sum, row) => sum + row.out, 0);
    return {header: rangeHeader(range, from), unit, total, rows: withShare(rows, total)};
}

/**
 * Returns:
 *     `{header, unit, total, periods, hours, families}` for the Activity tab: bars per period
 *     split by family, the 24 hours of the day, and the families present, largest first.
 */
export function activityView(records, {range, unit = 'tokens', nowMs = Date.now()}) {
    const from = rangeFrom(range, nowMs, records);
    const periods = periodStats(records, range, nowMs);
    const hours = hourStats(records, from, nowMs);
    const byFamily = {};
    for (const period of periods) {
        for (const [family, out] of Object.entries(period.byFamily))
            byFamily[family] = (byFamily[family] ?? 0) + out;
    }
    const families = Object.entries(byFamily).sort((a, b) => b[1] - a[1])
        .map(([family, out]) => ({family, name: FAMILY_NAMES[family], out}));
    return {
        header: rangeHeader(range, from),
        unit,
        total: periods.reduce((sum, p) => sum + p.total, 0),
        periods, hours, families,
    };
}

/** Returns: An amount of a view as text: `1.2M` tokens, or `$12.40` for the `cost` unit. */
export function formatAmount(amount, unit) {
    return unit === 'cost' ? formatCost(amount) : formatTokens(amount);
}

export {formatCost, formatTokens};
