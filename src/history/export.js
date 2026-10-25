// Pure CSV export of the activity records. No shell imports, so it can be checked under plain
// gjs (see tests/export.test.js).
import {FAMILY_NAMES, modelFamily} from './stats.js';

export const EXPORT_FILE_NAME = 'claudometer-activity.csv';

const HEADER = 'date,project,model,output,input,cache_read,cache_write';

const pad = n => String(n).padStart(2, '0');

const localDay = t => {
    const date = new Date(t);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const field = value => {
    const text = String(value);
    return /[,"\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const compareRows = (a, b) =>
    a.date.localeCompare(b.date) || a.cwd.localeCompare(b.cwd) ||
    FAMILY_NAMES[a.family].localeCompare(FAMILY_NAMES[b.family]);

/**
 * Builds the activity CSV, one row per local day, project and model family.
 *
 * Args:
 *     records: Activity records with `t`, `model`, `cwd` and the output, input, cacheRead and
 *         cacheWrite amounts.
 *
 * Returns:
 *     CSV text with a header row, rows sorted by date, project and model, and a final newline.
 */
export function exportCsv(records) {
    const rows = new Map();
    for (const record of records) {
        const date = localDay(record.t);
        const family = modelFamily(record.model);
        const id = JSON.stringify([date, record.cwd, family]);
        const row = rows.get(id) ?? {date, cwd: record.cwd, family,
            out: 0, input: 0, cacheRead: 0, cacheWrite: 0};
        row.out += record.out;
        row.input += record.input;
        row.cacheRead += record.cacheRead;
        row.cacheWrite += record.cacheWrite;
        rows.set(id, row);
    }
    const lines = [...rows.values()].sort(compareRows).map(row => [
        row.date, field(row.cwd), FAMILY_NAMES[row.family],
        row.out, row.input, row.cacheRead, row.cacheWrite,
    ].join(','));
    return [HEADER, ...lines].join('\n') + '\n';
}
