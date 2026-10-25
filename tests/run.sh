#!/usr/bin/env bash
# Runs every test under plain gjs from the repository root. Prints one line per test file, and
# the full output of the first one that fails.
cd "$(dirname "$0")/.." || exit 1
for test in tests/*.test.js; do
    if output=$(gjs -m "$test" 2>&1); then
        echo "ok    $test"
    else
        echo "FAIL  $test"
        echo "$output"
        exit 1
    fi
done
