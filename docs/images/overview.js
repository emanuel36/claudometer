// Builds overview.svg, the README image, from the four tab mockups.
// Run with: gjs -m docs/images/overview.js
import GLib from 'gi://GLib';

import {usageColor} from '../../src/topbar/panel.js';

const ROOT = GLib.path_get_dirname(GLib.path_get_dirname(GLib.path_get_dirname(
    GLib.filename_from_uri(import.meta.url)[0])));
const FONT = "Ubuntu, Cantarell, 'Noto Sans', 'Segoe UI', sans-serif";
const WIDTH = 292;  // Every tab mockup has this width.
const GAP = 12;
const MARGIN = 20;
const SCALE = 1.3;  // Of the top bar piece.
const VALUE = 42;  // The 5-hour limit, as in limits.svg.

const decoder = new TextDecoder();
const read = path => decoder.decode(GLib.file_get_contents(`${ROOT}/${path}`)[1]);
const inner = svg => svg.slice(svg.indexOf('>') + 1, svg.lastIndexOf('</svg>'));

const tabs = {};
for (const key of ['limits', 'projects', 'activity', 'models']) {
    const svg = read(`docs/images/${key}.svg`);
    tabs[key] = {body: inner(svg), height: Number(svg.match(/height="(\d+)"/)[1])};
}

function tab(key, x, y) {
    const {body, height} = tabs[key];
    return `<svg x="${x}" y="${y}" width="${WIDTH}" height="${height}" ` +
        `viewBox="84 28 ${WIDTH} ${height}">${body}</svg>`;
}

/**
 * A magnified piece of the top bar: workspace dots, the clock and the indicator in its default
 * look (icon, then the 5-hour limit colored by usage).
 */
function topBar(x, y, height) {
    const s = SCALE;
    const cy = y + height / 2;
    const size = 12.5 * s;
    const icon = 16 * s;
    const label = `${VALUE}%`;
    const left = x + 248 - (icon + 5 * s + label.length * size * 0.58) / 2;
    const dots = [0, 1].map(i =>
        `<circle cx="${x + (49 + 11 * i) * s}" cy="${cy}" r="${3 * s}" ` +
        'fill="rgba(255,255,255,0.45)"/>').join('');
    return `<rect x="${x}" y="${y}" width="${WIDTH}" height="${height}" rx="12" fill="#000"/>` +
        `<rect x="${x + 10 * s}" y="${cy - 4 * s}" width="${30 * s}" height="${8 * s}" ` +
        `rx="${4 * s}" fill="#fff"/>${dots}` +
        `<text x="${x + WIDTH / 2 + 8 * s}" y="${cy + 4.3 * s}" font-size="${12 * s}" ` +
        'font-weight="700" fill="#fff" text-anchor="middle">26 Oct 09:41</text>' +
        `<svg x="${left}" y="${cy - icon / 2}" width="${icon}" height="${icon}" ` +
        `viewBox="0 0 16 16">${inner(read('icons/claudometer.svg'))}</svg>` +
        `<text x="${left + icon + 5 * s}" y="${cy + size * 0.36}" font-size="${size}" ` +
        `font-weight="700" fill="${usageColor(VALUE, 'usage', 'orange')}">${label}</text>`;
}

// Two columns that end together: the top bar piece fills what the left one lacks.
const right = tabs.models.height + GAP + tabs.activity.height;
const barHeight = right - (tabs.limits.height + GAP + tabs.projects.height) - GAP;
const x1 = MARGIN;
const x2 = MARGIN + WIDTH + GAP;
const y1 = MARGIN + barHeight + GAP;
const width = 2 * WIDTH + GAP + 2 * MARGIN;
const height = right + 2 * MARGIN;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}" font-family="${FONT}">\n` +
    '<defs><linearGradient id="wall" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#3a3f58"/><stop offset="1" stop-color="#1f2233"/>' +
    '</linearGradient></defs>\n' +
    `<rect width="${width}" height="${height}" rx="10" fill="url(#wall)"/>\n` +
    `${topBar(x1, MARGIN, barHeight)}\n` +
    `${tab('limits', x1, y1)}\n` +
    `${tab('projects', x1, y1 + tabs.limits.height + GAP)}\n` +
    `${tab('models', x2, MARGIN)}\n` +
    `${tab('activity', x2, MARGIN + tabs.models.height + GAP)}\n` +
    '</svg>\n';
GLib.file_set_contents(`${ROOT}/docs/images/overview.svg`, svg);
