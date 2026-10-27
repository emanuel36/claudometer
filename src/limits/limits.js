// Pure helpers for the limits table, built from the usage endpoint's response. No shell imports,
// so they can be checked under plain gjs (see tests/limits.test.js).

/**
 * Weekly limits that apply to a single model, such as Fable on Max plans.
 *
 * Args:
 *     data: The usage endpoint's response.
 *
 * Returns:
 *     `[{name, percent, resetsAt}]` in the response's order, for each `weekly_scoped` limit
 *     that names its model and has a percentage.
 */
export function scopedLimits(data) {
    if (!Array.isArray(data.limits))
        return [];
    return data.limits
        .filter(limit => limit?.kind === 'weekly_scoped' && limit.scope?.model?.display_name &&
            Number.isFinite(limit.percent))
        .map(limit => ({
            name: limit.scope.model.display_name,
            percent: limit.percent,
            resetsAt: limit.resets_at,
        }));
}
