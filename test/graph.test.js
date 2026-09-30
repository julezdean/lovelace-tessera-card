/**
 * The graph type: history in, buckets, a scale, a path out. All pure - the
 * clock is a parameter and the history is a plain object.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/main.ts';
import { bucketize, summarize, windowFor } from '../src/graph/aggregate.ts';
import { mergeHistory, pointsOf, toValue } from '../src/graph/history.ts';
import { linePaths, parseBound, scaleFor, thresholdStops, yOf } from '../src/graph/scale.ts';
import { decimalsOf, graphType, PALETTE } from '../src/items/graph/graph.ts';

const HOUR = 3_600_000;
const item = (config) => normalizeConfig({ items: [config] }).items[0];

/* -- buckets ------------------------------------------------------------------ */

test('the window ends at the next bucket boundary, so it moves once per bucket', () => {
  const at = (ms) => windowFor(ms, 24, 1);
  assert.equal(at(10 * HOUR + 1).end, 11 * HOUR);
  assert.equal(at(10 * HOUR + 1).end, at(10 * HOUR + 59 * 60_000).end, 'same bucket, same window');
  assert.equal(at(10 * HOUR + 1).count, 24);
  assert.equal(at(10 * HOUR + 1).start, 11 * HOUR - 24 * HOUR);
});

test('each bucket gets its aggregate; a quiet bucket carries the last value on', () => {
  const window = { start: 0, end: 3 * HOUR, bucketMs: HOUR, count: 3 };
  const points = [
    { t: 0.1 * HOUR, v: 10 },
    { t: 0.5 * HOUR, v: 20 },
    { t: 2.5 * HOUR, v: 5 },
  ];
  assert.deepEqual(bucketize(points, window, 'avg'), [15, 20, 5]);
  assert.deepEqual(bucketize(points, window, 'max'), [20, 20, 5]);
  assert.deepEqual(bucketize(points, window, 'first'), [10, 20, 5]);
});

test('delta and diff are 0 where nothing happened, as in mini-graph-card', () => {
  const window = { start: 0, end: 2 * HOUR, bucketMs: HOUR, count: 2 };
  const points = [
    { t: 0.1 * HOUR, v: 10 },
    { t: 0.9 * HOUR, v: 4 },
  ];
  assert.deepEqual(bucketize(points, window, 'delta'), [6, 0]);
  assert.deepEqual(bucketize(points, window, 'diff'), [-6, 0]);
});

test('the state before the window is where the line starts; before any state there is no line', () => {
  const window = { start: HOUR, end: 3 * HOUR, bucketMs: HOUR, count: 2 };
  assert.deepEqual(bucketize([{ t: 0, v: 7 }], window, 'avg'), [7, 7]);
  assert.deepEqual(bucketize([{ t: 2.5 * HOUR, v: 7 }], window, 'avg'), [null, 7]);
});

test('min, max and mean of what is drawn', () => {
  assert.deepEqual(summarize([null, 2, 4, 6]), { min: 2, max: 6, avg: 4 });
  assert.deepEqual(summarize([null]), {});
});

/* -- history ----------------------------------------------------------------- */

test('a stream message is merged, old states dropped but the one in force kept', () => {
  const first = { states: { 'sensor.t': [{ s: '1', lu: 100 }, { s: '2', lu: 200 }, { s: '3', lu: 300 }] } };
  const merged = mergeHistory({}, first, 250_000);
  assert.deepEqual(merged['sensor.t'].map((s) => s.s), ['2', '3'], '2 is the state at 250 s');
});

test('the window sent again after a reconnect is not drawn twice', () => {
  const message = { states: { 'sensor.t': [{ s: '1', lu: 100 }, { s: '2', lu: 200 }] } };
  const once = mergeHistory({}, message, 0);
  const twice = mergeHistory(once, message, 0);
  assert.equal(twice['sensor.t'].length, 2);
});

test('an attribute is read from the last attributes seen, since a state only carries changes', () => {
  const history = {
    'climate.x': [
      { s: 'heat', a: { current_temperature: 20 }, lu: 1 },
      { s: 'heat', lu: 2 },
      { s: 'heat', a: { current_temperature: 21 }, lu: 3 },
    ],
  };
  const points = pointsOf(history, { entity: 'climate.x', attribute: 'current_temperature', value_factor: 0 });
  assert.deepEqual(points.map((p) => p.v), [20, 20, 21]);
});

test('state_map draws on and off; value_factor scales W to kW', () => {
  assert.equal(toValue('on', { entity: 'x', state_map: { on: 1, off: 0 }, value_factor: 0 }), 1);
  assert.equal(toValue('unavailable', { entity: 'x', value_factor: 0 }), undefined);
  assert.equal(toValue('1500', { entity: 'x', value_factor: -3 }), 1.5);
});

/* -- scale ------------------------------------------------------------------- */

test('a hard bound is kept, a soft one gives way to the data', () => {
  assert.deepEqual(parseBound('~15'), { value: 15, soft: true });
  assert.deepEqual(parseBound(15), { value: 15, soft: false });
  const series = [[12, 20]];
  assert.equal(scaleFor(series, parseBound(15), null, null, false).min, 15, 'hard');
  assert.equal(scaleFor(series, parseBound('~15'), null, null, false).min, 12, 'soft, data lower');
  assert.equal(scaleFor([[16, 20]], parseBound('~15'), null, null, false).min, 15, 'soft, data higher');
});

test('min_bound_range keeps a flat line from filling the height with noise', () => {
  const scale = scaleFor([[21.3, 21.4]], null, null, 4, false);
  assert.ok(Math.abs(scale.max - scale.min - 4) < 1e-9);
  assert.ok(Math.abs((scale.max + scale.min) / 2 - 21.35) < 1e-9, 'centred on the data');
});

test('higher values are drawn higher, inside the drawing', () => {
  const scale = { min: 0, max: 10, log: false };
  assert.ok(yOf(10, scale) < yOf(0, scale));
  assert.ok(yOf(10, scale) > 0 && yOf(0, scale) < 100);
});

test('a gap in the data is a gap in the line', () => {
  const { line } = linePaths([1, 2, null, 3, 4], { min: 0, max: 5, log: false }, false);
  assert.equal(line.match(/M/g).length, 2);
});

test('hard thresholds give each band one colour', () => {
  const stops = thresholdStops(
    [{ value: 40, color: 'amber' }, { value: 50, color: 'blue' }],
    { min: 30, max: 60, log: false },
    true,
  );
  assert.equal(stops[0].color, 'amber', 'below the lowest: the lowest');
  const at50 = stops.filter((s) => Math.abs(s.offset - stops[stops.length - 1].offset) < 1e-9);
  assert.deepEqual(at50.map((s) => s.color), ['amber', 'blue'], 'the change happens at the value');
});

/* -- configuration ------------------------------------------------------------ */

test('a graph never counts as on, and taps open more-info', () => {
  const g = item({ type: 'graph', entity: 'sensor.t' });
  assert.equal(g.type, 'graph');
  assert.deepEqual(g.tap_action, { action: 'more-info', entity: 'sensor.t' });
  assert.equal(g.hold_action.action, 'none');
});

test('the defaults suit a cell: a day, one point an hour, a fading fill, text on top', () => {
  const g = item({ type: 'graph', entity: 'sensor.t' });
  assert.equal(g.hours_to_show, 24);
  assert.equal(g.points_per_hour, 1);
  assert.equal(g.lines[0].fill, 'fade');
  assert.equal(g.graph_layout, 'split');
  assert.equal(g.graph_height, '50%');
});

test('further lines take the palette in order unless they have a colour', () => {
  const g = item({
    type: 'graph',
    entity: 'sensor.a',
    lines: [{ entity: 'sensor.b' }, { entity: 'sensor.c', color: 'red' }, { entity: 'sensor.d' }],
  });
  assert.deepEqual(
    g.lines.map((l) => l.color),
    [PALETTE[0], PALETTE[1], 'var(--red-color)', PALETTE[3]],
  );
  assert.equal(g.lines[1].fill, false, 'only the main line is an area by default');
});

test('color_thresholds from a mini-graph-card config are read too', () => {
  const g = item({ type: 'graph', entity: 'sensor.a', color_thresholds: [{ value: 20, color: '#f00' }] });
  assert.deepEqual(g.thresholds, [{ value: 20, color: '#f00' }]);
});

test('a graph without any entity says so', () => {
  assert.match(item({ type: 'graph' }).error, /entity/);
});

test('min and max are shown in the precision the entity reports in', () => {
  assert.equal(decimalsOf('212'), 0);
  assert.equal(decimalsOf('21.4'), 1);
  assert.equal(decimalsOf('on'), 0);
});

/* -- a second axis ------------------------------------------------------------ */


/** The vertical extent of a drawn line, in viewBox units (0..100). */
const extent = (d) => {
  const ys = [...d.matchAll(/[-\d.]+,([-\d.]+)/g)].map((m) => Number(m[1]));
  return Math.max(...ys) - Math.min(...ys);
};

const NOW = 100 * HOUR;
const historyOf = (id, from, to) => ({
  [id]: Array.from({ length: 25 }, (_, i) => ({ s: String(from + ((to - from) * i) / 24), lu: (NOW - 24 * HOUR + i * HOUR) / 1000 })),
});
const viewOf = (config) => {
  const g = normalizeConfig({ items: [config] }).items[0];
  const data = { ...historyOf('sensor.t', 20, 22), ...historyOf('sensor.h', 45, 55) };
  const hass = { states: {}, callService() {} };
  const context = { hass, stateObj: undefined, resolve: (v) => v, now: NOW, data, geometry: {} };
  return graphType.view(g, context);
};

test('on one axis, a humidity flattens a temperature next to it', () => {
  const view = viewOf({ type: 'graph', entity: 'sensor.t', lines: [{ entity: 'sensor.h' }] });
  assert.ok(extent(view.paths[0].line) < 10, `temperature spans ${extent(view.paths[0].line)}`);
});

test('on a secondary axis, each line gets the whole height', () => {
  const view = viewOf({
    type: 'graph',
    entity: 'sensor.t',
    lines: [{ entity: 'sensor.h', y_axis: 'secondary' }],
  });
  assert.ok(extent(view.paths[0].line) > 80, `temperature spans ${extent(view.paths[0].line)}`);
  assert.ok(extent(view.paths[1].line) > 80, `humidity spans ${extent(view.paths[1].line)}`);
});

test('the secondary axis has bounds of its own', () => {
  const view = viewOf({
    type: 'graph',
    entity: 'sensor.t',
    lines: [{ entity: 'sensor.h', y_axis: 'secondary' }],
    lower_bound_secondary: 0,
    upper_bound_secondary: 100,
  });
  const humidity = extent(view.paths[1].line);
  assert.ok(humidity > 5 && humidity < 15, `10 of 100 points is about a tenth: ${humidity}`);
  assert.ok(extent(view.paths[0].line) > 80, 'the primary axis is untouched');
});
