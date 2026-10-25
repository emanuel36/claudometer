/** St building blocks shared by the popup tabs. */
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

/**
 * The block that replaces a tab's body when it has nothing to show: an icon, a title and one
 * line, centered in the tab area.
 *
 * Returns:
 *     `{actor, show({icon, title, line}), hide()}`. `show` takes one of `SCREEN_STATES`
 *     (status.js) or the result of `limitsScreen`.
 */
export function createStateBlock() {
    const actor = new St.BoxLayout({
        style_class: 'cm-state',
        vertical: true,
        x_expand: true,
        y_expand: true,
        visible: false,
    });
    // Takes the spare height of `actor`, so the three lines sit in its middle
    const content = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        y_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const icon = new St.Icon({
        icon_size: 28,
        style_class: 'cm-state-icon',
        x_align: Clutter.ActorAlign.CENTER,
    });
    const title = new St.Label({style_class: 'cm-state-title', x_align: Clutter.ActorAlign.CENTER});
    const line = new St.Label({style_class: 'cm-state-line', x_expand: true});
    line.clutter_text.line_wrap = true;
    line.clutter_text.line_alignment = Pango.Alignment.CENTER;
    content.add_child(icon);
    content.add_child(title);
    content.add_child(line);
    actor.add_child(content);

    return {
        actor,
        show({icon: iconName, title: titleText, line: lineText}) {
            icon.icon_name = iconName;
            title.set_text(titleText);
            line.set_text(lineText);
            actor.visible = true;
        },
        hide() {
            actor.visible = false;
        },
    };
}

/**
 * The line under every tab: the status of the limits on the left and the settings button on
 * the right.
 *
 * Args:
 *     settingsGicon: The settings button's icon.
 *     onSettings: Called when the settings button is clicked.
 *
 * Returns:
 *     `{actor, setStatus({icon, text})}`; `setStatus` takes the result of `statusLine`.
 */
export function createFooter(settingsGicon, onSettings) {
    const actor = new St.BoxLayout({style_class: 'cm-foot', x_expand: true});
    const status = new St.BoxLayout({style_class: 'cm-foot-status', x_expand: true,
        y_align: Clutter.ActorAlign.CENTER});
    const icon = new St.Icon({icon_size: 12, style_class: 'cm-foot-icon',
        y_align: Clutter.ActorAlign.CENTER});
    const text = new St.Label({style_class: 'cm-foot-text', y_align: Clutter.ActorAlign.CENTER});
    text.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    status.add_child(icon);
    status.add_child(text);
    actor.add_child(status);

    const settings = new St.Button({
        child: new St.Icon({gicon: settingsGicon, icon_size: 14}),
        style_class: 'cm-foot-button',
        y_align: Clutter.ActorAlign.CENTER,
        can_focus: true,
        reactive: true,
        track_hover: true,
        accessible_name: 'Settings',
    });
    settings.connect('clicked', () => onSettings());
    actor.add_child(settings);

    return {
        actor,
        setStatus({icon: iconName, text: statusText}) {
            icon.icon_name = iconName;
            text.set_text(statusText);
        },
    };
}
