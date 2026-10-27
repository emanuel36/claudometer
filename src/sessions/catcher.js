// Swallows the desktop notifications Ghostty sends back for a focus token, inside the shell's
// own org.gtk.Notifications service, before any source or banner exists for them.
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';

import {swallowTokens} from './focus.js';

/**
 * Hands each incoming GTK notification to a `TokenBook`, and drops the ones it claims.
 */
export class NotificationCatcher {
    /**
     * Args:
     *     book: the `TokenBook` that tells which notifications to swallow.
     */
    constructor(book) {
        const daemon = Main.notificationDaemon?._gtkNotificationDaemon;
        /** Whether notifications can be swallowed; without it, nothing may be written. */
        this.available = typeof daemon?.AddNotificationAsync === 'function';
        this._injections = null;
        if (!this.available)
            return;

        // The D-Bus wrapper looks the method up on the instance at call time
        this._injections = new InjectionManager();
        this._injections.overrideMethod(daemon, 'AddNotificationAsync',
            original => swallowTokens(book, original));
    }

    destroy() {
        this._injections?.clear();
        this._injections = null;
        this.available = false;
    }
}
