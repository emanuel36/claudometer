#!/usr/bin/env bash
# Runs inside the container: checks that install.sh refuses a GNOME Shell version it does not
# support, or cannot read, before it downloads or creates anything.
set -u
INSTALL=/work/install.sh
UUID=claudometer@emanuel36

tmp=$(mktemp -d)
mkdir "$tmp/fake" "$tmp/bare"
# The shell is not found with only these tools on PATH
for tool in sh sed cat mktemp; do
    ln -s "$(command -v "$tool")" "$tmp/bare/$tool"
done

failed=0

# check <case> <fake gnome-shell output, or - for none> <stderr fragment, or ! for none refused>
check() {
    local name=$1 output=$2 expect=$3
    local home=$tmp/home-$RANDOM status path=$PATH
    mkdir -p "$home"
    rm -f "$tmp/fake/gnome-shell"
    if [ "$output" = - ]; then
        path=$tmp/bare
    else
        printf '#!/bin/sh\nprintf "%%s\\n" "$FAKE_OUTPUT"\n' > "$tmp/fake/gnome-shell"
        chmod +x "$tmp/fake/gnome-shell"
        path=$tmp/fake:$PATH
    fi
    env PATH="$path" HOME="$home" XDG_DATA_HOME="$home/data" FAKE_OUTPUT="$output" \
        CLAUDOMETER_URL=file:///nonexistent.tar.gz /bin/sh "$INSTALL" \
        > /dev/null 2> "$tmp/stderr"
    status=$?
    local errors
    errors=$(cat "$tmp/stderr")
    local ok=1
    [ $status -ne 0 ] || ok=
    if [ "$expect" = '!' ]; then
        # Got past the version check and failed on the download
        case $errors in *'not supported'* | *'Cannot tell'*) ok= ;; esac
    else
        case $errors in *"$expect"*) ;; *) ok= ;; esac
    fi
    [ ! -e "$home/data/gnome-shell/extensions/$UUID" ] || ok=
    if [ -n "$ok" ]; then
        echo "ok   $name"
    else
        echo "FAIL $name (exit $status): $errors"
        failed=1
    fi
}

check 'too old' 'GNOME Shell 41.0' 'GNOME Shell 41 is not supported'
check 'too new' 'GNOME Shell 52.0' 'GNOME Shell 52 is not supported'
check 'unreadable' 'something else' 'Cannot tell the GNOME Shell version'
check 'missing' - 'GNOME Shell was not found'
check 'warning first' $'warning: x\nGNOME Shell 46.0' '!'

rm -rf "$tmp"
exit $failed
