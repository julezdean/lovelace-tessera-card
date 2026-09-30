/**
 * Visibility uses Home Assistant's own condition grammar, so these tests are
 * mostly about matching HA's semantics rather than inventing any.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { isVisible, conditionMet, collectMediaQueries, normalizeConfig } from '../src/main.ts';

const hass = {
  user: { id: 'user-a' },
  states: {
    'light.on': { entity_id: 'light.on', state: 'on', attributes: {} },
    'light.off': { entity_id: 'light.off', state: 'off', attributes: {} },
    'sensor.temp': { entity_id: 'sensor.temp', state: '21.5', attributes: { humidity: 60 } },
    'cover.x': { entity_id: 'cover.x', state: 'open', attributes: {} },
  },
};
const noMedia = () => false;
const yesMedia = () => true;
const vis = (conditions, media = noMedia) => isVisible(conditions, hass, media);

/* -- the basics ----------------------------------------------------------- */

test('no conditions means always visible', () => {
  assert.equal(vis([]), true);
  assert.equal(vis(undefined), true);
});

test('a list of conditions must all hold', () => {
  assert.equal(vis([
    { condition: 'state', entity: 'light.on', state: 'on' },
    { condition: 'state', entity: 'cover.x', state: 'open' },
  ]), true);
  assert.equal(vis([
    { condition: 'state', entity: 'light.on', state: 'on' },
    { condition: 'state', entity: 'cover.x', state: 'closed' },
  ]), false);
});

/* -- state ---------------------------------------------------------------- */

test('state matches a value or any of a list', () => {
  assert.equal(vis([{ condition: 'state', entity: 'light.on', state: 'on' }]), true);
  assert.equal(vis([{ condition: 'state', entity: 'light.off', state: 'on' }]), false);
  assert.equal(vis([{ condition: 'state', entity: 'cover.x', state: ['open', 'opening'] }]), true);
});

test('state_not inverts the match', () => {
  assert.equal(vis([{ condition: 'state', entity: 'light.off', state_not: 'on' }]), true);
  assert.equal(vis([{ condition: 'state', entity: 'light.on', state_not: 'on' }]), false);
});

test('an entity that does not exist counts as unavailable, not as a crash', () => {
  assert.equal(vis([{ condition: 'state', entity: 'light.nope', state: 'on' }]), false);
  assert.equal(vis([{ condition: 'state', entity: 'light.nope', state: 'unavailable' }]), true);
});

/* -- numeric_state -------------------------------------------------------- */

test('numeric_state compares above and below', () => {
  assert.equal(vis([{ condition: 'numeric_state', entity: 'sensor.temp', above: 20 }]), true);
  assert.equal(vis([{ condition: 'numeric_state', entity: 'sensor.temp', above: 25 }]), false);
  assert.equal(vis([{ condition: 'numeric_state', entity: 'sensor.temp', above: 20, below: 22 }]), true);
});

test('numeric_state can read an attribute', () => {
  assert.equal(vis([
    { condition: 'numeric_state', entity: 'sensor.temp', attribute: 'humidity', above: 50 },
  ]), true);
});

test('a non-numeric state is not a match rather than an error', () => {
  assert.equal(vis([{ condition: 'numeric_state', entity: 'light.on', above: 0 }]), false);
});

/* -- screen, user, logic -------------------------------------------------- */

test('screen conditions use the media query result', () => {
  const condition = [{ condition: 'screen', media_query: '(min-width: 768px)' }];
  assert.equal(vis(condition, yesMedia), true);
  assert.equal(vis(condition, noMedia), false);
});

test('user conditions match the logged-in user', () => {
  assert.equal(vis([{ condition: 'user', users: ['user-a'] }]), true);
  assert.equal(vis([{ condition: 'user', users: ['user-b'] }]), false);
});

test('and, or and not nest', () => {
  const on = { condition: 'state', entity: 'light.on', state: 'on' };
  const off = { condition: 'state', entity: 'light.off', state: 'on' };
  assert.equal(vis([{ condition: 'and', conditions: [on, off] }]), false);
  assert.equal(vis([{ condition: 'or', conditions: [on, off] }]), true);
  assert.equal(vis([{ condition: 'not', conditions: [off] }]), true);
  assert.equal(vis([{ condition: 'not', conditions: [on] }]), false);
});

/* -- robustness ----------------------------------------------------------- */

test('an unknown condition type leaves the button visible', () => {
  // A typo must not make a button vanish without a trace.
  assert.equal(vis([{ condition: 'sunny_outside', entity: 'light.on' }]), true);
  assert.equal(conditionMet({}, hass, noMedia), true);
  assert.equal(conditionMet(null, hass, noMedia), true);
});

test('without hass nothing is hidden yet', () => {
  assert.equal(isVisible([{ condition: 'state', entity: 'light.off', state: 'on' }], null, noMedia), true);
});

/* -- config --------------------------------------------------------------- */

test('visibility and conditions are both accepted', () => {
  const a = normalizeConfig({ items: [{ visibility: [{ condition: 'state', entity: 'light.on', state: 'on' }] }] });
  const b = normalizeConfig({ items: [{ conditions: [{ condition: 'state', entity: 'light.on', state: 'on' }] }] });
  assert.deepEqual(a.items[0].visibility, b.items[0].visibility);
  assert.equal(a.items[0].visibility.length, 1);
});

test('a single condition may be written without a list', () => {
  const config = normalizeConfig({
    items: [{ visibility: { condition: 'state', entity: 'light.on', state: 'on' } }],
  });
  assert.equal(config.items[0].visibility.length, 1);
});

test('a button without conditions gets an empty list, not undefined', () => {
  const config = normalizeConfig({ items: [{ name: 'x' }] });
  assert.deepEqual(config.items[0].visibility, []);
});

test('media queries are collected from nested conditions', () => {
  const queries = collectMediaQueries([
    { condition: 'screen', media_query: '(min-width: 768px)' },
    { condition: 'or', conditions: [{ condition: 'screen', media_query: '(orientation: landscape)' }] },
  ]);
  assert.deepEqual([...queries].sort(), ['(min-width: 768px)', '(orientation: landscape)']);
});
