// The usage panel's script, bundled for the webview. It only draws the state the extension
// posts; every name in it comes from the user's folders, so text is set with textContent.
import {formatTokens} from '../../../../src/history/stats.js';

const vscode = acquireVsCodeApi();
const ACCENT = '#d97757';
// The GNOME popup's colors (src/popup/views.js), checked for color-blind separation
const FAMILY_COLORS = {
    opus: '#c98500', sonnet: '#3987e5', haiku: '#008300', fable: '#d55181', other: '#8a8a8a',
};
const PROJECT_COLORS = ['#d97757', '#e59a80', '#f0bea9', '#9a9a9a'];
const OTHER_COLOR = '#4a4a4a';
const ICONS = {
    Limits: '<path d="M1.5 11a6.5 6.5 0 0 1 13 0h-2a4.5 4.5 0 0 0-9 0z"/><rect x="7.4" y="5.6" width="1.2" height="6" rx="0.6" transform="rotate(40 8 11)"/><circle cx="8" cy="11" r="1.4"/>',
    Projects: '<path d="M2.5 3h3.8l1.6 1.6h5.6a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/>',
    Activity: '<rect x="2" y="8" width="3" height="6" rx="1"/><rect x="6.5" y="3" width="3" height="11" rx="1"/><rect x="11" y="6" width="3" height="8" rx="1"/>',
    Models: '<path fill-rule="evenodd" d="M4.5 3.5h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1zM6 6v4h4V6z"/><rect x="5.5" y="1" width="1.2" height="2" rx="0.5"/><rect x="9.3" y="1" width="1.2" height="2" rx="0.5"/><rect x="5.5" y="13" width="1.2" height="2" rx="0.5"/><rect x="9.3" y="13" width="1.2" height="2" rx="0.5"/><rect x="1" y="5.5" width="2" height="1.2" rx="0.5"/><rect x="1" y="9.3" width="2" height="1.2" rx="0.5"/><rect x="13" y="5.5" width="2" height="1.2" rx="0.5"/><rect x="13" y="9.3" width="2" height="1.2" rx="0.5"/>',
    Settings: '<path fill-rule="evenodd" d="M6.8 1h2.4l.4 1.9 1.3.6 1.6-1.1 1.7 1.7-1.1 1.6.6 1.3 1.9.4v2.4l-1.9.4-.6 1.3 1.1 1.6-1.7 1.7-1.6-1.1-1.3.6-.4 1.9H6.8l-.4-1.9-1.3-.6-1.6 1.1-1.7-1.7 1.1-1.6-.6-1.3L1 9.2V6.8l1.9-.4.6-1.3-1.1-1.6 1.7-1.7 1.6 1.1 1.3-.6zM8 5.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z"/>',
};
const SOURCE_LABELS = {all: 'All', claude: 'Claude Code', cursor: 'Cursor'};
const RANGE_LABELS = {today: 'Today', '7d': '7d', '30d': '30d', '6m': '6m', all: 'All'};
const ACTIVITY_RANGES = ['7d', '30d', '6m', 'all'];
const LIST_RANGES = ['today', '7d', '30d', 'all'];
const SCREENS = {
    loading: {icon: 'Activity', title: 'Reading your activity',
        line: 'This takes about a minute the first time.'},
    empty: {icon: 'Activity', title: 'No activity yet',
        line: 'Use Claude Code or Cursor and it will show up here.'},
};

// Projects whose models are folded away, by folder
const folded = new Set();

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className)
        node.className = className;
    if (text !== undefined)
        node.textContent = text;
    return node;
}

function icon(name, size = 16) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('aria-hidden', 'true');
    const parsed = new DOMParser().parseFromString(
        `<svg xmlns="http://www.w3.org/2000/svg">${ICONS[name]}</svg>`, 'image/svg+xml');
    for (const child of [...parsed.documentElement.childNodes])
        svg.appendChild(document.importNode(child, true));
    return svg;
}

const select = (key, value) => vscode.postMessage({type: 'select', key, value});
const command = name => vscode.postMessage({type: 'command', command: name});
const percent = share => `${Math.round(share * 100)}%`;

function tabBar(state) {
    const bar = el('div', 'tabs');
    bar.setAttribute('role', 'tablist');
    for (const tab of state.tabs) {
        const button = el('button', `tab${tab === state.tab ? ' selected' : ''}`);
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-selected', String(tab === state.tab));
        button.append(icon(tab), el('span', 'tab-label', tab));
        button.addEventListener('click', () => select('tab', tab));
        bar.append(button);
    }
    return bar;
}

function switcher(options, current, labels, onPick) {
    const group = el('div', 'switch');
    for (const option of options) {
        const button = el('button', `switch-button${option === current ? ' selected' : ''}`,
            labels[option]);
        button.setAttribute('aria-pressed', String(option === current));
        button.addEventListener('click', () => onPick(option));
        group.append(button);
    }
    return group;
}

function screen({icon: name, title, line}) {
    const block = el('div', 'state');
    block.append(icon(name, 28), el('div', 'state-title', title), el('div', 'state-line', line));
    return block;
}

function meter(share) {
    const track = el('div', 'meter');
    const fill = el('div', 'meter-fill');
    fill.style.width = `${Math.min(100, Math.max(0, share * 100))}%`;
    track.append(fill);
    return track;
}

function limitsTab(state) {
    const {rows, stale, screen: blocked} = state.limits;
    if (blocked)
        return screen({...blocked, icon: 'Limits'});
    const table = el('div', `limits${stale ? ' stale' : ''}`);
    const head = el('div', 'limits-row hdr');
    head.append(el('span', '', 'LIMIT'), el('span'), el('span', 'num', 'USED'),
        el('span', 'num', 'LEFT'));
    table.append(head);
    for (const row of rows) {
        const line = el('div', `limits-row${row.source === 'cursor' ? ' fresh' : ''}`);
        line.append(el('span', 'name', row.name), meter(row.percent / 100),
            el('span', 'val num', `${Math.round(row.percent)}%`),
            el('span', 'sec num', row.left));
        table.append(line);
    }
    return table;
}

function stack(parts) {
    const bar = el('div', 'stack');
    for (const {share, color} of parts) {
        if (share <= 0)
            continue;
        const part = el('div', 'stack-part');
        part.style.flexGrow = String(share);
        part.style.backgroundColor = color;
        bar.append(part);
    }
    return bar;
}

function shareRow(color, label, share, out, className = '') {
    const row = el('div', `share-row ${className}`);
    const square = el('span', 'square');
    if (color)
        square.style.backgroundColor = color;
    else
        square.classList.add('none');
    row.append(square, el('span', 'name', label), el('span', 'sec num', percent(share)),
        el('span', 'val num', formatTokens(out)));
    return row;
}

function shareHeader(first) {
    const head = el('div', 'share-row hdr');
    head.append(el('span', 'square none'), el('span', 'name', first), el('span', 'num', 'SHARE'),
        el('span', 'num', 'TOKENS'));
    return head;
}

function listsHeader(state, view) {
    const box = el('div');
    box.append(switcher(LIST_RANGES, state.listsRange, RANGE_LABELS,
        range => select('listsRange', range)));
    const head = el('div', 'hdr range-head');
    head.append(el('span', '', view.header), el('span', '', formatTokens(view.total)));
    box.append(head);
    return box;
}

function projectsTab(state) {
    const view = state.views?.projects;
    if (!view)
        return screen(SCREENS.loading);
    const box = el('div');
    box.append(listsHeader(state, view));
    if (view.total === 0) {
        box.append(screen(SCREENS.empty));
        return box;
    }
    const projects = view.other ? [...view.rows, {cwd: '\0other', label: 'Other', ...view.other}]
        : view.rows;
    const colorOf = i => projects[i].cwd === '\0other' ? OTHER_COLOR : PROJECT_COLORS[i];
    box.append(stack(projects.map((row, i) => ({share: row.share, color: colorOf(i)}))));
    box.append(shareHeader('PROJECT'));
    projects.forEach((row, i) => {
        const open = !folded.has(row.cwd);
        const line = shareRow(colorOf(i), row.label, row.share, row.out, 'project');
        line.setAttribute('role', 'button');
        line.setAttribute('aria-expanded', String(open));
        line.tabIndex = 0;
        line.title = row.cwd === '\0other' ? 'Every other project' : row.cwd || state.noProject;
        const toggle = () => {
            if (open)
                folded.add(row.cwd);
            else
                folded.delete(row.cwd);
            render(lastState);
        };
        line.addEventListener('click', toggle);
        line.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggle();
            }
        });
        box.append(line);
        if (open) {
            for (const model of row.models)
                box.append(shareRow(null, model.label, model.share, model.out, 'model'));
        }
    });
    return box;
}

function modelsTab(state) {
    const view = state.views?.models;
    if (!view)
        return screen(SCREENS.loading);
    const box = el('div');
    box.append(listsHeader(state, view));
    if (view.total === 0) {
        box.append(screen(SCREENS.empty));
        return box;
    }
    box.append(stack(view.rows.map(row => ({share: row.share, color: FAMILY_COLORS[row.family]}))));
    box.append(shareHeader('MODEL'));
    for (const row of view.rows)
        box.append(shareRow(FAMILY_COLORS[row.family], row.label, row.share, row.out));
    return box;
}

function activityTab(state) {
    const view = state.views?.activity;
    if (!view)
        return screen(SCREENS.loading);
    const box = el('div');
    box.append(switcher(ACTIVITY_RANGES, state.activityRange, RANGE_LABELS,
        range => select('activityRange', range)));
    const head = el('div', 'hdr range-head');
    head.append(el('span', '', view.header), el('span', '', formatTokens(view.total)));
    box.append(head);
    if (view.total === 0) {
        box.append(screen(SCREENS.empty));
        return box;
    }
    const chart = el('div', 'chart');
    const max = Math.max(...view.periods.map(p => p.total), 1);
    for (const period of view.periods) {
        const column = el('div', 'bar');
        column.title = `${period.label}: ${formatTokens(period.total)}`;
        for (const family of view.families) {
            const amount = period.byFamily[family.family] ?? 0;
            if (!amount)
                continue;
            const part = el('div', 'bar-part');
            part.style.height = `${amount / max * 100}%`;
            part.style.backgroundColor = FAMILY_COLORS[family.family];
            column.append(part);
        }
        chart.append(column);
    }
    box.append(chart);
    const axis = el('div', 'axis sec');
    axis.append(el('span', '', view.periods[0].label),
        el('span', '', view.periods[view.periods.length - 1].label));
    box.append(axis);
    const legend = el('div', 'legend');
    for (const family of view.families) {
        const item = el('span', 'legend-item');
        const square = el('span', 'square');
        square.style.backgroundColor = FAMILY_COLORS[family.family];
        item.append(square, el('span', 'sec', family.name));
        legend.append(item);
    }
    box.append(legend);

    box.append(el('div', 'hdr section', 'WHEN YOU WORK'));
    const hours = el('div', 'hours');
    const top = Math.max(...view.hours, 1);
    view.hours.forEach((out, hour) => {
        const cell = el('div', 'hour');
        cell.style.backgroundColor = ACCENT;
        cell.style.opacity = String(out ? 0.15 + 0.85 * out / top : 0.06);
        cell.title = `${hour}h: ${formatTokens(out)}`;
        hours.append(cell);
    });
    box.append(hours);
    const marks = el('div', 'axis sec');
    marks.append(el('span', '', '0h'), el('span', '', '12h'), el('span', '', '23h'));
    box.append(marks);
    return box;
}

function footer(state) {
    const foot = el('div', 'foot');
    foot.append(el('span', 'foot-text', state.status));
    const gear = el('button', 'foot-button');
    gear.title = 'Settings';
    gear.setAttribute('aria-label', 'Settings');
    gear.append(icon('Settings'));
    gear.addEventListener('click', () => command('openSettings'));
    foot.append(gear);
    return foot;
}

let lastState = null;

function render(state) {
    lastState = state;
    const app = document.getElementById('app');
    const tabs = {Limits: limitsTab, Projects: projectsTab, Activity: activityTab,
        Models: modelsTab};
    const content = el('div', 'content');
    if (state.sources && state.tab !== 'Limits') {
        content.append(switcher(state.sources, state.source, SOURCE_LABELS,
            source => select('source', source)));
    }
    content.append(tabs[state.tab](state));
    if (state.cursorNote)
        content.append(el('div', 'note sec', state.cursorNote));
    app.replaceChildren(tabBar(state), content, footer(state));
}

window.addEventListener('message', event => {
    if (event.data?.type === 'state')
        render(event.data.state);
});
vscode.postMessage({type: 'ready'});
