import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {
    REFRESH_CHOICES, UNIT_DAYS, keepDays, keepFields, resolveClaudeDir,
} from './src/prefs/config.js';
import {EXPORT_FILE_NAME, exportCsv} from './src/history/export.js';
import {
    choiceRow, entryRow, followSettings, panelPreview, resetPreview, scalePreview,
} from './src/prefs/prefs-widgets.js';
import {parseHiddenProjects} from './src/history/stats.js';
import {parseIndex} from './src/history/transcripts.js';
import {chooseSaveFile, confirm, openUri, switchRow, toast} from './src/prefs/toolkit.js';

Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');
Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');

const TAB_NAMES = ['Projects', 'Activity', 'Models'];
const UNITS = [['days', 'Days'], ['weeks', 'Weeks'], ['months', 'Months'], ['years', 'Years']];
const PROJECT_PAGE = 'https://github.com/emanuel36/claudometer';

function group(page, title, rows) {
    const g = new Adw.PreferencesGroup(title ? {title} : {});
    rows.forEach(row => g.add(row));
    page.add(g);
    return g;
}

function settingRow(settings, key, title) {
    const {row, toggle} = switchRow({title});
    settings.bind(key, toggle, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function buttonRow(title, label, onClick) {
    const row = new Adw.ActionRow({title});
    const button = new Gtk.Button({label, valign: Gtk.Align.CENTER});
    button.connect('clicked', onClick);
    row.add_suffix(button);
    return row;
}

function tabsRow(settings) {
    const row = new Adw.ExpanderRow({title: 'Tabs'});
    const switches = TAB_NAMES.map(name => {
        const {row: tabRow, toggle: tab} = switchRow({title: name});
        tab.connect('notify::active', () => {
            const shown = settings.get_strv('tabs');
            const next = TAB_NAMES.filter(n => n === name ? tab.active : shown.includes(n));
            if (next.join() !== shown.join())
                settings.set_strv('tabs', next);
        });
        row.add_row(tabRow);
        return [name, tab];
    });
    followSettings(row, settings, ['tabs'], () => {
        const shown = settings.get_strv('tabs');
        for (const [name, tab] of switches)
            tab.active = shown.includes(name);
        const names = TAB_NAMES.filter(n => shown.includes(n));
        row.subtitle = names.length ? names.join(', ') : 'Only Limits';
    });
    return row;
}

// "Keep history for" (amount and unit) and "Keep forever"; the shell reads only keep-days
function keepRows(settings) {
    const spin = new Gtk.SpinButton({
        adjustment: new Gtk.Adjustment({
            lower: 1, upper: 999, step_increment: 1, page_increment: 10,
        }),
        numeric: true, valign: Gtk.Align.CENTER,
    });
    const units = new Gtk.Box({homogeneous: true, hexpand: true, css_classes: ['linked']});
    let first = null;
    const toggles = UNITS.map(([unit, label]) => {
        const button = new Gtk.ToggleButton({label, group: first});
        first ??= button;
        units.append(button);
        return [unit, button];
    });
    const controls = new Gtk.Box({spacing: 8});
    controls.append(spin);
    controls.append(units);

    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL, spacing: 8,
        margin_top: 10, margin_bottom: 10, margin_start: 12, margin_end: 12,
    });
    box.append(new Gtk.Label({label: 'Keep history for', xalign: 0}));
    box.append(new Gtk.Label({
        label: 'Older activity is dropped from the history', xalign: 0, wrap: true,
        css_classes: ['dim-label', 'caption'],
    }));
    box.append(controls);
    const amountRow = new Adw.PreferencesRow({
        child: box, activatable: false, title: 'Keep history for',
    });
    const {row: foreverRow, toggle: foreverToggle} = switchRow({title: 'Keep forever'});

    // Set while the controls are being filled in or written out, so neither feeds the other
    let busy = false;
    let shownUnit = 'months';
    let pending = 0;
    const show = ({forever, amount, unit}) => {
        busy = true;
        foreverToggle.active = forever;
        spin.value = amount;
        toggles.forEach(([name, button]) => (button.active = name === unit));
        shownUnit = unit;
        controls.sensitive = !forever;
        busy = false;
    };
    const writeDays = () => {
        const days = keepDays(foreverToggle.active, spin.get_value_as_int(), shownUnit);
        if (settings.get_int('keep-days') !== days) {
            busy = true;
            settings.set_int('keep-days', days);
            busy = false;
        }
    };
    const cancelPending = () => {
        if (pending)
            GLib.source_remove(pending);
        pending = 0;
    };
    // keep-days drops history on the next index run, so it waits for the edit to settle
    const write = () => {
        if (busy)
            return;
        busy = true;
        const amount = spin.get_value_as_int();
        controls.sensitive = !foreverToggle.active;
        if (settings.get_int('keep-amount') !== amount)
            settings.set_int('keep-amount', amount);
        if (settings.get_string('keep-unit') !== shownUnit)
            settings.set_string('keep-unit', shownUnit);
        busy = false;
        cancelPending();
        pending = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
            pending = 0;
            writeDays();
            return GLib.SOURCE_REMOVE;
        });
    };
    foreverToggle.connect('notify::active', write);
    spin.connect('value-changed', write);
    // A new unit converts the number so the length stays about the same
    toggles.forEach(([unit, button]) => button.connect('toggled', () => {
        if (busy || !button.active || unit === shownUnit)
            return;
        const days = spin.get_value_as_int() * UNIT_DAYS[shownUnit];
        busy = true;
        spin.value = Math.max(1, Math.min(999, Math.round(days / UNIT_DAYS[unit])));
        shownUnit = unit;
        busy = false;
        write();
    }));
    // Saves a typed number and any pending keep-days now; called when the window closes
    amountRow.commit = () => {
        spin.update();
        if (!pending)
            return;
        cancelPending();
        writeDays();
    };
    amountRow.connect('destroy', cancelPending);

    followSettings(amountRow, settings, ['keep-days', 'keep-amount', 'keep-unit'], () => {
        if (busy)
            return;
        const days = settings.get_int('keep-days');
        const amount = settings.get_int('keep-amount');
        const unit = settings.get_string('keep-unit');
        // A number of days set by the old buttons, or from outside the preferences
        if (days > 0 && days !== amount * UNIT_DAYS[unit])
            show(keepFields(days));
        else
            show({forever: days === 0, amount, unit});
    });
    return [amountRow, foreverRow];
}

export default class ClaudometerPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const entries = [];
        window.add(this._topBarPage(settings));
        window.add(this._popupPage(settings, entries));
        window.add(this._dataPage(window, settings, entries));
        window.add(this._aboutPage(window));
        // Closing the window may not move focus first, so save what is typed
        window.connect('close-request', () => {
            entries.forEach(row => row.commit());
            return false;
        });
    }

    _topBarPage(settings) {
        const page = new Adw.PreferencesPage({
            title: 'Top bar', icon_name: 'video-display-symbolic',
        });
        group(page, 'Look', [
            settingRow(settings, 'show-icon', 'Show icon'),
            choiceRow({
                title: 'Style', settings, key: 'panel-style',
                choices: [['percentage', 'Percentage'], ['bar', 'Bar'], ['ring', 'Ring']],
                preview: panelPreview(settings, this.path),
            }),
            choiceRow({
                title: 'Show', settings, key: 'panel-limit',
                choices: [['five-hour', '5-hour'], ['weekly', 'Weekly'], ['both', 'Both']],
                preview: panelPreview(settings, this.path),
            }),
        ]);
        const scale = choiceRow({
            title: 'Scale', settings, key: 'color-scale',
            choices: [
                ['orange', 'Orange tones'], ['white-red', 'White to red'],
                ['blue-red', 'Blue to red'],
            ],
            preview: scalePreview(settings),
        });
        group(page, 'Colors', [
            choiceRow({
                title: 'Color', settings, key: 'panel-color',
                choices: [
                    ['white', 'White'], ['orange', 'Orange'], ['usage', 'Changes with usage'],
                ],
            }),
            scale,
        ]);
        followSettings(scale, settings, ['panel-color'], () => {
            scale.visible = settings.get_string('panel-color') === 'usage';
        });
        group(page, 'Placement', [
            choiceRow({
                title: 'Position', settings, key: 'panel-position',
                choices: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']],
            }),
        ]);
        return page;
    }

    _popupPage(settings, entries) {
        const page = new Adw.PreferencesPage({title: 'Popup', icon_name: 'view-grid-symbolic'});
        group(page, 'Tabs', [tabsRow(settings)]);
        group(page, 'Limits', [
            settingRow(settings, 'model-limits', 'Per-model limits'),
            choiceRow({
                title: 'Reset times', settings, key: 'reset-style',
                choices: [['countdown', 'Countdown'], ['clock', 'Clock time']],
                preview: resetPreview(settings),
            }),
        ]);
        group(page, 'Activity', [
            choiceRow({
                title: 'Count', subtitle: 'What the charts add up. Subagents always count.',
                settings, key: 'count',
                choices: [
                    ['output', 'Output tokens'], ['output-input', 'Output and input'],
                    ['all', 'All, with cache'],
                ],
            }),
            choiceRow({
                title: 'Activity starts on', settings, key: 'activity-range',
                choices: [['7d', '7d'], ['30d', '30d'], ['6m', '6m'], ['all', 'All']],
            }),
            choiceRow({
                title: 'Projects and Models start on', settings, key: 'lists-range',
                choices: [['today', 'Today'], ['7d', '7d'], ['30d', '30d'], ['all', 'All']],
            }),
        ]);
        group(page, 'Projects', [
            choiceRow({
                title: 'Project names', settings, key: 'project-names',
                choices: [['folder', 'Folder name'], ['path', 'Path from home']],
            }),
            entries[entries.push(entryRow({
                title: 'Hidden projects', subtitle: 'Folder names, separated by commas',
                placeholder: 'scratch, private',
                text: settings.get_strv('hidden-projects').join(', '),
                onCommit: text => {
                    const names = parseHiddenProjects(text);
                    if (names.join('\n') !== settings.get_strv('hidden-projects').join('\n'))
                        settings.set_strv('hidden-projects', names);
                    return names.join(', ');
                },
            })) - 1],
        ]);
        return page;
    }

    _dataPage(window, settings, entries) {
        const page = new Adw.PreferencesPage({
            title: 'Data', icon_name: 'drive-harddisk-symbolic',
        });
        group(page, 'Updates', [
            choiceRow({
                title: 'Refresh limits every',
                subtitle: 'The usage service refuses requests that come too often',
                settings, key: 'refresh-interval', type: 'i', choices: REFRESH_CHOICES,
            }),
            choiceRow({
                title: 'Read activity',
                subtitle: 'How often the history is read while the popup is open',
                settings, key: 'read-activity',
                choices: [
                    ['every-5', 'Every 5 min'], ['every-15', 'Every 15 min'],
                    ['on-open', 'Only when opening'],
                ],
            }),
        ]);
        const home = GLib.get_home_dir();
        const defaultDir = resolveClaudeDir('', GLib.getenv('CLAUDE_CONFIG_DIR'), home);
        const keep = keepRows(settings);
        entries.push(keep[0]);
        group(page, 'Storage', [
            entries[entries.push(entryRow({
                title: 'Claude Code folder',
                placeholder: defaultDir.startsWith(`${home}/`)
                    ? `~${defaultDir.slice(home.length)}` : defaultDir,
                text: settings.get_string('claude-dir'),
                onCommit: text => {
                    const dir = text.trim();
                    if (dir !== settings.get_string('claude-dir'))
                        settings.set_string('claude-dir', dir);
                    return dir;
                },
            })) - 1],
            ...keep,
            buttonRow('Rebuild activity history', 'Rebuild', () => this._rebuild(window, settings)),
            buttonRow('Export activity', 'Export…', () => this._export(window)),
        ]);
        return page;
    }

    _rebuild(window, settings) {
        confirm(window, {
            heading: 'Rebuild activity history?',
            body: 'Claudometer will read all Claude Code transcripts again. ' +
                'This can take about a minute.',
            cancelLabel: 'Cancel',
            confirmLabel: 'Rebuild',
        }, () => settings.set_int('rebuild-request', settings.get_int('rebuild-request') + 1));
    }

    async _export(window) {
        const target = await chooseSaveFile(window, EXPORT_FILE_NAME);
        if (!target)
            return;  // Dismissed
        const summary = Gio.File.new_for_path(GLib.build_filenamev(
            [GLib.get_user_data_dir(), this.metadata.uuid, 'summary.json']));
        try {
            let bytes;
            try {
                [bytes] = await summary.load_contents_async(null);
            } catch (e) {
                if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) {
                    toast(window, 'No activity to export yet');
                    return;
                }
                throw e;
            }
            const records = parseIndex(new TextDecoder().decode(bytes)).records.values();
            const csv = new TextEncoder().encode(exportCsv(records));
            await target.replace_contents_bytes_async(new GLib.Bytes(csv), null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            toast(window, 'Activity exported');
        } catch (e) {
            toast(window, `Could not export: ${e.message}`);
        }
    }

    _aboutPage(window) {
        const page = new Adw.PreferencesPage({title: 'About', icon_name: 'help-about-symbolic'});
        const header = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL, spacing: 6, margin_bottom: 12,
        });
        header.append(new Gtk.Image({
            gicon: Gio.icon_new_for_string(
                GLib.build_filenamev([this.path, 'icons', 'claudometer.svg'])),
            pixel_size: 64,
        }));
        header.append(new Gtk.Label({label: 'Claudometer', css_classes: ['title-1']}));
        const version = this.metadata['version-name'];
        header.append(new Gtk.Label({
            label: version ?? '', visible: Boolean(version), css_classes: ['dim-label'],
        }));
        const top = new Adw.PreferencesGroup();
        top.add(header);
        page.add(top);

        const link = (title, uri) => {
            const row = new Adw.ActionRow({title, activatable: true});
            row.add_suffix(new Gtk.Image({icon_name: 'adw-external-link-symbolic'}));
            row.connect('activated', () => openUri(window, uri));
            return row;
        };
        group(page, null, [
            link('Project page', PROJECT_PAGE),
            link('Report a problem', `${PROJECT_PAGE}/issues`),
        ]);
        return page;
    }
}
