// Run with: gjs -m tests/panel.test.js
import System from 'system';

import {
    drawPanelGraphic, graphicSize, hexToRgb, panelMarkup, panelValues, usageColor,
} from '../src/topbar/panel.js';

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

check('white is fixed', usageColor(90, 'white', 'orange'), '#ffffff');
check('orange is fixed', usageColor(5, 'orange', 'blue-red'), '#d97757');
check('scale start', usageColor(0, 'usage', 'orange'), '#f6d2c4');
check('scale middle', usageColor(50, 'usage', 'white-red'), '#d97757');
check('scale end', usageColor(100, 'usage', 'blue-red'), '#e5484d');
check('scale quarter blends', usageColor(25, 'usage', 'white-red'), '#ecbbab');
check('over 100 clamps', usageColor(130, 'usage', 'orange'), '#a8381f');
check('below 0 clamps', usageColor(-4, 'usage', 'orange'), '#f6d2c4');
const data = {five_hour: {utilization: 42.4}, seven_day: {utilization: 18}};
check('values 5-hour', panelValues(data, 'five-hour'), [42.4]);
check('values weekly', panelValues(data, 'weekly'), [18]);
check('values both, 5-hour first', panelValues(data, 'both'), [42.4, 18]);
check('missing limit reads 0', panelValues({five_hour: {utilization: null}}, 'both'), [0, 0]);
check('no data', panelValues(null, 'weekly'), []);
check('markup plain', panelMarkup([42.4, 18], null), '42% · 18%');
check('markup colored', panelMarkup([42], ['#d97757']), '<span foreground="#d97757">42%</span>');
check('markup colored pair', panelMarkup([42, 18], ['#ffffff', '#d97757']),
    '<span foreground="#ffffff">42%</span><span foreground="#999999"> · </span>' +
    '<span foreground="#d97757">18%</span>');
check('size percentage', graphicSize('percentage', 1), [0, 0]);
check('size one bar', graphicSize('bar', 1), [26, 6]);
check('size two bars', graphicSize('bar', 2), [26, 11]);
check('size ring', graphicSize('ring', 2), [16, 16]);
check('hex to rgb', hexToRgb('#ff8000'), [1, 128 / 255, 0]);
check('draw is a function', typeof drawPanelGraphic, 'function');

if (failures > 0) {
    print(`${failures} failed`);
    System.exit(1);
}
print('all passed');
