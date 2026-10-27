// The Extension and ExtensionPreferences classes GNOME Shell 45 added, for 42 to 44. The
// converter copies it to src-legacy/shim.js as is, so it is written in the pre-45 format.
/* exported Extension, ExtensionPreferences */
const ExtensionUtils = imports.misc.extensionUtils;

var Extension = class Extension {
    /**
     * Args:
     *   metadata: The extension's metadata.json, as an object.
     */
    constructor(metadata) {
        this.metadata = metadata;
        this.uuid = metadata.uuid;
        this.path = ExtensionUtils.getCurrentExtension().path;
    }

    getSettings() {
        return ExtensionUtils.getSettings();
    }

    openPreferences() {
        ExtensionUtils.openPrefs();
    }
};

var ExtensionPreferences = Extension;
