import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {indexGapSeconds, resolveClaudeDir} from './prefs/config.js';
import {runIndexer} from './history/index-runner.js';
import {createLimitsView} from './popup/limits-view.js';
import {panelMarkup, panelValues, usageColor} from './topbar/panel.js';
import {createPanelGraphic} from './topbar/panel-graphic.js';
import {selectRecords} from './history/stats.js';
import {State, limitsScreen, statusLine} from './limits/status.js';
import {loadSummary} from './history/store.js';
import {UsageClient} from './limits/usage-client.js';
import {
    createActivityView, createModelsView, createProjectsView, createTabBar,
} from './popup/views.js';
import {createFooter, createVBox} from './popup/widgets.js';

const STALE_OPACITY = 115;
const PANEL_KEYS = ['panel-style', 'panel-limit', 'panel-color', 'color-scale', 'show-icon'];
const ACTIVITY_KEYS = ['count', 'hidden-projects', 'project-names'];
// While the popup is open, "Updated N min ago" and the reset times move on
const OPEN_TICK_SECONDS = 60;

/**
 * The top bar button: the chosen limits as a percentage, bar or ring, and a popup with the Limits,
 * Projects, Activity and Models tabs.
 */
export const Indicator = GObject.registerClass(
class ClaudometerIndicator extends PanelMenu.Button {
    /**
     * Args:
     *     path: The extension's folder.
     *     settings: The extension's `Gio.Settings`.
     *     dataDir: Folder for the transcript index, its summary and the usage cache.
     *     userAgent: Sent with every request to the usage service.
     *     openPreferences: Opens the preferences window.
     */
    _init({path, settings, dataDir, userAgent, openPreferences}) {
        // 0.5 centers the popup under the button
        super._init(0.5, 'Claudometer');
        this._path = path;
        this._settings = settings;
        this._userAgent = userAgent;
        this._openPreferences = openPreferences;
        this._indexPath = GLib.build_filenamev([dataDir, 'index.json']);
        this._summaryPath = GLib.build_filenamev([dataDir, 'summary.json']);
        this._usageCachePath = GLib.build_filenamev([dataDir, 'usage.json']);
        // Hourly totals for the activity tabs; null until there are some
        this._records = null;
        this._cancellable = new Gio.Cancellable();
        this._indexProcess = null;
        this._indexing = false;
        // A rebuild asked for while the helper runs waits for it to end
        this._rebuildPending = false;
        this._lastIndexMs = 0;
        this._usage = {state: State.FRESH, detail: null, data: null, lastSuccessMs: 0};

        const box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        // A full-color icon, so it keeps its orange instead of following the theme
        this._icon = new St.Icon({
            gicon: Gio.icon_new_for_string(
                GLib.build_filenamev([path, 'icons', 'claudometer.svg'])),
            style_class: 'system-status-icon',
        });
        box.add_child(this._icon);
        this._graphic = createPanelGraphic();
        box.add_child(this._graphic.actor);
        this._label = new St.Label({
            text: '…',
            style_class: 'cm-panel-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._label);
        this.add_child(box);
        this._showPanel();

        // The status line and the reset times follow the clock format
        this._desktopSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._buildPopup();
        this._menuOpenId = this.menu.connect('open-state-changed', (menu, open) => {
            this._stopTick();
            if (!open)
                return;
            this._tick();
            this._tickId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, OPEN_TICK_SECONDS,
                () => {
                    this._tick();
                    return GLib.SOURCE_CONTINUE;
                });
            this._activityView.setRange(this._settings.get_string('activity-range'));
            for (const view of [this._projectsView, this._modelsView])
                view.setRange(this._settings.get_string('lists-range'));
            this._refreshViews();
            this._refreshIndex(true);
        });
        this._clockId = this._desktopSettings.connect('changed::clock-format', () => {
            this._applyLimitOptions();
            this._showStatus();
        });
        this._applyLimitOptions();
        this._settingsId = settings.connect('changed', (s, key) => {
            if (key === 'model-limits' || key === 'reset-style')
                this._applyLimitOptions();
            else if (key === 'refresh-interval')
                this._client.setInterval(s.get_int('refresh-interval'));
            else if (key === 'tabs')
                this._applyTabs();
            else if (PANEL_KEYS.includes(key))
                this._showPanel();
            else if (ACTIVITY_KEYS.includes(key))
                this._applyActivityOptions();
            else if (key === 'claude-dir')
                this._onClaudeDir();
            else if (key === 'rebuild-request')
                this._rebuild();
        });

        this._applyActivityOptions();
        this._loadSummary(false);
        this._createClient();
    }

    _createClient() {
        this._client = new UsageClient({
            credentialsPath: GLib.build_filenamev([this._claudeDir(), '.credentials.json']),
            cachePath: this._usageCachePath,
            intervalSeconds: this._settings.get_int('refresh-interval'),
            userAgent: this._userAgent,
            onChange: usage => this._onUsage(usage),
        });
    }

    // The login and the history both come from the new folder
    _onClaudeDir() {
        this._client.destroy();
        this._createClient();
        this._rebuild();
    }

    _gicon(name) {
        return Gio.icon_new_for_string(
            GLib.build_filenamev([this._path, 'icons', `${name}-symbolic.svg`]));
    }

    _claudeDir() {
        return resolveClaudeDir(this._settings.get_string('claude-dir'),
            GLib.getenv('CLAUDE_CONFIG_DIR'), GLib.get_home_dir());
    }

    _buildPopup() {
        this._limitsView = createLimitsView();
        this._showLimitsState();
        this._activityView = createActivityView();
        this._projectsView = createProjectsView();
        this._modelsView = createModelsView();
        this._tabViews = {
            Limits: this._limitsView.actor,
            Projects: this._projectsView.actor,
            Activity: this._activityView.actor,
            Models: this._modelsView.actor,
        };
        const saved = this._settings.get_string('last-tab');
        this._tab = saved in this._tabViews ? saved : 'Limits';
        this._tabBar = createTabBar(
            Object.keys(this._tabViews).map(name => ({
                name,
                gicon: this._gicon(name.toLowerCase()),
            })),
            this._tab, name => this._selectTab(name));
        this._footer = createFooter(this._gicon('settings'), () => {
            this.menu.close();
            this._openPreferences();
        });
        this._showStatus();

        const body = createVBox({style_class: 'cm-popup', x_expand: true});
        body.add_child(this._tabBar.actor);
        for (const view of Object.values(this._tabViews))
            body.add_child(view);
        body.add_child(this._footer.actor);
        const bodyItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        bodyItem.add_child(body);
        this.menu.addMenuItem(bodyItem);
        this._applyTabs();
    }

    // Limits is always shown; unknown names in the setting are ignored
    _applyTabs() {
        const shown = ['Limits', ...this._settings.get_strv('tabs')
            .filter(name => name !== 'Limits' && name in this._tabViews)];
        this._tabBar.setShown(shown);
        this._selectTab(shown.includes(this._tab) ? this._tab : 'Limits', false);
    }

    _selectTab(name, remember = true) {
        this._tab = name;
        for (const [tab, view] of Object.entries(this._tabViews))
            view.visible = tab === name;
        this._tabBar.setSelected(name);
        if (!remember)
            return;
        this._settings.set_string('last-tab', name);
        this._refreshViews();
        if (name !== 'Limits')
            this._refreshIndex();
    }

    _isStale() {
        return this._usage.state !== State.FRESH;
    }

    _onUsage(usage) {
        this._usage = usage;
        const stale = this._isStale();
        if (usage.data)
            this._limitsView.update(usage.data, stale);
        this._showLimitsState();
        this._showPanel();
        this._showStatus();
    }

    // Without values the Limits tab shows why instead of the table
    _showLimitsState() {
        const {state, detail, data} = this._usage;
        this._limitsView.showState(limitsScreen(state, detail, !!data));
    }

    // Without data the graphic is drawn empty and the label says loading or failed
    _showPanel() {
        const s = this._settings;
        const style = s.get_string('panel-style');
        const {data, state} = this._usage;
        const values = panelValues(data ?? {}, s.get_string('panel-limit'));
        const colors = values.map(v =>
            usageColor(v, s.get_string('panel-color'), s.get_string('color-scale')));
        this._icon.visible = s.get_boolean('show-icon');
        this._graphic.update(style, values, colors);
        let markup = state === State.FRESH ? '…' : '—';
        if (data)
            markup = panelMarkup(values, style === 'percentage' ? colors : null);
        this._label.clutter_text.set_markup(markup);
        const opacity = this._isStale() ? STALE_OPACITY : 255;
        this._label.opacity = opacity;
        this._graphic.actor.opacity = opacity;
    }

    _use24h() {
        return this._desktopSettings.get_string('clock-format') === '24h';
    }

    _applyLimitOptions() {
        this._limitsView.setOptions({
            modelLimits: this._settings.get_boolean('model-limits'),
            resetStyle: this._settings.get_string('reset-style'),
            use24h: this._use24h(),
        });
    }

    _showStatus() {
        const {state, detail, lastSuccessMs} = this._usage;
        this._footer.setStatus(statusLine(state, detail, lastSuccessMs, Date.now(),
            this._use24h()));
    }

    _tick() {
        this._limitsView.updateTimes(this._usage.data, Date.now(), this._isStale());
        this._showStatus();
    }

    _stopTick() {
        if (this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = null;
        }
    }

    _activityViews() {
        return [this._activityView, this._projectsView, this._modelsView];
    }

    _applyActivityOptions() {
        this._projectsView.setNames(this._settings.get_string('project-names'),
            GLib.get_home_dir());
        this._refreshViews();
    }

    // Hidden projects leave every tab; the count decides what each record adds up to
    _refreshViews() {
        if (!this._records)
            return;
        const now = Date.now();
        const records = selectRecords([...this._records.values()], {
            count: this._settings.get_string('count'),
            hidden: this._settings.get_strv('hidden-projects').map(name => name.trim()),
        });
        for (const view of this._activityViews())
            view.update(records, now);
    }

    // The summary of an earlier run shows at once while the helper brings it up to date.
    // Before the helper has run, a missing, unusable or empty summary is ignored, so no
    // half-built numbers show; afterwards an empty one means there is no activity.
    _loadSummary(fromHelper) {
        loadSummary(this._summaryPath, this._cancellable, records => {
            if (this._destroyed || (!fromHelper && records.size === 0))
                return;
            this._records = records;
            this._refreshViews();
        });
    }

    // At most one helper runs at a time, and not more often than the read-activity gap; with
    // no gap it runs on every popup open and never on a tab change
    _refreshIndex(opened = false) {
        const gap = indexGapSeconds(this._settings.get_string('read-activity'));
        if (this._indexing || (gap === 0 ? !opened : Date.now() - this._lastIndexMs < gap * 1000))
            return;
        this._runIndex();
    }

    // Deletes the index and reads the whole history again, whatever the gap
    _rebuild() {
        if (this._indexing) {
            this._rebuildPending = true;
            return;
        }
        this._indexing = true;
        this._records = null;
        for (const view of this._activityViews())
            view.setLoading();
        Gio.File.new_for_path(this._indexPath).delete_async(GLib.PRIORITY_DEFAULT,
            this._cancellable, (file, result) => {
                try {
                    file.delete_finish(result);
                } catch (e) {
                    if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        return;
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                        console.warn('Claudometer: Cannot delete the index:', e.message);
                }
                if (!this._destroyed)
                    this._runIndex();
            });
    }

    _runIndex() {
        this._indexing = true;
        const projectsDir = GLib.build_filenamev([this._claudeDir(), 'projects']);
        this._indexProcess = runIndexer(this._path, projectsDir, this._indexPath,
            this._summaryPath, this._settings.get_int('keep-days'), ok => {
                this._indexProcess = null;
                this._indexing = false;
                if (this._destroyed)
                    return;
                if (this._rebuildPending) {
                    this._rebuildPending = false;
                    this._rebuild();
                } else if (ok) {
                    this._lastIndexMs = Date.now();
                    this._loadSummary(true);
                } else if (!this._records) {
                    for (const view of this._activityViews())
                        view.setEmpty();
                }
            });
    }

    destroy() {
        this._destroyed = true;
        this._stopTick();
        this._client.destroy();
        this._indexProcess?.force_exit();
        this._indexProcess = null;
        this._cancellable.cancel();
        this.menu.disconnect(this._menuOpenId);
        this._settings.disconnect(this._settingsId);
        this._desktopSettings.disconnect(this._clockId);
        super.destroy();
    }
});
