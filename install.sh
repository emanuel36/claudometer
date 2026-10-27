#!/bin/sh
# Installs or updates Claudometer from the main branch on GitHub:
#   curl -fsSL https://raw.githubusercontent.com/emanuel36/claudometer/main/install.sh | sh
set -eu

UUID=claudometer@emanuel36
URL=${CLAUDOMETER_URL:-https://github.com/emanuel36/claudometer/archive/refs/heads/main.tar.gz}
EXTENSIONS=${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions
DEST=$EXTENSIONS/$UUID
# The GNOME Shell versions the extension supports
MIN_SHELL=45
MAX_SHELL=51

fail() {
    echo "Claudometer: $*" >&2
    exit 1
}

command -v gnome-shell >/dev/null ||
    fail "GNOME Shell was not found. Claudometer is a GNOME Shell extension."
version=$(gnome-shell --version 2>/dev/null || true)
# The first line that reads "GNOME Shell <version>"; others may be warnings
shell_major=$(echo "$version" | sed -n '/^GNOME Shell [0-9]/{s/^GNOME Shell \([0-9]*\).*/\1/p;q;}')
[ -n "$shell_major" ] || fail "Cannot tell the GNOME Shell version from: ${version:-(no output)}"
if [ "$shell_major" -lt "$MIN_SHELL" ] || [ "$shell_major" -gt "$MAX_SHELL" ]; then
    fail "GNOME Shell $shell_major is not supported;" \
        "Claudometer needs GNOME Shell $MIN_SHELL to $MAX_SHELL."
fi

for tool in curl tar glib-compile-schemas gsettings; do
    command -v "$tool" >/dev/null || fail "$tool is needed but was not found."
done
if [ -L "$DEST" ]; then
    fail "$DEST is a link to a source folder; update it with git pull there instead."
fi

mkdir -p "$EXTENSIONS"
STAGE=$(mktemp -d "$EXTENSIONS/.$UUID.XXXXXX")
trap 'rm -rf "$STAGE"' EXIT

echo "Downloading Claudometer…"
curl -fsSL "$URL" | tar -xz -C "$STAGE" --strip-components=1
mkdir "$STAGE/$UUID"
for item in extension.js prefs.js metadata.json stylesheet.css schemas src icons LICENSE; do
    mv "$STAGE/$item" "$STAGE/$UUID/"
done
glib-compile-schemas "$STAGE/$UUID/schemas"

rm -rf "$DEST"
mv "$STAGE/$UUID" "$DEST"

# The running shell does not know a new extension yet, so add it to the enabled list directly;
# it starts after the shell restarts. The disabled list wins over the enabled one, and turning
# the extension off in the Extensions app puts it there, so take it out of that list too.
enabled=$(gsettings get org.gnome.shell enabled-extensions)
case $enabled in
    *"'$UUID'"*) ;;
    "@as []") gsettings set org.gnome.shell enabled-extensions "['$UUID']" ;;
    *) gsettings set org.gnome.shell enabled-extensions "${enabled%]}, '$UUID']" ;;
esac
disabled=$(gsettings get org.gnome.shell disabled-extensions)
case $disabled in
    *"'$UUID'"*)
        gsettings set org.gnome.shell disabled-extensions \
            "$(echo "$disabled" | sed "s/, '$UUID'//; s/'$UUID', //; s/'$UUID'//")" ;;
esac

echo "Claudometer is installed in $DEST."
if [ "${XDG_SESSION_TYPE:-}" = x11 ]; then
    echo "Restart GNOME Shell to start it: press Alt+F2, type r and press Enter."
else
    echo "Log out and back in to start it."
fi
