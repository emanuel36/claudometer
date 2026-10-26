/** The Limits tab: a table with one row per limit. */
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {scopedLimits} from '../limits/limits.js';
import {limitTimeText} from '../limits/status.js';
import {createStateBlock, createVBox} from './widgets.js';

const METER_WIDTH = 56;
// Matches .cm-meter-fill in stylesheet.css
const METER_RADIUS = 4;
// Shown faded while the limits could not be refreshed
const STALE_OPACITY = 115;

function cell(text, styleClass, extra = {}) {
    return new St.Label({
        text,
        style_class: styleClass,
        y_align: Clutter.ActorAlign.CENTER,
        ...extra,
    });
}

/**
 * The Limits tab: the 5-hour and weekly limits, and any weekly limit for a single model, as a
 * table of name, meter, percent used and time left (or reset clock time).
 *
 * Returns:
 *     `{actor, update(data, stale), updateTimes(data, nowMs, stale), showState(screen),
 *     setOptions({modelLimits, resetStyle, use24h})}`. `update` takes the usage endpoint's
 *     response; `updateTimes` refreshes the time column, which goes out of date on its own;
 *     `showState` replaces the table with a `limitsScreen` block, or shows the table again for
 *     null; `setOptions` redraws with the last data.
 */
export function createLimitsView() {
    const actor = createVBox({x_expand: true, y_expand: true});
    const table = createVBox({x_expand: true});
    const stateBlock = createStateBlock();
    actor.add_child(table);
    actor.add_child(stateBlock.actor);

    const options = {modelLimits: true, resetStyle: 'countdown', use24h: true};
    // `data` is null until the first response with values
    const shown = {data: null, stale: false};
    let timeCells = [];

    const header = () => {
        const row = new St.BoxLayout({style_class: 'cm-lt-header'});
        row.add_child(cell('LIMIT', 'cm-hdr cm-lt-name'));
        row.add_child(new St.Widget({width: METER_WIDTH}));
        row.add_child(cell('USED', 'cm-hdr cm-lt-percent'));
        row.add_child(cell(options.resetStyle === 'clock' ? 'RESETS' : 'LEFT',
            'cm-hdr cm-lt-time'));
        return row;
    };

    const timeText = (resetsAt, nowMs, stale) => limitTimeText(resetsAt, nowMs,
        {stale, style: options.resetStyle, use24h: options.use24h});

    const addRow = (name, percent, resetsAt, index) => {
        if (index > 0)
            table.add_child(new St.Widget({style_class: 'cm-tline'}));
        const row = new St.BoxLayout({style_class: 'cm-trow'});
        const label = cell(name, 'cm-name cm-lt-name');
        label.clutter_text.ellipsize = 3; // Pango.EllipsizeMode.END
        row.add_child(label);

        const track = new St.Widget({style_class: 'cm-meter-track',
            y_align: Clutter.ActorAlign.CENTER});
        const clamped = Math.min(100, Math.max(0, percent));
        const width = Math.round(clamped / 100 * METER_WIDTH);
        // St draws a radius wider than half the fill square on some rows, so narrow it
        const style = width < 2 * METER_RADIUS ? `border-radius: ${Math.floor(width / 2)}px;`
            : null;
        track.add_child(new St.Widget({style_class: 'cm-meter-fill', width, style}));
        row.add_child(track);

        const value = cell(`${Math.round(percent)}%`, 'cm-val cm-lt-percent');
        row.add_child(value);
        const time = cell('', 'cm-sec cm-lt-time');
        row.add_child(time);
        const opacity = shown.stale ? STALE_OPACITY : 255;
        track.opacity = opacity;
        value.opacity = opacity;
        table.add_child(row);
        timeCells.push({time, resetsAt});
    };

    const refreshTimes = nowMs => {
        for (const {time, resetsAt} of timeCells)
            time.set_text(resetsAt ? timeText(resetsAt, nowMs, shown.stale) : '');
    };

    const render = () => {
        if (options.resetStyle === 'clock')
            actor.add_style_class_name('cm-lt-clock');
        else
            actor.remove_style_class_name('cm-lt-clock');
        table.destroy_all_children();
        timeCells = [];
        table.add_child(header());
        const {data} = shown;
        if (!data)
            return;
        const rows = [
            ['5-hour', data.five_hour?.utilization ?? 0, data.five_hour?.resets_at],
            ['Weekly', data.seven_day?.utilization ?? 0, data.seven_day?.resets_at],
        ];
        if (options.modelLimits) {
            for (const limit of scopedLimits(data))
                rows.push([`${limit.name} weekly`, limit.percent, limit.resetsAt]);
        }
        rows.forEach(([name, percent, resetsAt], i) => addRow(name, percent, resetsAt, i));
        refreshTimes(Date.now());
    };
    render();

    return {
        actor,
        update(data, stale) {
            Object.assign(shown, {data, stale});
            render();
        },
        updateTimes(data, nowMs, stale) {
            if (!data)
                return;
            shown.stale = stale;
            refreshTimes(nowMs);
        },
        showState(screen) {
            table.visible = screen === null;
            if (screen)
                stateBlock.show(screen);
            else
                stateBlock.hide();
        },
        setOptions(next) {
            Object.assign(options, next);
            render();
        },
    };
}
