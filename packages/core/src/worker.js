// Runs updateHistory in a worker thread, so reading a large history never blocks the editor.
import {parentPort, workerData} from 'node:worker_threads';

import {updateHistory} from './history.js';

updateHistory(workerData).then(
    state => parentPort.postMessage({ok: true, state}),
    e => parentPort.postMessage({ok: false, error: e.message}));
