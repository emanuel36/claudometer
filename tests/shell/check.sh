#!/usr/bin/env bash
# Runs inside the container: installs the extension with install.sh, starts a headless GNOME
# Shell, opens the popup on every tab, disables and enables the extension, and fails on any
# error it logs.
set -u
UUID=claudometer@emanuel36
DATA=$HOME/.local/share/$UUID

XDG_RUNTIME_DIR=$(mktemp -d)
export XDG_RUNTIME_DIR
# The shell and gsettings share one settings file, with no dconf service
export GSETTINGS_BACKEND=keyfile
# There is no accessibility bus, and GTK warns about it
export GTK_A11Y=none

mkdir -p "$HOME/.claude"
CLAUDOMETER_URL=file:///work/claudometer.tar.gz sh /work/install.sh
# A login the service rejects: the client sends one request, gets 401 and saves its cache
expires=$(( ($(date +%s) + 86400) * 1000 ))
printf '{"claudeAiOauth":{"accessToken":"claudometer-test","expiresAt":%s}}\n' "$expires" \
    > "$HOME/.claude/.credentials.json"
# With no layout set, GNOME 47 asks localed for one and crashes when it is missing
gsettings set org.gnome.desktop.input-sources sources "[('xkb', 'us')]"

session() {
    eval_js() {
        gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
            --method org.gnome.Shell.Eval "$1" 2>&1
    }
    state() {
        gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
            --method org.gnome.Shell.Extensions.GetExtensionInfo "$UUID" \
            | grep -o "'state': <[0-9.]*>"
    }

    # There is no system bus in the container; the shell only needs one to connect to
    DBUS_SYSTEM_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS \
        gnome-shell --headless --wayland --unsafe-mode --virtual-monitor 1280x800 \
        > shell.log 2>&1 &
    local up=
    for _ in $(seq 60); do
        eval_js 'true' | grep -q "(true, 'true')" && up=1 && break
        sleep 1
    done
    if [ -z "$up" ]; then
        echo 'FAIL: the shell did not start'
        tail -20 shell.log
        return 1
    fi
    gnome-shell --version
    # The shell answers before it has enabled the extensions
    for _ in $(seq 30); do
        [ -n "$(state)" ] && break
        sleep 1
    done
    # 1.0 is enabled (ACTIVE in GNOME 48+)
    echo "after start: $(state)"

    local button="Main.panel.statusArea['$UUID']" result fail=0
    for tab in Limits Projects Activity Models; do
        result=$(eval_js "$button.menu.open(); $button._selectTab('$tab'); true")
        echo "open $tab: $result"
        [ "$result" = "(true, 'true')" ] || fail=1
        sleep 1
    done
    eval_js "$button.menu.close(); true" > /dev/null
    for _ in $(seq 20); do
        [ -s "$DATA/usage.json" ] && break
        sleep 1
    done
    if [ ! -s "$DATA/usage.json" ]; then
        echo 'FAIL: the usage cache was not written'
        fail=1
    fi
    local before
    before=$(cat "$DATA/usage.json" 2>/dev/null)

    # The same path as a screen lock and unlock
    eval_js "Main.extensionManager.disableExtension('$UUID')" > /dev/null
    sleep 2
    eval_js "Main.extensionManager.enableExtension('$UUID')" > /dev/null
    sleep 5
    echo "after disable and enable: $(state)"
    if [ "$(cat "$DATA/usage.json")" = "$before" ]; then
        echo 'no request after enable: the cache is unchanged'
    else
        echo 'FAIL: the extension asked the service again after enable'
        fail=1
    fi

    # The preferences run in their own process, which draws on the headless shell
    dbus-update-activation-environment WAYLAND_DISPLAY=wayland-0
    gnome-extensions prefs $UUID
    local titles
    for _ in $(seq 20); do
        titles=$(eval_js 'global.display.list_all_windows().map(w => w.get_title()).join()')
        [[ $titles == *Claudometer* ]] && break
        sleep 1
    done
    if [[ $titles == *Claudometer* ]]; then
        echo 'preferences window open'
    else
        echo "FAIL: no preferences window: $titles"
        fail=1
    fi
    kill %1
    wait
    return $fail
}
export -f session
export UUID DATA
dbus-run-session -- bash -c session 2> bus.log
fail=$?

if grep -iE 'JS ERROR|JS WARNING|claudometer' shell.log \
    | grep -v 'Cannot reach the usage service'; then
    echo 'FAIL: the shell logged the lines above'
    fail=1
fi
# Services started on the bus, the preferences among them, log to the bus's output. From GNOME
# 48 on, the preferences app itself warns about Adw.PreferencesWindow:visible-page, even for
# an extension whose preferences only add an empty page. Before that, it warns that its window
# is 6 px wider than the 640 px the headless monitor leaves it.
if grep -E 'JS ERROR|JS WARNING|org\.gnome\.Shell\.Extensions.*(CRITICAL|WARNING)' bus.log \
    | grep -v -e 'Adw.PreferencesWindow::visible-page' -e 'exceeds AdwBreakpointBin width'; then
    echo 'FAIL: the preferences logged the lines above'
    fail=1
fi
[ $fail -eq 0 ] && echo 'PASS'
exit $fail
