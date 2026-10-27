import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {createVBox} from './widgets.js';

const DIMMED_OPACITY = 115;
const ELLIPSIZE_END = 3; // Pango.EllipsizeMode.END

function cell(text, styleClass, dim) {
    const label = new St.Label({text, style_class: styleClass, y_align: Clutter.ActorAlign.CENTER});
    if (dim)
        label.opacity = DIMMED_OPACITY;
    return label;
}

function rowButton(row, onActivate) {
    const dim = row.marker === 'dim';
    const content = new St.BoxLayout({style_class: 'cm-trow', x_expand: true});
    content.add_child(new St.Widget({
        style_class: dim ? 'cm-ss-mark cm-ss-mark-dim' : 'cm-ss-mark',
        y_align: Clutter.ActorAlign.CENTER,
    }));
    const name = cell(row.name, 'cm-name', dim);
    name.x_expand = true;
    name.clutter_text.ellipsize = ELLIPSIZE_END;
    content.add_child(name);
    content.add_child(cell(row.label, 'cm-sec', dim));
    content.add_child(cell(row.time, 'cm-val cm-ss-time', dim));
    const button = new St.Button({
        child: content,
        style_class: 'cm-ss-row',
        x_expand: true,
        can_focus: true,
        reactive: true,
        track_hover: true,
        accessible_name: row.name,
    });
    button.connect('clicked', () => onActivate(row.sessionId));
    return button;
}

/**
 * The SESSIONS section of the Status tab: a header, one clickable row per session that needs
 * the user, and a summary line.
 *
 * Args:
 *     onActivate: Called with the `sessionId` of the clicked row.
 *
 * Returns:
 *     `{actor, update(listing)}`; `listing` is the result of `listing` in `tracker.js`.
 */
export function createSessionsView(onActivate) {
    const actor = createVBox({x_expand: true});
    // What is on screen, so an unchanged listing keeps its rows, with their focus and hover
    let drawn = null;
    return {
        actor,
        update({rows, header, summary}) {
            const listing = JSON.stringify({rows, header, summary});
            if (listing === drawn)
                return;
            drawn = listing;
            actor.destroy_all_children();
            actor.add_child(new St.Widget({style_class: 'cm-tline'}));
            const head = new St.BoxLayout({style_class: 'cm-ss-header'});
            head.add_child(new St.Label({text: 'SESSIONS', style_class: 'cm-hdr', x_expand: true,
                y_align: Clutter.ActorAlign.CENTER}));
            head.add_child(new St.Label({text: header, style_class: 'cm-hdr',
                y_align: Clutter.ActorAlign.CENTER}));
            actor.add_child(head);
            rows.forEach((row, i) => {
                if (i > 0)
                    actor.add_child(new St.Widget({style_class: 'cm-tline'}));
                actor.add_child(rowButton(row, onActivate));
            });
            actor.add_child(new St.Widget({style_class: 'cm-tline'}));
            const foot = new St.BoxLayout({style_class: 'cm-trow'});
            foot.add_child(cell(summary, 'cm-sec', false));
            actor.add_child(foot);
        },
    };
}
