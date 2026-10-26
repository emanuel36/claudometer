#!/usr/bin/env bash
# Loads the packed extension in a headless GNOME Shell, in a Fedora container, for each GNOME
# version given (default: those in metadata.json). Needs Docker. Usage: tests/shell/run.sh [46 47 …]
set -u
cd "$(dirname "$0")/../.." || exit 1

declare -A FEDORA=([46]=40 [47]=41 [48]=42 [49]=43 [50]=44 [51]=45)
versions=("$@")
[ ${#versions[@]} -eq 0 ] &&
    mapfile -t versions < <(grep -o '"shell-version": \[[^]]*' metadata.json | grep -o '[0-9]\+')

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
gnome-extensions pack --force --extra-source=src --extra-source=icons -o "$work" > /dev/null

failed=()
for version in "${versions[@]}"; do
    release=${FEDORA[$version]:?unknown GNOME version $version}
    image=claudometer-shell:$version
    echo "== GNOME $version (Fedora $release)"
    docker build --quiet --build-arg BASE=fedora:$release -t "$image" \
        -f tests/shell/Containerfile tests/shell > /dev/null \
        || { failed+=("$version"); continue; }
    docker run --rm -v "$work:/work:ro" -v "$PWD/tests/shell/check.sh:/check.sh:ro" "$image" \
        bash /check.sh || failed+=("$version")
done

if [ ${#failed[@]} -gt 0 ]; then
    echo "Failed: ${failed[*]}"
    exit 1
fi
