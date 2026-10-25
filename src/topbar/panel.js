// Top bar values, colors and graphics. Pure: no gi:// imports, so it runs under plain gjs.

export const SCALES = {
    orange: ['#f6d2c4', '#d97757', '#a8381f'],
    'white-red': ['#ffffff', '#d97757', '#e5484d'],
    'blue-red': ['#78aeed', '#d97757', '#e5484d'],
};

const ORANGE = '#d97757';
const SEPARATOR_COLOR = '#999999';
const TRACK = [1, 1, 1, 0.22];
const ROUND_CAP = 1;  // Cairo.LineCap.ROUND

const clampPercent = p => Math.min(100, Math.max(0, Number.isFinite(p) ? p : 0));

/**
 * Converts '#rrggbb' to [r, g, b] with each channel in 0-1.
 * @param {string} hex Color as '#rrggbb'.
 * @returns {number[]} The three channels.
 */
export function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => c / 255);
}

function toHex(channels) {
    return `#${channels.map(c => c.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Color for a usage percentage.
 * @param {number} percent Usage, clamped to 0-100.
 * @param {string} color 'white', 'orange' or 'usage'.
 * @param {string} scale Key of SCALES, used when color is 'usage'.
 * @returns {string} Color as '#rrggbb'.
 */
export function usageColor(percent, color, scale) {
    if (color === 'white')
        return '#ffffff';
    if (color === 'orange')
        return ORANGE;
    const stops = (SCALES[scale] ?? SCALES.orange)
        .map(h => hexToRgb(h).map(c => Math.round(c * 255)));
    const p = clampPercent(percent);
    const [from, to, t] = p <= 50
        ? [stops[0], stops[1], p / 50]
        : [stops[1], stops[2], (p - 50) / 50];
    return toHex(from.map((c, i) => Math.round(c + (to[i] - c) * t)));
}

/**
 * Utilization values to show in the top bar.
 * @param {?object} data Usage response, or null.
 * @param {string} limit 'five-hour', 'weekly' or 'both'.
 * @returns {number[]} Percentages, 5-hour first; empty without data.
 */
export function panelValues(data, limit) {
    if (!data)
        return [];
    const five = data.five_hour?.utilization ?? 0;
    const week = data.seven_day?.utilization ?? 0;
    if (limit === 'five-hour')
        return [five];
    if (limit === 'weekly')
        return [week];
    return [five, week];
}

/**
 * Pango markup for the top bar label.
 * @param {number[]} values Percentages.
 * @param {?string[]} colors One color per value, or null for no coloring.
 * @returns {string} Markup such as '42% · 18%'.
 */
export function panelMarkup(values, colors) {
    const texts = values.map(v => `${Math.round(v)}%`);
    if (!colors)
        return texts.join(' · ');
    const sep = `<span foreground="${SEPARATOR_COLOR}"> · </span>`;
    return texts.map((t, i) => `<span foreground="${colors[i]}">${t}</span>`).join(sep);
}

/**
 * Size of the graphic.
 * @param {string} style 'percentage', 'bar' or 'ring'.
 * @param {number} count Number of values drawn.
 * @returns {number[]} [width, height]; [0, 0] when nothing is drawn.
 */
export function graphicSize(style, count) {
    if (style === 'bar')
        return [26, count > 1 ? 11 : 6];
    if (style === 'ring')
        return [16, 16];
    return [0, 0];
}

function roundedRect(cr, x, y, w, h) {
    const r = Math.min(h / 2, w / 2);
    cr.newSubPath();
    cr.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
    cr.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
    cr.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
    cr.arc(x + r, y + r, r, Math.PI, 1.5 * Math.PI);
    cr.closePath();
}

function drawBar(cr, y, h, value, color) {
    const width = 26;
    cr.setSourceRGBA(...TRACK);
    roundedRect(cr, 0, y, width, h);
    cr.fill();
    const filled = width * clampPercent(value) / 100;
    if (filled <= 0)
        return;
    cr.setSourceRGBA(...hexToRgb(color), 1);
    roundedRect(cr, 0, y, filled, h);
    cr.fill();
}

function drawRing(cr, radius, lineWidth, value, color) {
    const start = -Math.PI / 2;
    cr.setLineWidth(lineWidth);
    cr.setLineCap(ROUND_CAP);
    cr.setSourceRGBA(...TRACK);
    cr.newSubPath();
    cr.arc(8, 8, radius, 0, 2 * Math.PI);
    cr.stroke();
    const p = clampPercent(value);
    if (p <= 0)
        return;
    cr.setSourceRGBA(...hexToRgb(color), 1);
    cr.newSubPath();
    cr.arc(8, 8, radius, start, start + 2 * Math.PI * p / 100);
    cr.stroke();
}

/**
 * Draws the top bar graphic on a cairo context.
 * @param {object} cr Cairo context.
 * @param {string} style 'bar' or 'ring' ('percentage' draws nothing).
 * @param {number[]} values Percentages, 5-hour first.
 * @param {string[]} colors One '#rrggbb' per value.
 */
export function drawPanelGraphic(cr, style, values, colors) {
    const two = values.length > 1;
    if (style === 'bar') {
        if (two) {
            drawBar(cr, 0, 4, values[0], colors[0]);
            drawBar(cr, 7, 4, values[1], colors[1]);
        } else if (values.length) {
            drawBar(cr, 0, 6, values[0], colors[0]);
        }
    } else if (style === 'ring') {
        if (two) {
            drawRing(cr, 6.6, 1.8, values[0], colors[0]);
            drawRing(cr, 3.6, 1.8, values[1], colors[1]);
        } else if (values.length) {
            drawRing(cr, 6, 2.6, values[0], colors[0]);
        }
    }
}
