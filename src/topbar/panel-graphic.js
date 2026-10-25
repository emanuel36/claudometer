import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {drawPanelGraphic, graphicSize} from './panel.js';

/**
 * The bar or ring drawn before the top bar label.
 *
 * Returns:
 *     `{actor, update(style, values, colors)}`. The actor is hidden for the percentage
 *     style; `update` resizes it for the style and number of values and repaints it.
 */
export function createPanelGraphic() {
    let state = {style: 'percentage', values: [], colors: []};
    const actor = new St.DrawingArea({
        style_class: 'cm-panel-graphic',
        y_align: Clutter.ActorAlign.CENTER,
        visible: false,
    });
    actor.connect('repaint', () => {
        const cr = actor.get_context();
        drawPanelGraphic(cr, state.style, state.values, state.colors);
        cr.$dispose();
    });

    const update = (style, values, colors) => {
        state = {style, values, colors};
        const [width, height] = graphicSize(style, values.length);
        actor.visible = width > 0;
        if (!actor.visible)
            return;
        actor.set_size(width, height);
        actor.queue_repaint();
    };
    return {actor, update};
}
