/**
 * active_when decides when an item counts as active, for every type, and
 * show_drawing whether a type that draws something draws it.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/main.ts';
import { activeWhen, drawingShown, truthy } from '../src/core/active.ts';
import { renderTemplate, templateContext } from '../src/core/templates.ts';
import { ringType } from '../src/items/progress/progress.ts';
import { graphType } from '../src/items/graph/graph.ts';

const NOW = Date.UTC(2026, 8, 30, 16, 0, 0);
const item = (config) => normalizeConfig({ items: [config] }).items[0];
const hassWith = (states) => ({ states, callService() {}, language: 'en' });
const resolverFor = (hass, entity) => {
  const context = templateContext(hass, entity);
  return (value) => renderTemplate(value, context);
};

test('template results read as yes or no, strings included', () => {
  for (const yes of [true, 1, 'true', 'on', 'yes please']) assert.equal(truthy(yes), true, String(yes));
  for (const no of [false, 0, '', 'false', 'off', '0', 'no', null, undefined]) assert.equal(truthy(no), false, String(no));
});

test('without active_when the type decides', () => {
  const it = item({ entity: 'light.a' });
  assert.equal(activeWhen(it, (v) => v), null);
});

test('active_when is a template, and makes an item templated', () => {
  const it = item({ entity: 'sensor.h', active_when: "[[[ return Number(entity.state) > 60 ]]]" });
  assert.equal(it.hasTemplates, true);
  const hass = hassWith({ 'sensor.h': { entity_id: 'sensor.h', state: '72', attributes: {} } });
  assert.equal(activeWhen(it, resolverFor(hass, hass.states['sensor.h'])), true);
  hass.states['sensor.h'].state = '40';
  assert.equal(activeWhen(it, resolverFor(hass, hass.states['sensor.h'])), false);
});

test('a template that throws reads as not active, not as "let the type decide"', () => {
  const it = item({ entity: 'light.a', active_when: '[[[ return entity.nope.nope ]]]' });
  const hass = hassWith({ 'light.a': { entity_id: 'light.a', state: 'on', attributes: {} } });
  assert.equal(activeWhen(it, resolverFor(hass, hass.states['light.a'])), false);
});

test('show_drawing: always by default, active follows the item, a template decides itself', () => {
  assert.equal(drawingShown(item({ type: 'ring' }), (v) => v, false), true);
  assert.equal(drawingShown(item({ type: 'ring', show_drawing: 'active' }), (v) => v, false), false);
  assert.equal(drawingShown(item({ type: 'ring', show_drawing: 'active' }), (v) => v, true), true);
  assert.equal(drawingShown(item({ type: 'ring', show_drawing: false }), (v) => v, true), false);
});

/* -- through the types' views --------------------------------------------- */

const timer = (state) => ({
  entity_id: 'timer.kaffee',
  state,
  attributes: { duration: '0:05:00', remaining: '0:05:00', finishes_at: new Date(NOW + 60_000).toISOString() },
});
const ringView = (config, state, forced = null) => {
  const it = item({ type: 'ring', entity: 'timer.kaffee', ...config });
  const hass = hassWith({ 'timer.kaffee': timer(state) });
  const stateObj = hass.states['timer.kaffee'];
  return ringType.view(it, {
    hass,
    stateObj,
    resolve: resolverFor(hass, stateObj),
    now: NOW,
    geometry: { visualSize: 55, trackWidth: 140, columns: 3, gap: 12 },
    activeWhen: forced,
  });
};

test('show_drawing: active hides the ring of an idle timer and shows it while it runs', () => {
  assert.equal(ringView({ show_drawing: 'active' }, 'idle').showDrawing, false);
  assert.equal(ringView({ show_drawing: 'active' }, 'active').showDrawing, true);
});

test('without its drawing a ring shows its icon, and the value moves to the state line', () => {
  const view = ringView({ show_drawing: 'active' }, 'idle');
  assert.equal(view.inner, 'icon');
  assert.match(view.line, /05:00/);
});

test('active_when overrides "running", and show_drawing follows it', () => {
  const view = ringView({ show_drawing: 'active' }, 'active', false);
  assert.equal(view.p.active, false);
  assert.equal(view.showDrawing, false);
});

test('a graph is never active by itself, so show_drawing: active needs active_when', () => {
  const it = item({ type: 'graph', entity: 'sensor.t', show_drawing: 'active' });
  const hass = hassWith({ 'sensor.t': { entity_id: 'sensor.t', state: '21', attributes: {} } });
  const context = { hass, stateObj: hass.states['sensor.t'], resolve: (v) => v, now: NOW, data: {}, geometry: {} };
  assert.equal(graphType.view(it, { ...context, activeWhen: null }).showDrawing, false);
  assert.equal(graphType.view(it, { ...context, activeWhen: true }).showDrawing, true);
});
