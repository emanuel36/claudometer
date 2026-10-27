#!/usr/bin/env bash
# Installs the extension with install.sh and loads it in a headless GNOME Shell, in an Ubuntu
# container, for each GNOME version given (default: all in UBUNTU). Needs Docker.
# Usage: tests/shell/run.sh [46 47 …]
set -u
cd "$(dirname "$0")/../.." || exit 1

# The Ubuntu release that ships each GNOME version: the one list of versions tested
declare -A UBUNTU=([46]=24.04 [47]=24.10 [48]=25.04 [49]=25.10 [50]=26.04 [51]=26.10)
versions=("$@")
[ ${#versions[@]} -eq 0 ] && mapfile -t versions < <(printf '%s\n' "${!UBUNTU[@]}" | sort -n)

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
# The same layout as the archive install.sh downloads from GitHub
tar -czf "$work/claudometer.tar.gz" --exclude=.git --exclude=node_modules --exclude=dist \
    --transform 's#^\.#claudometer-main#' .
cp install.sh "$work/"
# The container user is not the owner, and mktemp makes the folder private
chmod -R a+rX "$work"

failed=()
for version in "${versions[@]}"; do
    release=${UBUNTU[$version]:?unknown GNOME version $version}
    image=claudometer-shell:$version
    echo "== GNOME $version (Ubuntu $release)"
    docker build --quiet --build-arg BASE=ubuntu:$release -t "$image" \
        -f tests/shell/Containerfile tests/shell > /dev/null \
        || { failed+=("$version"); continue; }
    docker run --rm -v "$work:/work:ro" -v "$PWD/tests/shell/check.sh:/check.sh:ro" "$image" \
        bash /check.sh || failed+=("$version")
done

if [ ${#failed[@]} -gt 0 ]; then
    echo "Failed: ${failed[*]}"
    exit 1
fi
