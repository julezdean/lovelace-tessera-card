/**
 * The progress types: what a source reads, what the engine makes of it at a
 * given moment, and the measurements the drawings are sized by. All pure -
 * the clock is a parameter here, never Date.now().
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/main.ts';
import { readSnapshot } from '../src/progress/sources.ts';
import { evaluate, engineEnv } from '../src/progress/engine.ts';
import { computeVisualSize } from '../src/card/card.ts';
import { segmentFills, ringFontSize, textWidthEm } from '../src/items/progress/progress.ts';

const NOW = Date.UTC(2026, 8, 30, 16, 25, 0);
const iso = (ms) => new Date(ms).toISOString();

const entity = (entity_id, state, attributes = {}, extra = {}) => ({ entity_id, state, attributes, ...extra });
const hassWith = (...entities) => ({
  states: Object.fromEntries(entities.map((e) => [e.entity_id, e])),
  language: 'en',
  locale: { language: 'en', time_format: '24', time_zone: 'server' },
  config: { time_zone: 'UTC' },
  callService() {},
});

const item = (config) => normalizeConfig({ items: [config] }).items[0];
const view = (config, hass, now = NOW) => {
  const it = item(config);
  return evaluate(readSnapshot(hass, it, now), it, now, engineEnv(hass, hass.states[it.entity]));
};

const coffee = (state, attributes) =>
  entity('timer.kaffee', state, { friendly_name: 'Kaffee', duration: '0:05:00', ...attributes });

/* -- configuration ------------------------------------------------------------ */

test('the four progress types are known, and each is its own type', () => {
  for (const type of ['ring', 'bar', 'segments', 'digits']) {
    const it = item({ type, entity: 'timer.kaffee' });
    assert.equal(it.type, type);
    assert.equal(it.error, null, `${type}: ${it.error}`);
  }
});

test('a progress item opens more-info on tap and does nothing on hold by default', () => {
  const it = item({ type: 'ring', entity: 'timer.kaffee' });
  assert.deepEqual(it.tap_action, { action: 'more-info', entity: 'timer.kaffee' });
  assert.equal(it.hold_action.action, 'none');
});

test('shorthands expand: source, format and on_complete may be one word', () => {
  const it = item({ type: 'ring', entity: 'x.y', source: 'timer', format: 'MM:SS', on_complete: 'count_up' });
  assert.equal(it.source.type, 'timer');
  assert.equal(it.format.style, 'MM:SS');
  assert.equal(it.on_complete.action, 'count_up');
});

test('a mistake costs the item, not the card, and says what is wrong', () => {
  const config = normalizeConfig({
    items: [{ type: 'ring', entity: 'timer.a', source: 'stopwatch' }, { entity: 'light.a' }],
  });
  assert.match(config.items[0].error, /source\.type/);
  assert.equal(config.items[1].error, null);
});

test('a ring is thicker than a bar by default, and a bar stays inside the cell padding', () => {
  assert.equal(item({ type: 'ring' }).thickness, 10);
  assert.equal(item({ type: 'bar' }).thickness, 4);
  assert.equal(item({ type: 'bar', thickness: 20 }).thickness, 6);
});

test('a type block sets defaults for every item of that type', () => {
  const config = normalizeConfig({ ring: { thickness: 14 }, items: [{ type: 'ring' }, { type: 'ring', thickness: 8 }] });
  assert.equal(config.items[0].thickness, 14);
  assert.equal(config.items[1].thickness, 8);
});

test('a source template marks the item as templated', () => {
  const it = item({ type: 'ring', source: { type: 'template', template: '[[[ return 42 ]]]' } });
  assert.equal(it.hasTemplates, true);
});

/* -- timers ------------------------------------------------------------------- */

test('a running timer counts down to finishes_at, and its ring empties', () => {
  const hass = hassWith(coffee('active', { finishes_at: iso(NOW + 155_000) }));
  const v = view({ type: 'ring', entity: 'timer.kaffee' }, hass);
  assert.equal(v.value, '02:35');
  assert.equal(v.status, 'active');
  assert.equal(v.active, true);
  assert.ok(Math.abs(v.progress - 155 / 300) < 1e-9);
  assert.equal(v.statusText, 'Running');
});

test('the remaining time rounds up, so 00:00 means it is over', () => {
  const hass = hassWith(coffee('active', { finishes_at: iso(NOW + 400) }));
  assert.equal(view({ type: 'ring', entity: 'timer.kaffee' }, hass).value, '00:01');
});

test('a timer ticks at the millisecond its digits flip', () => {
  const hass = hassWith(coffee('active', { finishes_at: iso(NOW + 155_600) }));
  assert.equal(view({ type: 'ring', entity: 'timer.kaffee' }, hass).tick, 600);
});

test('once the browser passes the end the timer is finished, and stops ticking', () => {
  const hass = hassWith(coffee('active', { finishes_at: iso(NOW - 1000) }));
  const v = view({ type: 'ring', entity: 'timer.kaffee' }, hass);
  assert.equal(v.status, 'finished');
  assert.equal(v.value, '00:00');
  assert.equal(v.active, false);
  assert.equal(v.tick, null);
});

test('a paused timer is still on, frozen, and says so', () => {
  const hass = hassWith(coffee('paused', { remaining: '0:03:20' }));
  const v = view({ type: 'ring', entity: 'timer.kaffee' }, hass);
  assert.equal(v.value, '03:20');
  assert.equal(v.active, true, 'a button on a paused timer shows it active too');
  assert.equal(v.tick, null);
  assert.equal(v.statusText, 'Paused');
});

test('an idle timer is off and shows its full duration', () => {
  const hass = hassWith(coffee('idle', {}));
  const v = view({ type: 'ring', entity: 'timer.kaffee' }, hass);
  assert.equal(v.active, false);
  assert.equal(v.value, '05:00');
});

test('count_up shows the time since the end, and keeps ticking', () => {
  const hass = hassWith(coffee('active', { finishes_at: iso(NOW - 72_000) }));
  const v = view({ type: 'ring', entity: 'timer.kaffee', on_complete: 'count_up' }, hass);
  assert.equal(v.value, '+01:12');
  assert.notEqual(v.tick, null);
});

test('show_text replaces the value once it is over', () => {
  const hass = hassWith(coffee('idle', { last_transition: 'finished' }));
  const v = view({ type: 'ring', entity: 'timer.kaffee', on_complete: { action: 'show_text', text: 'Fertig!' } }, hass);
  assert.equal(v.value, 'Fertig!');
});

/* -- a sensor reporting the time left ---------------------------------------- */

const washer = (value, changedAgoMs) =>
  entity(
    'sensor.waschmaschine_restzeit',
    String(value),
    { friendly_name: 'Waschmaschine', unit_of_measurement: 'min', device_class: 'duration' },
    { last_changed: iso(NOW - changedAgoMs), last_updated: iso(NOW - changedAgoMs) },
  );

test('a remaining-time sensor counts from when it reported, in its own unit', () => {
  const hass = hassWith(washer(23, 20_000));
  const v = view({ type: 'bar', entity: 'sensor.waschmaschine_restzeit' }, hass);
  assert.equal(v.value, '23m', 'minutes only - the sensor knows nothing about seconds');
  assert.equal(v.active, true);
});

test('between two reports it counts down on its own', () => {
  const hass = hassWith(washer(23, 90_000));
  assert.equal(view({ type: 'bar', entity: 'sensor.waschmaschine_restzeit' }, hass).value, '22m');
});

test('without a span there is no proportion; with one there is', () => {
  const hass = hassWith(washer(30, 0));
  assert.equal(view({ type: 'bar', entity: 'sensor.waschmaschine_restzeit' }, hass).progress, null);
  const spanned = view({ type: 'bar', entity: 'sensor.waschmaschine_restzeit', progress: { window: '2h' } }, hass);
  assert.ok(Math.abs(spanned.progress - 30 / 120) < 1e-9);
});

test('the span can come from an entity holding a duration', () => {
  const hass = hassWith(
    washer(30, 0),
    entity('sensor.programmdauer', '90', { unit_of_measurement: 'min' }),
  );
  const v = view(
    { type: 'bar', entity: 'sensor.waschmaschine_restzeit', progress: { window: { entity: 'sensor.programmdauer' } } },
    hass,
  );
  assert.ok(Math.abs(v.progress - 30 / 90) < 1e-9);
});

test('zero minutes left is finished', () => {
  const hass = hassWith(washer(0, 0));
  assert.equal(view({ type: 'bar', entity: 'sensor.waschmaschine_restzeit' }, hass).status, 'finished');
});

/* -- values and points in time ---------------------------------------------- */

test('a battery is a value on 0..100, on while above zero', () => {
  const hass = hassWith(entity('sensor.handy', '60', { unit_of_measurement: '%', device_class: 'battery' }));
  const v = view({ type: 'segments', entity: 'sensor.handy' }, hass);
  assert.equal(v.kind, 'value');
  assert.equal(v.value, '60 %');
  assert.equal(v.progress, 0.6);
  assert.equal(v.active, true);
  assert.equal(v.tick, null);
});

test('an empty battery is off', () => {
  const hass = hassWith(entity('sensor.handy', '0', { unit_of_measurement: '%' }));
  assert.equal(view({ type: 'segments', entity: 'sensor.handy' }, hass).active, false);
});

test('a timestamp says when it ends', () => {
  const hass = hassWith(entity('sensor.backofen', iso(NOW + 700_000), { device_class: 'timestamp' }));
  const v = view({ type: 'digits', entity: 'sensor.backofen' }, hass);
  assert.equal(v.value, '11:40');
  assert.deepEqual(v.digits, ['11', '40']);
  assert.equal(v.end, 'Ends 16:36');
  assert.equal(v.statusText, undefined, 'a point in time has no status worth a line');
});

test('thresholds colour the fill by what is left', () => {
  const hass = hassWith(coffee('active', { finishes_at: iso(NOW + 20_000) }));
  const v = view(
    {
      type: 'ring',
      entity: 'timer.kaffee',
      colors: { basis: 'remaining_seconds', thresholds: [{ value: 0, color: 'red' }, { value: 60, color: 'green' }] },
    },
    hass,
  );
  assert.equal(v.color, 'var(--red-color)');
});

test('without thresholds the fill is the accent', () => {
  const hass = hassWith(coffee('active', { finishes_at: iso(NOW + 20_000) }));
  assert.equal(view({ type: 'ring', entity: 'timer.kaffee' }, hass).color, null);
});

test('a template can supply the whole countdown', () => {
  const hass = hassWith();
  const it = item({ type: 'ring', source: { type: 'template', template: '[[[ ]]]' } });
  const snapshot = readSnapshot(hass, it, NOW, { end: iso(NOW + 60_000), duration: 120 });
  const v = evaluate(snapshot, it, NOW, engineEnv(hass));
  assert.equal(v.value, '01:00');
  assert.equal(v.progress, 0.5);
});

test('a missing entity is an error the item shows', () => {
  const v = view({ type: 'ring', entity: 'timer.gibt_es_nicht' }, hassWith());
  assert.equal(v.kind, 'error');
  assert.match(v.error, /not found/);
});

test('German comes from the language Home Assistant is set to', () => {
  const hass = { ...hassWith(coffee('paused', { remaining: '0:03:20' })), locale: { language: 'de' } };
  assert.equal(view({ type: 'ring', entity: 'timer.kaffee' }, hass).statusText, 'Pausiert');
});

/* -- measurements -------------------------------------------------------------- */

test('segments fill one after another, the current one partly', () => {
  assert.deepEqual(segmentFills(0.6, 5), [1, 1, 1, 0, 0]);
  const fills = segmentFills(0.5, 4);
  assert.deepEqual(fills, [1, 1, 0, 0]);
  const partial = segmentFills(0.55, 4);
  assert.ok(partial[2] > 0 && partial[2] < 1);
});

test('a ring gets the room its row has left, never less than an icon', () => {
  assert.equal(computeVisualSize(114, 34, 13), 55);
  assert.equal(computeVisualSize(88, 26, 12), 32);
  assert.equal(computeVisualSize(60, 24, 12), 24, 'floor: the icon it replaces');
});

test('the ring value is as large as fits inside the ring', () => {
  const ring = item({ type: 'ring' });
  assert.equal(ringFontSize(ring, '02:35', 55), 13); // 55 * 0.8 * 0.82 / 2.7 em
  assert.ok(ringFontSize(ring, '1:02:35', 55) < ringFontSize(ring, '02:35', 55), 'longer text, smaller');
  assert.ok(textWidthEm('02:35') < textWidthEm('02035'), 'a colon is narrower than a digit');
});
