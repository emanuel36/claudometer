#!/usr/bin/env bash
# Runs inside the container: installs the packed extension, starts a headless GNOME Shell, opens
# the popup on every tab, disables and enables the extension, and fails on any error it logs.
set -u
UUID=claudometer@emanuel36
EXT=$HOME/.local/share/gnome-shell/extensions/$UUID
DATA=$HOME/.local/share/$UUID

XDG_RUNTIME_DIR=$(mktemp -d)
export XDG_RUNTIME_DIR
# The shell and gsettings share one settings file, with no dconf service
export GSETTINGS_BACKEND=keyfile

mkdir -p "$EXT" "$HOME/.claude"
unzip -q /work/$UUID.shell-extension.zip -d "$EXT"
glib-compile-schemas "$EXT/schemas"
# A login the service rejects: the client sends one request, gets 401 and saves its cache
expires=$(( ($(date +%s) + 86400) * 1000 ))
printf '{"claudeAiOauth":{"accessToken":"claudometer-test","expiresAt":%s}}\n' "$expires" \
    > "$HOME/.claude/.credentials.json"
# A live session that waits for input: a process of the container, with its start time
mkdir -p "$HOME/.claude/sessions"
sleep 600 &
sleeper=$!
now_ms=$(date +%s%3N)
printf '{"pid":%s,"sessionId":"demo-session","procStart":"%s","kind":"interactive",' \
    "$sleeper" "$(awk '{print $22}' /proc/$sleeper/stat)" \
    > "$HOME/.claude/sessions/$sleeper.json"
printf '"name":"demo","status":"waiting","waitingFor":"input needed","startedAt":%s,' \
    "$now_ms" >> "$HOME/.claude/sessions/$sleeper.json"
printf '"statusUpdatedAt":%s}\n' "$now_ms" >> "$HOME/.claude/sessions/$sleeper.json"
gsettings set org.gnome.shell enabled-extensions "['$UUID']"
# The metadata lists only the versions already tested
gsettings set org.gnome.shell disable-extension-version-validation true
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
    # 1.0 is enabled (ACTIVE in GNOME 48+)
    echo "after start: $(state)"

    local button="Main.panel.statusArea['$UUID']" result fail=0
    for tab in Status Projects Activity Models; do
        result=$(eval_js "$button.menu.open(); $button._selectTab('$tab'); true")
        echo "open $tab: $result"
        [ "$result" = "(true, 'true')" ] || fail=1
        sleep 1
    done
    # Done sessions count as seen only while the Status tab shows: opened on it, or picked open
    result=$(eval_js "const b = $button, m = b._monitor; let n = 0; m.markSeen = () => n++; \
        b.menu.close(); b._selectTab('Projects'); b.menu.open(); \
        const other = n === 0 && b._freshSinceMs === Infinity; \
        b._selectTab('Status'); const picked = n === 1 && b._freshSinceMs < Infinity; \
        b.menu.close(); b._selectTab('Projects'); b._selectTab('Status'); const shut = n === 1; \
        b.menu.open(); const opened = n === 2; delete m.markSeen; \
        other && picked && shut && opened")
    echo "seen: $result"
    [ "$result" = "(true, 'true')" ] || fail=1
    # An unchanged listing keeps the rows, and closing the popup leaves them alone
    result=$(eval_js "const b = $button, v = b._sessionsView, kids = v.actor.get_children(); \
        b._showSessions(); const kept = v.actor.get_children().every((c, i) => c === kids[i]); \
        const update = v.update; let calls = 0; v.update = l => (calls++, update(l)); \
        b.menu.close(); b._showSessions(); v.update = update; \
        kids.length > 0 && kept && calls === 0")
    echo "redraw: $result"
    [ "$result" = "(true, 'true')" ] || fail=1
    result=$(eval_js "$button._monitor.listing(Date.now()).header === '1 WAITING FOR YOU' && \
        $button._sessionsView.actor.visible && \
        ($button._iconDot.visible || $button._labelDot.visible)")
    echo "sessions: $result"
    [ "$result" = "(true, 'true')" ] || fail=1
    # A notification that carries a focus token yields its target and never reaches the tray
    eval_js "globalThis.cmHit = null; const n = Main.messageTray.getSources().length; \
        globalThis.cmSources = n; $button._book.expect('cm-shell-test', 5000) \
        .then(x => (globalThis.cmHit = x?.target?.unpack() ?? -1)); true" > /dev/null
    gdbus call --session --dest org.gtk.Notifications --object-path /org/gtk/Notifications \
        --method org.gtk.Notifications.AddNotification com.mitchellh.ghostty cm \
        "{'title': <'Ghostty'>, 'body': <'cm-shell-test'>, \
        'default-action': <'app.present-surface'>, 'default-action-target': <uint64 42>}" \
        > /dev/null
    sleep 1
    result=$(eval_js "$button._catcher.available && globalThis.cmHit === 42 && \
        Main.messageTray.getSources().length === globalThis.cmSources")
    echo "catcher: $result"
    [ "$result" = "(true, 'true')" ] || fail=1
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
# an extension whose preferences only add an empty page.
if grep -E 'JS ERROR|JS WARNING|org\.gnome\.Shell\.Extensions.*(CRITICAL|WARNING)' bus.log \
    | grep -v 'Adw.PreferencesWindow::visible-page'; then
    echo 'FAIL: the preferences logged the lines above'
    fail=1
fi
kill "$sleeper"
[ $fail -eq 0 ] && echo 'PASS'
exit $fail
