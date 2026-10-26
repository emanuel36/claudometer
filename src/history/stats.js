// Pure aggregations for the Days and Projects tabs. No shell imports, so they can be checked
// under plain gjs (see tests/stats.test.js). Records come from transcripts.js; days and hours are in
// the local time zone, and every amount is output tokens unless noted.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov',
    'Dec'];
export const FAMILY_NAMES = {
    opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable', other: 'Other',
};
const NAMED_FAMILIES = ['opus', 'sonnet', 'haiku', 'fable'];

export function modelFamily(modelId) {
    return NAMED_FAMILIES.find(family => modelId.includes(family)) ?? 'other';
}

const MODEL_WORDS = {gpt: 'GPT', xhigh: 'XHigh', default: 'Auto'};

/**
 * Readable name for a model id, from Claude Code or Cursor.
 *
 * Returns:
 *     `claude-opus-5-5` gives "Opus 5.5", `claude-haiku-4-5-20251001` "Haiku 4.5",
 *     `claude-4.5-sonnet-thinking` "Sonnet 4.5 Thinking", `gpt-5.6` "GPT-5.6" and
 *     `grok-4.7-xhigh` "Grok 4.7 XHigh"; a family name such as `opus` gives "Opus".
 */
export function modelLabel(modelId) {
    const parts = [];
    for (const part of modelId.toLowerCase().replace(/^claude-/, '').replace(/-\d{8}$/, '')
        .split('-').filter(Boolean)) {
        const last = parts[parts.length - 1];
        if (/^\d+$/.test(part) && /^\d+(\.\d+)*$/.test(last ?? ''))
            parts[parts.length - 1] = `${last}.${part}`;
        else
            parts.push(part);
    }
    if (parts.length === 0)
        return modelId;
    if (parts.length > 1 && /^\d/.test(parts[0]) && NAMED_FAMILIES.includes(parts[1]))
        parts.splice(0, 2, parts[1], parts[0]);
    const words = parts.map(word => MODEL_WORDS[word] ?? word[0].toUpperCase() + word.slice(1));
    if (parts[0] === 'gpt' && /^\d/.test(parts[1] ?? ''))
        words.splice(0, 2, `GPT-${parts[1]}`);
    return words.join(' ');
}

/**
 * Args:
 *     nowMs: Current time.
 *     days: How many days the range covers, today included.
 *
 * Returns:
 *     Local midnight of the first day of the range.
 */
export function rangeStart(nowMs, days) {
    const now = new Date(nowMs);
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)).getTime();
}

function inRange(records, fromMs, toMs) {
    return [...records].filter(r => r.t >= fromMs && r.t <= toMs);
}

// Spread records over periods that start at `starts` (ascending); the last runs to `nowMs`
function fillPeriods(records, starts, label, nowMs) {
    const periods = starts.map(startMs => ({startMs, label: label(new Date(startMs)),
        byFamily: {}, total: 0}));
    for (const record of inRange(records, starts[0], nowMs)) {
        let i = periods.length - 1;
        while (periods[i].startMs > record.t)
            i--;
        const family = modelFamily(record.model);
        periods[i].byFamily[family] = (periods[i].byFamily[family] ?? 0) + record.out;
        periods[i].total += record.out;
    }
    return periods;
}

const dayLabel = date => `${MONTHS[date.getMonth()]} ${date.getDate()}`;
const monthLabel = date => `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;

// Local midnights, `step` days apart, starting at `fromMs`
function dayStarts(fromMs, count, step = 1) {
    const first = new Date(fromMs);
    return Array.from({length: count}, (_, i) =>
        new Date(first.getFullYear(), first.getMonth(), first.getDate() + i * step).getTime());
}

/**
 * Returns:
 *     One `{startMs, label, byFamily, total}` per day, oldest first, `days` entries even when
 *     a day has no records.
 */
export function dayStats(records, days, nowMs) {
    return fillPeriods(records, dayStarts(rangeStart(nowMs, days), days), dayLabel, nowMs);
}

const RANGE_DAYS = {'today': 1, '7d': 7, '30d': 30, '6m': 182};

/**
 * Args:
 *     range: 'today', '7d', '30d', '6m' (26 weeks) or 'all'.
 *     nowMs: Current time.
 *     records: Records, used only by 'all'.
 *
 * Returns:
 *     Start of the range: local midnight of its first day, or for 'all' the time of the
 *     oldest record (now when there is none).
 */
export function rangeFrom(range, nowMs, records) {
    if (range !== 'all')
        return rangeStart(nowMs, RANGE_DAYS[range]);
    let first = nowMs;
    for (const record of records)
        first = Math.min(first, record.t);
    return first;
}

/**
 * Bars for the Days tab: one per day for '7d' and '30d', one per week for '6m' (26 weeks, the
 * last one ending today) and one per calendar month for 'all', from the oldest record's month.
 *
 * Returns:
 *     `{startMs, label, byFamily, total}` per bar, oldest first. Labels: "Oct 24" for days and
 *     weeks (the week's first day), "Oct 2026" for months.
 */
export function periodStats(records, range, nowMs) {
    records = [...records];
    if (range === '7d' || range === '30d')
        return dayStats(records, RANGE_DAYS[range], nowMs);
    if (range === '6m')
        return fillPeriods(records, dayStarts(rangeStart(nowMs, 182), 26, 7), dayLabel, nowMs);

    const first = new Date(rangeFrom('all', nowMs, records));
    const starts = [];
    for (let month = new Date(first.getFullYear(), first.getMonth(), 1); month <= nowMs;
        month = new Date(month.getFullYear(), month.getMonth() + 1, 1))
        starts.push(month.getTime());
    return fillPeriods(records, starts, monthLabel, nowMs);
}

/**
 * Sum records per local hour, project, model family and kind (subagent or not). The result has
 * the record shape, so every function here takes it in place of the records, with far fewer
 * entries; `model` holds the family and `branch` is empty.
 *
 * Args:
 *     records: Records from transcripts.js.
 *     options: `keepModel` sums per model id instead of per family.
 *
 * Returns:
 *     The buckets, in no particular order.
 */
export function bucketRecords(records, {keepModel = false} = {}) {
    const buckets = new Map();
    for (const record of records) {
        const date = new Date(record.t);
        const t = new Date(date.getFullYear(), date.getMonth(), date.getDate(),
            date.getHours()).getTime();
        const model = keepModel ? record.model : modelFamily(record.model);
        const id = `${t}|${record.cwd}|${model}|${record.sidechain}`;
        const bucket = buckets.get(id) ?? {id, t, model, out: 0, input: 0, cacheRead: 0,
            cacheWrite: 0, cwd: record.cwd, branch: '', sidechain: record.sidechain};
        bucket.out += record.out;
        bucket.input += record.input;
        bucket.cacheRead += record.cacheRead;
        bucket.cacheWrite += record.cacheWrite;
        if (record.cents > 0)
            bucket.cents = (bucket.cents ?? 0) + record.cents;
        buckets.set(id, bucket);
    }
    return [...buckets.values()];
}

/** Returns: Output tokens by local hour of day, 24 entries. */
export function hourStats(records, fromMs, toMs) {
    const hours = new Array(24).fill(0);
    for (const record of inRange(records, fromMs, toMs))
        hours[new Date(record.t).getHours()] += record.out;
    return hours;
}

/**
 * Returns:
 *     `[{family, out}]` with the named families by output, largest first, then `other` last.
 */
export function modelTotals(records, fromMs, toMs) {
    const totals = {};
    for (const record of inRange(records, fromMs, toMs)) {
        const family = modelFamily(record.model);
        totals[family] = (totals[family] ?? 0) + record.out;
    }
    const named = NAMED_FAMILIES.filter(family => totals[family])
        .map(family => ({family, out: totals[family]}))
        .sort((a, b) => b.out - a.out);
    return totals.other ? [...named, {family: 'other', out: totals.other}] : named;
}

/**
 * Returns:
 *     `[{model, label, out}]` per model id, largest first. With records bucketed per family
 *     the ids are the families.
 */
export function modelIdTotals(records, fromMs, toMs) {
    const totals = new Map();
    for (const record of inRange(records, fromMs, toMs))
        totals.set(record.model, (totals.get(record.model) ?? 0) + record.out);
    return [...totals].map(([model, out]) => ({model, label: modelLabel(model), out}))
        .sort((a, b) => b.out - a.out);
}

// Folders come from Linux, macOS and Windows, so both separators split them
const SEPARATORS = /[\\/]/;

function lastComponent(path) {
    return path.split(SEPARATORS).filter(Boolean).pop() ?? path;
}

function parentComponent(path) {
    return lastComponent(path.split(SEPARATORS).slice(0, -1).join('/'));
}

// Projects in the range, largest first, each with its output per model id
function rankProjects(records, fromMs, toMs) {
    const projects = new Map();
    let total = 0;
    for (const record of inRange(records, fromMs, toMs)) {
        const project = projects.get(record.cwd) ?? {cwd: record.cwd, out: 0, models: new Map()};
        project.out += record.out;
        project.models.set(record.model, (project.models.get(record.model) ?? 0) + record.out);
        projects.set(record.cwd, project);
        total += record.out;
    }
    return {total, ranked: [...projects.values()].sort((a, b) => b.out - a.out)};
}

function projectLabeler(ranked, names, home) {
    if (names === 'path') {
        return cwd => home && (cwd === home || cwd.startsWith(`${home}/`) ||
            cwd.startsWith(`${home}\\`)) ? `~${cwd.slice(home.length)}` : cwd;
    }
    const nameCount = {};
    for (const project of ranked) {
        const name = lastComponent(project.cwd);
        nameCount[name] = (nameCount[name] ?? 0) + 1;
    }
    return cwd => {
        const name = lastComponent(cwd);
        return nameCount[name] > 1 ? `${name} (${parentComponent(cwd)})` : name;
    };
}

/**
 * Projects are folders (`cwd`), labeled by their last component; when two share that name the
 * label adds the parent folder. With `names = 'path'` the label is the full folder, with `home`
 * shown as `~`.
 *
 * Returns:
 *     `{total, rows: [{label, out, share}], other: {out, share} | null}`: the `top` projects
 *     by output, and the rest summed.
 */
export function projectStats(records, fromMs, toMs, top = 5, names = 'folder', home = '') {
    const {total, ranked} = rankProjects(records, fromMs, toMs);
    const label = projectLabeler(ranked, names, home);
    const rows = ranked.slice(0, top).map(project => ({
        label: label(project.cwd),
        out: project.out,
        share: project.out / total,
    }));
    const rest = ranked.slice(top).reduce((sum, project) => sum + project.out, 0);
    return {total, rows, other: rest > 0 ? {out: rest, share: rest / total} : null};
}

function modelShares(models, out) {
    return [...models].map(([model, amount]) => ({
        model, label: modelLabel(model), out: amount, share: amount / out,
    })).sort((a, b) => b.out - a.out);
}

/**
 * Like `projectStats`, with each project split by model.
 *
 * Returns:
 *     `{total, rows: [{cwd, label, out, share, models}], other: {out, share, models} | null}`,
 *     where `models` is `[{model, label, out, share}]` largest first, `share` being of the
 *     project.
 */
export function projectModelStats(records, fromMs, toMs, top = 5, names = 'folder', home = '') {
    const {total, ranked} = rankProjects(records, fromMs, toMs);
    const label = projectLabeler(ranked, names, home);
    const rows = ranked.slice(0, top).map(project => ({
        cwd: project.cwd,
        label: label(project.cwd),
        out: project.out,
        share: project.out / total,
        models: modelShares(project.models, project.out),
    }));
    const rest = new Map();
    let restOut = 0;
    for (const project of ranked.slice(top)) {
        restOut += project.out;
        for (const [model, amount] of project.models)
            rest.set(model, (rest.get(model) ?? 0) + amount);
    }
    return {
        total,
        rows,
        other: restOut > 0
            ? {out: restOut, share: restOut / total, models: modelShares(rest, restOut)} : null,
    };
}

/**
 * Returns:
 *     The record's amount for what is counted: `output`, `output-input` (output + input),
 *     `all` (also both cache kinds) or `cost` (what the tokens cost, in cents; only Cursor's
 *     events have one).
 */
export function countAmount(record, count) {
    if (count === 'cost')
        return record.cents ?? 0;
    if (count === 'output-input')
        return record.out + record.input;
    if (count === 'all')
        return record.out + record.input + record.cacheRead + record.cacheWrite;
    return record.out;
}

/**
 * Drops hidden projects (by last folder of `cwd`) and sets `out` to the counted amount. With
 * `cost`, records that cost nothing are dropped too, so they don't fill the lists with zeros.
 *
 * Args:
 *     records: Records from transcripts.js; they are not changed.
 *     options: `{count: 'output' | 'output-input' | 'all' | 'cost', hidden: string[]}`.
 */
export function selectRecords(records, {count, hidden}) {
    const picked = records.filter(record => !hidden.includes(lastComponent(record.cwd)))
        .map(record => ({...record, out: countAmount(record, count)}));
    return count === 'cost' ? picked.filter(record => record.out > 0) : picked;
}

/**
 * Returns:
 *     The header above a table: `TODAY`, `LAST 7 DAYS`, `LAST 30 DAYS`, `LAST 6 MONTHS` or,
 *     for 'all', `SINCE OCT 2025` from `fromMs`.
 */
export function rangeHeader(range, fromMs) {
    if (range === 'all') {
        const from = new Date(fromMs);
        return `SINCE ${MONTHS[from.getMonth()].toUpperCase()} ${from.getFullYear()}`;
    }
    return {'today': 'TODAY', '7d': 'LAST 7 DAYS', '30d': 'LAST 30 DAYS',
        '6m': 'LAST 6 MONTHS'}[range];
}

/** Returns: the comma separated names as a list: trimmed, no empties, no repeats. */
export function parseHiddenProjects(text) {
    const names = text.split(',').map(name => name.trim()).filter(name => name !== '');
    return [...new Set(names)];
}

/** Returns: `980`, `502K` or `1.2M`. */
export function formatTokens(n) {
    if (n >= 1000000 || Math.round(n / 1000) >= 1000)
        return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000)
        return `${Math.round(n / 1000)}K`;
    return String(n);
}

/**
 * Args:
 *     cents: An amount in US cents.
 *
 * Returns:
 *     `$0.42`, `$12.40`, `$432`, `$1.2K` or `$12K`: cents below $100, whole dollars below
 *     $1,000, then thousands.
 */
export function formatCost(cents) {
    const dollars = cents / 100;
    if (dollars >= 10000)
        return `$${Math.round(dollars / 1000)}K`;
    if (dollars >= 1000 || Math.round(dollars) >= 1000)
        return `$${(dollars / 1000).toFixed(1)}K`;
    if (dollars >= 100)
        return `$${Math.round(dollars)}`;
    return `$${dollars.toFixed(2)}`;
}
