// Runs the tests in tests/ that need no gi:// module under Node, one line per file, like
// tests/run.sh does under gjs.
import {execFileSync} from 'node:child_process';
import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const compat = pathToFileURL(path.join(root, 'packages/scripts/gjs-compat.mjs')).href;
let failed = false;
for (const name of readdirSync(path.join(root, 'tests')).filter(f => f.endsWith('.test.js'))) {
    const file = path.join(root, 'tests', name);
    if (readFileSync(file, 'utf8').includes("from 'gi://")) {
        console.log(`skip  tests/${name} (needs gjs)`);
        continue;
    }
    try {
        execFileSync(process.execPath, ['--import', compat, file], {cwd: root, stdio: 'pipe'});
        console.log(`ok    tests/${name}`);
    } catch (e) {
        console.log(`FAIL  tests/${name}`);
        console.log(e.stdout?.toString().split('\n').filter(l => l.startsWith('FAIL') ||
            l.startsWith('     ')).join('\n'));
        failed = true;
    }
}
process.exit(failed ? 1 : 0);
