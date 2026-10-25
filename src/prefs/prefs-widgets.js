// Rows and previews for the preferences window, which runs in its own GTK process.
import Cairo from 'cairo';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';

import {SCALES, drawPanelGraphic, graphicSize, hexToRgb, panelMarkup, usageColor}
    from '../topbar/panel.js';
import {limitTimeText} from '../limits/status.js';

const PANEL_KEYS = ['panel-style', 'panel-limit', 'panel-color', 'color-scale', 'show-icon'];
const SAMPLE = {'five-hour': [42], weekly: [18], both: [42, 18]};
const ORANGE = '#d97757';
const RESET_IN_MS = (2 * 60 + 14) * 60000 + 30000;

const CSS = `
.cm-preview {
    background-color: black;
    border-radius: 8px;
    padding: 6px 12px;
    color: white;
}
.cm-preview-label {
    font-weight: bold;
}
`;

let cssAdded = false;

function addCss() {
    if (cssAdded)
        return;
    const provider = new Gtk.CssProvider();
    provider.load_from_string(CSS);
    Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), provider,
        Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    cssAdded = true;
}

/**
 * Calls `fn` now and whenever one of the keys changes, until the widget is destroyed.
 *
 * Args:
 *     widget: The widget that owns the connection.
 *     settings: The extension settings.
 *     keys: Keys to follow.
 *     fn: Called with no arguments.
 */
export function followSettings(widget, settings, keys, fn) {
    const ids = keys.map(key => settings.connect(`changed::${key}`, () => fn()));
    widget.connect('destroy', () => ids.forEach(id => settings.disconnect(id)));
    fn();
}

/**
 * A row of linked toggle buttons, one per choice, under a title and subtitle.
 *
 * Args:
 *     title: Row title.
 *     subtitle: Text under the title, or null.
 *     settings: The extension settings.
 *     key: The key the buttons write.
 *     choices: `[value, label]` pairs.
 *     type: `'s'` for a string key, `'i'` for an integer key; for `'i'` a stored value not
 *         among the choices leaves every button up.
 *     preview: Widget shown under the buttons, or null.
 *
 * Returns:
 *     The Adw.PreferencesRow.
 */
export function choiceRow({title, subtitle, settings, key, choices, type = 's', preview = null}) {
    const get = () => type === 'i' ? settings.get_int(key) : settings.get_string(key);
    const set = value => type === 'i'
        ? settings.set_int(key, value) : settings.set_string(key, value);

    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL, spacing: 8,
        margin_top: 10, margin_bottom: 10, margin_start: 12, margin_end: 12,
    });
    box.append(new Gtk.Label({label: title, xalign: 0}));
    if (subtitle) {
        box.append(new Gtk.Label({
            label: subtitle, xalign: 0, wrap: true, css_classes: ['dim-label', 'caption'],
        }));
    }

    const buttons = new Gtk.Box({homogeneous: true, css_classes: ['linked']});
    let group = null;
    const toggles = choices.map(([value, label]) => {
        const button = new Gtk.ToggleButton({label, group});
        group ??= button;
        button.connect('toggled', () => {
            if (button.active && get() !== value)
                set(value);
        });
        buttons.append(button);
        return [value, button];
    });
    box.append(buttons);
    if (preview)
        box.append(preview);

    const row = new Adw.PreferencesRow({child: box, activatable: false, title});
    followSettings(row, settings, [key], () => {
        const current = get();
        for (const [value, button] of toggles)
            button.active = value === current;
    });
    return row;
}

/**
 * A row with an entry that commits on Enter and when it loses focus, never per keystroke.
 *
 * Args:
 *     title: Row title.
 *     subtitle: Text under the title, or null.
 *     placeholder: Text shown while the entry is empty.
 *     text: Starting text.
 *     onCommit: Called with the entry text when it differs from the last commit; may return
 *         the text to show instead.
 *
 * Returns:
 *     The Adw.ActionRow, with a `commit()` method that saves pending text.
 */
export function entryRow({title, subtitle = null, placeholder = '', text = '', onCommit}) {
    const entry = new Gtk.Entry({
        valign: Gtk.Align.CENTER, width_chars: 18, placeholder_text: placeholder, text,
    });
    let committed = text;
    const commit = () => {
        if (entry.text === committed)
            return;
        const shown = onCommit(entry.text) ?? entry.text;
        committed = shown;
        if (shown !== entry.text)
            entry.text = shown;
    };
    entry.connect('activate', commit);
    const focus = new Gtk.EventControllerFocus();
    focus.connect('leave', commit);
    entry.add_controller(focus);

    const row = new Adw.ActionRow({title, activatable_widget: entry});
    if (subtitle)
        row.subtitle = subtitle;
    row.add_suffix(entry);
    row.commit = commit;
    return row;
}

/**
 * A sample of the top bar with 5-hour at 42% and weekly at 18%, following the top bar keys.
 *
 * Args:
 *     settings: The extension settings.
 *     extensionPath: Folder of the extension, for the icon.
 *
 * Returns:
 *     The preview widget.
 */
export function panelPreview(settings, extensionPath) {
    addCss();
    const box = new Gtk.Box({
        spacing: 6, halign: Gtk.Align.START, margin_top: 4, css_classes: ['cm-preview'],
    });
    const icon = new Gtk.Image({
        gicon: Gio.icon_new_for_string(
            GLib.build_filenamev([extensionPath, 'icons', 'claudometer.svg'])),
        pixel_size: 16,
    });
    const graphic = new Gtk.DrawingArea({valign: Gtk.Align.CENTER});
    const label = new Gtk.Label({css_classes: ['cm-preview-label']});
    box.append(icon);
    box.append(graphic);
    box.append(label);

    let state = {style: 'percentage', values: [], colors: []};
    graphic.set_draw_func((area, cr) => {
        drawPanelGraphic(cr, state.style, state.values, state.colors);
    });

    followSettings(box, settings, PANEL_KEYS, () => {
        const style = settings.get_string('panel-style');
        const values = SAMPLE[settings.get_string('panel-limit')] ?? SAMPLE.weekly;
        const colors = values.map(v => usageColor(v, settings.get_string('panel-color'),
            settings.get_string('color-scale')));
        state = {style, values, colors};
        icon.visible = settings.get_boolean('show-icon');
        const [width, height] = graphicSize(style, values.length);
        graphic.visible = width > 0;
        graphic.content_width = width;
        graphic.content_height = height;
        graphic.queue_draw();
        label.set_markup(panelMarkup(values, style === 'percentage' ? colors : null));
    });
    return box;
}

/**
 * A sample Limits row: 5-hour at 42%, resetting 2 h 14 min from now, in the chosen style.
 *
 * Args:
 *     settings: The extension settings.
 *
 * Returns:
 *     The preview widget.
 */
export function resetPreview(settings) {
    const box = new Gtk.Box({spacing: 10, margin_top: 4});
    const meter = new Gtk.DrawingArea({
        content_width: 48, content_height: 3, valign: Gtk.Align.CENTER,
    });
    meter.set_draw_func((area, cr, width, height) => {
        cr.setSourceRGBA(0.5, 0.5, 0.5, 0.25);
        cr.rectangle(0, 0, width, height);
        cr.fill();
        cr.setSourceRGBA(...hexToRgb(ORANGE), 1);
        cr.rectangle(0, 0, width * 0.42, height);
        cr.fill();
    });
    const time = new Gtk.Label({xalign: 0, css_classes: ['dim-label']});
    box.append(new Gtk.Label({label: '5-hour', xalign: 0}));
    box.append(meter);
    box.append(new Gtk.Label({label: '42%'}));
    box.append(time);

    const clock = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
    followSettings(box, settings, ['reset-style'], () => {
        const now = Date.now();
        time.label = limitTimeText(new Date(now + RESET_IN_MS).toISOString(), now, {
            stale: false,
            style: settings.get_string('reset-style'),
            use24h: clock.get_string('clock-format') !== '12h',
        });
    });
    return box;
}

/**
 * A strip showing the chosen color scale as a gradient.
 *
 * Args:
 *     settings: The extension settings.
 *
 * Returns:
 *     The Gtk.DrawingArea.
 */
export function scalePreview(settings) {
    const strip = new Gtk.DrawingArea({content_height: 14, hexpand: true, margin_top: 4});
    strip.set_draw_func((area, cr, width, height) => {
        const stops = SCALES[settings.get_string('color-scale')] ?? SCALES.orange;
        const gradient = new Cairo.LinearGradient(0, 0, width, 0);
        stops.forEach((hex, i) =>
            gradient.addColorStopRGB(i / (stops.length - 1), ...hexToRgb(hex)));
        cr.setSource(gradient);
        cr.rectangle(0, 0, width, height);
        cr.fill();
    });
    followSettings(strip, settings, ['color-scale'], () => strip.queue_draw());
    return strip;
}
