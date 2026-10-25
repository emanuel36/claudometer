import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {
    FAMILY_NAMES, formatTokens, hourStats, modelTotals, periodStats, projectStats, rangeFrom,
    rangeHeader,
} from '../history/stats.js';
import {SCREEN_STATES} from '../limits/status.js';
import {createStateBlock} from './widgets.js';

// Checked for color-blind separation on the popup's dark background (any two can be adjacent)
export const FAMILY_COLORS = {
    opus: [0.788, 0.522, 0],         // #c98500
    sonnet: [0.224, 0.529, 0.898],   // #3987e5
    haiku: [0, 0.514, 0],            // #008300
    fable: [0.835, 0.318, 0.506],    // #d55181
    other: [0.54, 0.54, 0.54],
};
// Amounts that are not about a model (projects, hours) stay neutral
const NEUTRAL = [1, 1, 1];
const DAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
// Switch label to range key (see stats.js `rangeFrom`)
const DAYS_RANGES = {'7d': '7d', '30d': '30d', '6m': '6m', 'All': 'all'};
const PROJECTS_RANGES = {'Today': 'today', '7d': '7d', '30d': '30d', 'All': 'all'};

function rangeLabel(ranges, key) {
    return Object.keys(ranges).find(label => ranges[label] === key);
}

const VIEW_WIDTH = 244;
// Top four projects in order, then everything else
const PROJECT_COLORS = ['#d97757', '#e59a80', '#f0bea9', '#9a9a9a'];
const TOP_PROJECTS = PROJECT_COLORS.length;
const OTHER_COLOR = '#4a4a4a';
const STACK_GAP = 2;
const STACK_RADIUS = 4;

/**
 * A row of tab buttons, each an icon over a short name, all the same width. The caller owns
 * what each tab shows.
 *
 * Args:
 *     tabs: `[{name, gicon}]`, in order.
 *     selected: The name of the tab shown first.
 *     onSelect: Called with the name of the clicked tab.
 *
 * Returns:
 *     `{actor, setSelected(name), setShown(names)}`: the widget, a way to mark another tab as
 *     selected, and a way to hide the tabs not listed.
 */
export function createTabBar(tabs, selected, onSelect) {
    const actor = new St.BoxLayout({style_class: 'cm-tabs', x_expand: true});
    const buttons = new Map();
    for (const {name, gicon} of tabs) {
        const content = new St.BoxLayout({vertical: true, x_align: Clutter.ActorAlign.CENTER});
        content.add_child(new St.Icon({
            gicon,
            icon_size: 16,
            style_class: 'cm-tab-icon',
            x_align: Clutter.ActorAlign.CENTER,
        }));
        content.add_child(new St.Label({text: name, style_class: 'cm-tab-label',
            x_align: Clutter.ActorAlign.CENTER}));
        const button = new St.Button({
            child: content,
            style_class: 'cm-tab',
            x_expand: true,
            can_focus: true,
            reactive: true,
            track_hover: true,
            accessible_name: name,
        });
        button.connect('clicked', () => onSelect(name));
        actor.add_child(button);
        buttons.set(name, button);
    }

    const setSelected = current => {
        for (const [name, button] of buttons) {
            if (name === current)
                button.add_style_class_name('cm-tab-selected');
            else
                button.remove_style_class_name('cm-tab-selected');
        }
    };
    setSelected(selected);

    const setShown = names => {
        for (const [name, button] of buttons)
            button.visible = names.includes(name);
    };
    return {actor, setSelected, setShown};
}

/**
 * A small segmented switch, such as "7 days | 14 days".
 *
 * Returns:
 *     `{actor, select(name)}`: the widget, and a way to mark a button without calling
 *     `onSelect`, which gets the clicked name.
 */
export function createSwitch(names, selected, onSelect) {
    const actor = new St.BoxLayout({style_class: 'cm-switch', x_expand: true});
    const buttons = new Map();
    const mark = current => {
        for (const [name, button] of buttons) {
            if (name === current)
                button.add_style_class_name('cm-switch-selected');
            else
                button.remove_style_class_name('cm-switch-selected');
        }
    };
    for (const name of names) {
        const button = new St.Button({
            label: name,
            style_class: 'cm-switch-button',
            x_expand: true,
            can_focus: true,
            reactive: true,
            track_hover: true,
        });
        button.connect('clicked', () => {
            mark(name);
            onSelect(name);
        });
        actor.add_child(button);
        buttons.set(name, button);
    }
    mark(selected);
    return {actor, select: mark};
}

export function legendRow(totals) {
    const row = new St.BoxLayout({style_class: 'cm-legend', vertical: false});
    for (const {family} of totals) {
        const [r, g, b] = FAMILY_COLORS[family].map(c => Math.round(c * 255));
        row.add_child(new St.Widget({
            style: `background-color: rgb(${r}, ${g}, ${b}); border-radius: 2px;`,
            width: 8,
            height: 8,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        row.add_child(new St.Label({
            text: FAMILY_NAMES[family],
            style_class: 'cm-sec',
        }));
    }
    return row;
}

/**
 * Stacked bars of output tokens per period, split by model family. Seven bars get a weekday
 * initial each; more get the first and last period's label. Draws only the baseline when every
 * period is empty.
 *
 * Args:
 *     cr: Cairo context.
 *     width: Drawing width.
 *     height: Drawing height.
 *     days: `periodStats` result.
 */
export function drawStackedBars(cr, width, height, days) {
    const labelHeight = 14;
    const plotH = height - labelHeight;
    const gap = days.length > 14 ? 1 : days.length > 7 ? 3 : 5;
    const barW = (width - gap * (days.length - 1)) / days.length;
    const max = Math.max(...days.map(d => d.total));
    cr.selectFontFace('sans-serif', 0, 0);
    cr.setFontSize(9);

    days.forEach((day, i) => {
        const x = i * (barW + gap);
        let y = plotH;
        if (max > 0) {
            for (const family of Object.keys(FAMILY_COLORS)) {
                const h = (day.byFamily[family] ?? 0) / max * plotH;
                if (h <= 0)
                    continue;
                y -= h;
                cr.setSourceRGBA(...FAMILY_COLORS[family], 1);
                cr.rectangle(x, y, barW, h);
                cr.fill();
            }
        }
        if (days.length <= 7) {
            const initial = DAY_INITIALS[new Date(day.startMs).getDay()];
            cr.setSourceRGBA(0.54, 0.54, 0.54, 1);
            cr.moveTo(x + barW / 2 - cr.textExtents(initial).width / 2, height - 2);
            cr.showText(initial);
        }
    });
    if (days.length > 7) {
        const last = days[days.length - 1].label;
        cr.setSourceRGBA(0.54, 0.54, 0.54, 1);
        cr.moveTo(0, height - 2);
        cr.showText(days[0].label);
        cr.moveTo(width - cr.textExtents(last).width, height - 2);
        cr.showText(last);
    }
    cr.setSourceRGBA(1, 1, 1, 0.12);
    cr.setLineWidth(1);
    cr.moveTo(0, plotH + 0.5);
    cr.lineTo(width, plotH + 0.5);
    cr.stroke();
}

// 24 cells, one per hour of the day, darker where more output tokens were produced
function drawHourStrip(cr, width, height, hours) {
    const cellW = (width - 23 * 2) / 24;
    const max = Math.max(...hours);
    hours.forEach((out, hour) => {
        cr.setSourceRGBA(...NEUTRAL, max > 0 ? 0.08 + 0.72 * out / max : 0.08);
        cr.rectangle(hour * (cellW + 2), 0, cellW, 16);
        cr.fill();
    });
    cr.selectFontFace('sans-serif', 0, 0);
    cr.setFontSize(9);
    cr.setSourceRGBA(0.54, 0.54, 0.54, 1);
    for (const hour of [0, 6, 12, 18]) {
        cr.moveTo(hour * (cellW + 2), height - 2);
        cr.showText(`${hour}h`);
    }
}

function createDrawing(height, draw) {
    const area = new St.DrawingArea({width: VIEW_WIDTH, height});
    area.connect('repaint', () => {
        const [width, h] = area.get_surface_size();
        const cr = area.get_context();
        draw(cr, width, h);
        cr.$dispose();
    });
    return area;
}

/**
 * The Activity tab: output tokens over time by model, and when in the day you work.
 *
 * Returns:
 *     `{actor, update(records, nowMs), setRange(range), setLoading(), setEmpty()}`. `update`
 *     also shows the empty state when the range has no output.
 */
export function createActivityView() {
    const state = {range: '7d', days: [], hours: new Array(24).fill(0)};
    const actor = new St.BoxLayout({vertical: true, x_expand: true, y_expand: true});
    let latest = {records: [], nowMs: Date.now()};
    let loaded = false;

    const stateBlock = createStateBlock();
    const content = new St.BoxLayout({vertical: true, x_expand: true, visible: false});
    const head = new St.BoxLayout({style_class: 'cm-act-head'});
    const rangeName = new St.Label({style_class: 'cm-hdr', x_expand: true,
        y_align: Clutter.ActorAlign.CENTER});
    const totalValue = new St.Label({style_class: 'cm-val', y_align: Clutter.ActorAlign.CENTER});
    const legend = new St.BoxLayout({vertical: true});
    const bars = createDrawing(90, (cr, w, h) => drawStackedBars(cr, w, h, state.days));
    const strip = createDrawing(30, (cr, w, h) => drawHourStrip(cr, w, h, state.hours));

    head.add_child(rangeName);
    head.add_child(totalValue);
    content.add_child(head);
    content.add_child(bars);
    content.add_child(legend);
    content.add_child(new St.Label({text: 'WHEN YOU WORK', style_class: 'cm-hdr cm-act-sec'}));
    content.add_child(strip);

    const show = screen => {
        stateBlock.show(screen);
        content.visible = false;
    };

    const render = () => {
        const {records, nowMs} = latest;
        const from = rangeFrom(state.range, nowMs, records);
        state.days = periodStats(records, state.range, nowMs);
        state.hours = hourStats(records, from, nowMs);
        const total = state.days.reduce((sum, day) => sum + day.total, 0);
        if (total === 0) {
            show(SCREEN_STATES.empty);
            return;
        }

        stateBlock.hide();
        content.visible = true;
        rangeName.set_text(rangeHeader(state.range, from));
        totalValue.set_text(formatTokens(total));
        legend.destroy_all_children();
        legend.add_child(legendRow(modelTotals(records, from, nowMs)));
        bars.queue_repaint();
        strip.queue_repaint();
    };

    const rangeSwitch = createSwitch(Object.keys(DAYS_RANGES), '7d', name => {
        state.range = DAYS_RANGES[name];
        if (loaded)
            render();
    });
    actor.add_child(rangeSwitch.actor);
    actor.add_child(stateBlock.actor);
    actor.add_child(content);
    show(SCREEN_STATES.loadingActivity);

    return {
        actor,
        update(records, nowMs) {
            latest = {records: [...records], nowMs};
            loaded = true;
            render();
        },
        setRange(range) {
            state.range = range;
            rangeSwitch.select(rangeLabel(DAYS_RANGES, range));
            if (loaded)
                render();
        },
        // Until the next update, a new range or option keeps the state
        setLoading() {
            loaded = false;
            show(SCREEN_STATES.loadingActivity);
        },
        setEmpty() {
            loaded = false;
            show(SCREEN_STATES.empty);
        },
    };
}

// Segment widths in whole pixels, proportional to the shares: at least 2px each, and together
// with the gaps `VIEW_WIDTH` wide (less only when the minimums leave no room)
function segmentWidths(shares) {
    const room = VIEW_WIDTH - STACK_GAP * (shares.length - 1);
    const widths = shares.map(share => Math.max(2, Math.round(share * room)));
    let excess = widths.reduce((sum, w) => sum + w, 0) - room;
    while (excess !== 0) {
        const widest = Math.max(...widths);
        if (excess > 0 && widest <= 2)
            break;
        widths[widths.indexOf(widest)] += excess > 0 ? -1 : 1;
        excess += excess > 0 ? -1 : 1;
    }
    return widths;
}

// One bar split by share, with rounded ends
function stackedBar(shares, colors) {
    const bar = new St.BoxLayout({style_class: 'cm-stack'});
    const widths = segmentWidths(shares);
    widths.forEach((width, i) => {
        const left = i === 0 ? Math.min(STACK_RADIUS, Math.floor(width / 2)) : 0;
        const right = i === widths.length - 1 ? Math.min(STACK_RADIUS, Math.floor(width / 2)) : 0;
        bar.add_child(new St.Widget({
            style: `background-color: ${colors[i]}; ` +
                `border-radius: ${left}px ${right}px ${right}px ${left}px;`,
            width,
            height: 8,
        }));
    });
    return bar;
}

function shareCell(text, styleClass) {
    return new St.Label({text, style_class: styleClass, y_align: Clutter.ActorAlign.CENTER});
}

function colorSquare(color) {
    return new St.Widget({
        style: `background-color: ${color}; border-radius: 2px;`,
        width: 8,
        height: 8,
        y_align: Clutter.ActorAlign.CENTER,
    });
}

/**
 * The table shared by Projects and Models: a bar split by share, column titles, then one row
 * per item with its color square, name, share and tokens.
 *
 * Args:
 *     title: The first column's title, such as `PROJECT`.
 *     rows: `[{label, out, share, color}]`, in order.
 *
 * Returns:
 *     The table's actor.
 */
function shareTable(title, rows) {
    const table = new St.BoxLayout({vertical: true, x_expand: true});
    table.add_child(stackedBar(rows.map(row => row.share), rows.map(row => row.color)));
    const header = new St.BoxLayout({style_class: 'cm-sh-header'});
    header.add_child(new St.Widget({width: 8}));
    header.add_child(shareCell(title, 'cm-hdr cm-sh-name'));
    header.add_child(shareCell('SHARE', 'cm-hdr cm-sh-share'));
    header.add_child(shareCell('TOKENS', 'cm-hdr cm-sh-out'));
    table.add_child(header);
    rows.forEach(({label, out, share, color}, i) => {
        if (i > 0)
            table.add_child(new St.Widget({style_class: 'cm-tline'}));
        const row = new St.BoxLayout({style_class: 'cm-trow'});
        row.add_child(colorSquare(color));
        const name = shareCell(label, 'cm-name cm-sh-name');
        name.clutter_text.ellipsize = 3; // Pango.EllipsizeMode.END
        row.add_child(name);
        row.add_child(shareCell(`${Math.round(share * 100)}%`, 'cm-val cm-sh-share'));
        row.add_child(shareCell(formatTokens(out), 'cm-sec cm-sh-out'));
        table.add_child(row);
    });
    return table;
}

/**
 * The Projects tab: where the output tokens go, by project.
 *
 * Returns:
 *     `{actor, update(records, nowMs), setRange(range), setNames(mode, home), setLoading(),
 *     setEmpty()}`, like `createActivityView`. `setNames` labels the projects by `folder`
 *     name or by `path`, with `home` shown as `~`.
 */
export function createProjectsView() {
    const state = {range: 'today', names: 'folder', home: ''};
    const actor = new St.BoxLayout({vertical: true, x_expand: true, y_expand: true});
    let latest = {records: [], nowMs: Date.now()};
    let loaded = false;

    const stateBlock = createStateBlock();
    const content = new St.BoxLayout({vertical: true, x_expand: true, visible: false});

    const show = screen => {
        stateBlock.show(screen);
        content.visible = false;
    };

    const render = () => {
        const {records, nowMs} = latest;
        const from = rangeFrom(state.range, nowMs, records);
        const projects = projectStats(records, from, nowMs, TOP_PROJECTS, state.names,
            state.home);
        if (projects.total === 0) {
            show(SCREEN_STATES.empty);
            return;
        }

        stateBlock.hide();
        content.visible = true;
        content.destroy_all_children();
        const rows = projects.rows.map((row, i) => ({...row, color: PROJECT_COLORS[i]}));
        if (projects.other)
            rows.push({label: 'Other', ...projects.other, color: OTHER_COLOR});
        content.add_child(shareTable('PROJECT', rows));
    };

    const rangeSwitch = createSwitch(Object.keys(PROJECTS_RANGES), 'Today', name => {
        state.range = PROJECTS_RANGES[name];
        if (loaded)
            render();
    });
    actor.add_child(rangeSwitch.actor);
    actor.add_child(stateBlock.actor);
    actor.add_child(content);
    show(SCREEN_STATES.loadingActivity);

    return {
        actor,
        update(records, nowMs) {
            latest = {records: [...records], nowMs};
            loaded = true;
            render();
        },
        setRange(range) {
            state.range = range;
            rangeSwitch.select(rangeLabel(PROJECTS_RANGES, range));
            if (loaded)
                render();
        },
        setNames(mode, home) {
            state.names = mode;
            state.home = home;
            if (loaded)
                render();
        },
        // Until the next update, a new range or option keeps the state
        setLoading() {
            loaded = false;
            show(SCREEN_STATES.loadingActivity);
        },
        setEmpty() {
            loaded = false;
            show(SCREEN_STATES.empty);
        },
    };
}

/**
 * The Models tab: where the tokens go, by model family, largest first.
 *
 * Returns:
 *     `{actor, update(records, nowMs), setRange(range), setLoading(), setEmpty()}`, like
 *     `createActivityView`.
 */
export function createModelsView() {
    const state = {range: 'today'};
    const actor = new St.BoxLayout({vertical: true, x_expand: true, y_expand: true});
    let latest = {records: [], nowMs: Date.now()};
    let loaded = false;

    const stateBlock = createStateBlock();
    const content = new St.BoxLayout({vertical: true, x_expand: true, visible: false});

    const show = screen => {
        stateBlock.show(screen);
        content.visible = false;
    };

    const render = () => {
        const {records, nowMs} = latest;
        const totals = modelTotals(records, rangeFrom(state.range, nowMs, records), nowMs);
        const total = totals.reduce((sum, t) => sum + t.out, 0);
        if (total === 0) {
            show(SCREEN_STATES.empty);
            return;
        }

        stateBlock.hide();
        content.visible = true;
        content.destroy_all_children();
        content.add_child(shareTable('MODEL', totals.map(({family, out}) => {
            const [r, g, b] = FAMILY_COLORS[family].map(c => Math.round(c * 255));
            return {label: FAMILY_NAMES[family], out, share: out / total,
                color: `rgb(${r}, ${g}, ${b})`};
        })));
    };

    const rangeSwitch = createSwitch(Object.keys(PROJECTS_RANGES), 'Today', name => {
        state.range = PROJECTS_RANGES[name];
        if (loaded)
            render();
    });
    actor.add_child(rangeSwitch.actor);
    actor.add_child(stateBlock.actor);
    actor.add_child(content);
    show(SCREEN_STATES.loadingActivity);

    return {
        actor,
        update(records, nowMs) {
            latest = {records: [...records], nowMs};
            loaded = true;
            render();
        },
        setRange(range) {
            state.range = range;
            rangeSwitch.select(rangeLabel(PROJECTS_RANGES, range));
            if (loaded)
                render();
        },
        // Until the next update, a new range or option keeps the state
        setLoading() {
            loaded = false;
            show(SCREEN_STATES.loadingActivity);
        },
        setEmpty() {
            loaded = false;
            show(SCREEN_STATES.empty);
        },
    };
}
