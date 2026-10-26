import path from 'node:path';

import {DEFAULTS, readJson, writeAtomically} from '@claudometer/core';

const configPath = dataDir => path.join(dataDir, 'config.json');

/** Returns: The CLI's settings: `config.json` in the data folder over the defaults. */
export async function readConfig(dataDir) {
    return {...DEFAULTS, ...await readJson(configPath(dataDir))};
}

/** Saves the given settings, keeping the others. */
export async function updateConfig(dataDir, changes) {
    const saved = await readJson(configPath(dataDir)) ?? {};
    await writeAtomically(configPath(dataDir), `${JSON.stringify({...saved, ...changes}, null, 2)}\n`);
}
