// Run with: gjs -m tests/indexer-core.test.js
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';

import {loadIndex, updateIndex} from '../src/history/indexer-core.js';
import {rangeStart} from '../src/history/stats.js';
import {parseIndex} from '../src/history/transcripts.js';

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

const DAY = 86400000;
const now = Date.now();
const root = GLib.Dir.make_tmp('claude-index-XXXXXX');
let projects = `${root}/projects`;
const indexPath = `${root}/data/index.json`;
const summaryPath = `${root}/data/summary.json`;

function msgLine(id, out, t, cwd = '/work/billing') {
    return JSON.stringify({
        type: 'assistant', timestamp: new Date(t).toISOString(), cwd, gitBranch: 'main',
        isSidechain: false,
        message: {id, model: 'claude-opus-5-5', usage: {input_tokens: 1, output_tokens: out}},
    });
}

function write(rel, lines, {append = false, endNewline = true} = {}) {
    const path = `${projects}/${rel}`;
    GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o755);
    const text = lines.join('\n') + (endNewline ? '\n' : '');
    const file = Gio.File.new_for_path(path);
    const old = append ? new TextDecoder().decode(file.load_contents(null)[1]) : '';
    file.replace_contents(new TextEncoder().encode(old + text), null, false,
        Gio.FileCreateFlags.NONE, null);
    return path;
}

function setMtime(path, ms) {
    Gio.File.new_for_path(path).set_attribute_uint64('time::modified', Math.floor(ms / 1000),
        Gio.FileQueryInfoFlags.NONE, null);
}

const recent = now - 2 * DAY;

// first run: two files, repeated lines of one message, one id shared by both files
const a = write('p1/a.jsonl', [
    msgLine('m1', 5, recent), msgLine('m1', 60, recent + 1000), msgLine('m1', 200, recent + 2000),
    msgLine('m2', 40, recent + 3000), '{"type":"user"}',
]);
write('p2/sub/b.jsonl', [
    msgLine('m2', 40, recent + 4000, '/work/other'), msgLine('m3', 7, recent),
]);

let result = updateIndex(projects, indexPath, summaryPath);
check('first run reads both files', result, {records: 3, filesRead: 2});
const summary = () => [...loadIndex(summaryPath).values()];
check('the summary sums the messages per hour', summary().reduce((sum, b) => sum + b.out, 0),
    247);
check('the summary is smaller than the index', summary().length < loadIndex(indexPath).size,
    true);
let records = loadIndex(indexPath);
check('repeated lines give the largest output', records.get('m1').out, 200);
check('an id in two files is one record', [...records.keys()].sort(), ['m1', 'm2', 'm3']);

// second run without changes
check('unchanged files are not read again', updateIndex(projects, indexPath, summaryPath),
    {records: 3, filesRead: 0});

// append one message
write('p1/a.jsonl', [msgLine('m4', 11, recent + 5000)], {append: true});
check('an appended file is read again, adding one record',
    updateIndex(projects, indexPath, summaryPath), {records: 4, filesRead: 1});
check('re-reading does not double count', loadIndex(indexPath).get('m1').out, 200);

// a line cut off mid-write is skipped, then picked up once complete
const full = msgLine('m5', 33, recent + 6000);
write('p3/c.jsonl', [msgLine('m6', 1, recent), full.slice(0, full.length / 2)],
    {endNewline: false});
check('a truncated last line is skipped', updateIndex(projects, indexPath, summaryPath),
    {records: 5, filesRead: 1});
write('p3/c.jsonl', [msgLine('m6', 1, recent), full]);
check('the completed line is picked up on the next run',
    updateIndex(projects, indexPath, summaryPath),
    {records: 6, filesRead: 1});

// old files and old records are kept: the index covers all time
const old = write('p4/old.jsonl', [msgLine('m7', 9, now - 400 * DAY)]);
setMtime(old, now - 400 * DAY);
check('an old file is read', updateIndex(projects, indexPath, summaryPath).records, 7);
check('an old message stays in the index and the summary',
    [loadIndex(indexPath).has('m7'), summary().some(b => b.t < now - 399 * DAY)], [true, true]);

// corrupt index is rebuilt
GLib.file_set_contents(indexPath, '{nope');
result = updateIndex(projects, indexPath, summaryPath);
check('a corrupt index is rebuilt from the transcripts', result.records, 7);
const rebuiltText = new TextDecoder().decode(
    Gio.File.new_for_path(indexPath).load_contents(null)[1]);
check('the rebuilt index is valid JSON', typeof JSON.parse(rebuiltText), 'object');

// one unreadable transcript must not block the others
const locked = write('p6/locked.jsonl', [msgLine('m9', 9, recent)]);
GLib.chmod(locked, 0o000);
write('p7/ok.jsonl', [msgLine('m10', 12, recent)]);
let blocked = null;
try {
    blocked = updateIndex(projects, indexPath, summaryPath);
} catch (e) {
    blocked = e.message;
}
check('an unreadable file is skipped, the others are indexed',
    [typeof blocked, loadIndex(indexPath).has('m10'), loadIndex(indexPath).has('m9')],
    ['object', true, false]);
GLib.chmod(locked, 0o644);
check('the unreadable file is read once it can be', [
    updateIndex(projects, indexPath, summaryPath).filesRead, loadIndex(indexPath).has('m9'),
], [1, true]);

// the file list does not keep deleted transcripts
const text = () => new TextDecoder().decode(
    Gio.File.new_for_path(indexPath).load_contents(null)[1]);
check('the file list has the transcripts that exist', Object.keys(parseIndex(text()).files)
    .some(path => path.endsWith('p7/ok.jsonl')), true);
GLib.unlink(`${projects}/p7/ok.jsonl`);
updateIndex(projects, indexPath, summaryPath);
check('a deleted transcript leaves the file list', Object.keys(parseIndex(text()).files)
    .some(path => path.endsWith('p7/ok.jsonl')), false);

// missing projects directory
const missingIndex = `${root}/data/missing.json`;
const missingSummary = `${root}/data/missing-summary.json`;
check('a missing projects dir gives an empty index and summary',
    [updateIndex(`${root}/nope`, missingIndex, missingSummary),
        loadIndex(missingIndex).size, loadIndex(missingSummary).size],
    [{records: 0, filesRead: 0}, 0, 0]);

check('an index that does not exist loads as empty', loadIndex(`${root}/none.json`).size, 0);

// retention drops records before the first kept day, from the index and the summary
projects = `${root}/retention`;
const keptIndex = `${root}/data/kept-index.json`;
const keptSummary = `${root}/data/kept-summary.json`;
const firstKept = rangeStart(now, 182);
write('r/a.jsonl', [
    msgLine('r1', 1, firstKept - 1), msgLine('r2', 10, firstKept), msgLine('r3', 100, now - DAY),
]);
updateIndex(projects, keptIndex, keptSummary, 182, now);
check('retention keeps the first kept day', [...loadIndex(keptIndex).keys()].sort(),
    ['r2', 'r3']);
check('retention reaches the summary',
    [...loadIndex(keptSummary).values()].reduce((sum, b) => sum + b.out, 0), 110);
updateIndex(projects, keptIndex, keptSummary, 0, now);
check('forever drops nothing new', loadIndex(keptIndex).size, 2);

GLib.spawn_command_line_sync(`rm -rf ${root}`);
if (failures > 0) {
    print(`${failures} failed`);
    System.exit(1);
}
print('all passed');
