#!/usr/bin/env -S gjs -m
// Helper process: gjs -m indexer.js <projectsDir> <indexPath> <summaryPath> [keepDays]
// Keeps the transcript index up to date. It runs apart from GNOME Shell because the first run
// reads a lot of data.
import System from 'system';

import {updateIndex} from './indexer-core.js';

const [projectsDir, indexPath, summaryPath, keepArg] = ARGV;
const keepDays = Number.parseInt(keepArg ?? '0', 10) || 0;
if (!projectsDir || !indexPath || !summaryPath) {
    printerr('usage: indexer.js <projectsDir> <indexPath> <summaryPath>');
    System.exit(1);
}

try {
    updateIndex(projectsDir, indexPath, summaryPath, keepDays);
} catch (e) {
    printerr(`indexer: ${e.message}`);
    System.exit(1);
}
