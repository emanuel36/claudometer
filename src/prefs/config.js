// Pure helpers for the preferences; no gi:// imports so gjs tests can load it.

export const REFRESH_CHOICES = [
    [60, '1 min'], [300, '5 min'], [900, '15 min'], [1800, '30 min'], [3600, '1 h'],
];

export const UNIT_DAYS = {days: 1, weeks: 7, months: 30, years: 365};

const INDEX_GAPS = {'every-5': 300, 'every-15': 900, 'on-open': 0};

/**
 * Folder holding Claude Code's data.
 *
 * Args:
 *     value: The folder setting; blank means automatic.
 *     envDir: Value of CLAUDE_CONFIG_DIR, or null.
 *     home: The home directory.
 *
 * Returns:
 *     The setting, else the environment folder, else `<home>/.claude`; a leading `~` becomes
 *     the home directory and trailing slashes or backslashes are dropped.
 */
export function resolveClaudeDir(value, envDir, home) {
    let dir = value.trim() || (envDir ?? '').trim() || `${home}/.claude`;
    if (dir === '~' || dir.startsWith('~/') || dir.startsWith('~\\'))
        dir = home + dir.slice(1);
    return dir.replace(/[\\/]+$/, '') || '/';
}

/**
 * Minimum seconds between background reads of the activity logs.
 *
 * Args:
 *     readActivity: `every-5`, `every-15` or `on-open`.
 */
export function indexGapSeconds(readActivity) {
    return INDEX_GAPS[readActivity] ?? 0;
}

/** Returns: The days to keep: 0 (forever) or `amount` of `unit` (a key of `UNIT_DAYS`). */
export function keepDays(forever, amount, unit) {
    return forever ? 0 : amount * UNIT_DAYS[unit];
}

/**
 * Returns:
 *     `{forever, amount, unit}` for a number of days: 0 is forever (with 6 months ready to
 *     pick), else the largest unit that divides it evenly.
 */
export function keepFields(days) {
    if (days === 0)
        return {forever: true, amount: 6, unit: 'months'};
    const unit = ['years', 'months', 'weeks', 'days'].find(name => days % UNIT_DAYS[name] === 0);
    return {forever: false, amount: days / UNIT_DAYS[unit], unit};
}
