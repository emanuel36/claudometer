import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Indicator} from './src/indicator.js';

const BOXES = {left: '_leftBox', center: '_centerBox', right: '_rightBox'};

export default class ClaudometerExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = new Indicator({
            path: this.path,
            settings: this._settings,
            dataDir: GLib.build_filenamev([GLib.get_user_data_dir(), this.uuid]),
            openPreferences: () => this.openPreferences(),
        });
        const position = this._position();
        Main.panel.addToStatusArea(this.uuid, this._indicator, this._index(position), position);
        this._positionId = this._settings.connect('changed::panel-position',
            () => this._move());
    }

    disable() {
        if (this._positionId)
            this._settings.disconnect(this._positionId);
        this._positionId = null;
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }

    _position() {
        const position = this._settings.get_string('panel-position');
        return position in BOXES ? position : 'center';
    }

    // Left goes after Activities and the workspace indicator; center and right go first
    _index(position) {
        return position === 'left' ? Main.panel[BOXES.left].get_n_children() : 0;
    }

    // Moves the existing button, so its popup and state stay as they are
    _move() {
        const container = this._indicator.container;
        const position = this._position();
        const box = Main.panel[BOXES[position]];
        if (container.get_parent() === box)
            return;
        container.get_parent()?.remove_child(container);
        box.insert_child_at_index(container, this._index(position));
    }
}
