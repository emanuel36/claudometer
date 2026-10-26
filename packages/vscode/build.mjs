// Bundles the extension, the history worker and the panel script into dist/, and copies the
// license the package needs.
import {copyFile} from 'node:fs/promises';

import * as esbuild from 'esbuild';

await copyFile('../../LICENSE', 'LICENSE');

const node = {bundle: true, platform: 'node', format: 'cjs', target: 'node18', logLevel: 'info'};

await Promise.all([
    esbuild.build({...node, entryPoints: ['src/extension.js'], outfile: 'dist/extension.cjs',
        external: ['vscode']}),
    esbuild.build({...node, entryPoints: ['../core/src/worker.js'], outfile: 'dist/worker.cjs'}),
    esbuild.build({bundle: true, platform: 'browser', format: 'iife', target: 'es2022',
        logLevel: 'info', entryPoints: ['src/webview/panel.js'], outfile: 'dist/panel.js'}),
]);
