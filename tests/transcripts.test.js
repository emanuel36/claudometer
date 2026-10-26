// Run with: gjs -m tests/transcripts.test.js
import System from 'system';

import {
    mergeMessage, parseIndex, parseTranscriptLine, serializeIndex,
} from '../src/history/transcripts.js';

let failures = 0;

function check(name, actual, expected) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
        print(`ok   ${name}`);
    } else {
        failures++;
        print(`FAIL ${name}\n     expected ${e}\n     got      ${a}`);
    }
}

const TS = '2026-10-22T14:00:00.000Z';

function line(overrides = {}, usage = {}) {
    return JSON.stringify({
        type: 'assistant',
        timestamp: TS,
        cwd: '/home/u/billing-api',
        gitBranch: 'main',
        isSidechain: false,
        message: {
            id: 'msg_1',
            model: 'claude-opus-5-5',
            usage: {
                input_tokens: 10,
                output_tokens: 200,
                cache_read_input_tokens: 5000,
                cache_creation_input_tokens: 300,
                ...usage,
            },
        },
        ...overrides,
    });
}

function record(overrides = {}) {
    return {
        id: 'msg_1', t: Date.parse(TS), model: 'claude-opus-5-5', out: 200, input: 10,
        cacheRead: 5000, cacheWrite: 300, cwd: '/home/u/billing-api', branch: 'main',
        sidechain: false, ...overrides,
    };
}

// parseTranscriptLine
check('sample line parses', parseTranscriptLine(line()), record());

const noId = JSON.parse(line({uuid: 'uuid-9'}));
delete noId.message.id;
check('uuid is the id when the message has none',
    parseTranscriptLine(JSON.stringify(noId))?.id, 'uuid-9');

const noIdAtAll = JSON.parse(line());
delete noIdAtAll.message.id;
check('no id and no uuid is skipped', parseTranscriptLine(JSON.stringify(noIdAtAll)), null);

check('user line is skipped', parseTranscriptLine(line({type: 'user'})), null);

const noUsage = JSON.parse(line());
delete noUsage.message.usage;
check('line without usage is skipped', parseTranscriptLine(JSON.stringify(noUsage)), null);

const synthetic = JSON.parse(line());
synthetic.message.model = '<synthetic>';
check('synthetic model is skipped', parseTranscriptLine(JSON.stringify(synthetic)), null);
check('zero output is skipped', parseTranscriptLine(line({}, {output_tokens: 0})), null);
check('invalid JSON is skipped', parseTranscriptLine('{nope'), null);
check('truncated JSON is skipped',
    parseTranscriptLine(line().slice(0, Math.floor(line().length / 2))), null);
check('sidechain flag is kept', parseTranscriptLine(line({isSidechain: true}))?.sidechain, true);

// mergeMessage
const small = record({out: 5, input: 1, cacheRead: 10, cacheWrite: 2, t: Date.parse(TS) + 5000});
const big = record();
for (const order of [[small, big], [big, small]]) {
    const records = new Map();
    for (const r of order)
        mergeMessage(records, r);
    check(`larger output wins whatever the order (${order[0].out} first)`,
        records.get('msg_1'), record({t: Date.parse(TS)}));
}

const other = new Map();
mergeMessage(other, big);
mergeMessage(other, record({id: 'msg_2'}));
check('different ids are separate entries', other.size, 2);

const twice = new Map();
mergeMessage(twice, big);
mergeMessage(twice, big);
check('merging the same record twice is idempotent', [twice.size, twice.get('msg_1')],
    [1, big]);

// index round trip
const files = {'/x/a.jsonl': {mtime: 5, size: 7}};
const records = new Map([['msg_1', big], ['msg_2', record({id: 'msg_2', sidechain: true})]]);
const parsed = parseIndex(serializeIndex(files, records));
check('index round trip', [parsed.files, [...parsed.records.values()]],
    [files, [...records.values()]]);

// the cost of Cursor's events is an extra last column
const priced = new Map([['a', record({id: 'a', cents: 53.5})], ['b', record({id: 'b'})]]);
const pricedText = JSON.parse(serializeIndex({}, priced)).records;
check('a cost is the last column, and only when there is one',
    [pricedText[0].length, pricedText[0][10], pricedText[1].length], [11, 53.5, 10]);
check('the cost round trips', [...parseIndex(serializeIndex({}, priced)).records.values()]
    .map(r => r.cents), [53.5, undefined]);
check('an index without costs is as before', 'cents' in
    [...parseIndex(serializeIndex(files, records)).records.values()][0], false);

for (const [name, text] of [['empty', ''], ['invalid JSON', '{nope'], ['array', '[]'],
    ['other version', '{"version":2,"files":{},"records":[]}']]) {
    const p = parseIndex(text);
    check(`${name} index is empty`, [p.files, p.records.size], [{}, 0]);
}

const bad = parseIndex(JSON.stringify({
    version: 1, files: {},
    records: [['ok', 1, 'm', 5, 0, 0, 0, '/p', 'main', false],
        ['bad-t', null, 'm', 5, 0, 0, 0, '/p', 'main', false],
        ['bad-out', 1, 'm', 'x', 0, 0, 0, '/p', 'main', false]],
}));
check('records with non-finite numbers are dropped', [...bad.records.keys()], ['ok']);

if (failures > 0) {
    print(`${failures} failed`);
    System.exit(1);
}
print('all passed');
