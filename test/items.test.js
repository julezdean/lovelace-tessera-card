/**
 * The card is a list of typed items. An item without `type:` is a button,
 * and the cell every item sits in is configured in `item:` - with a type's
 * own defaults block and the item itself overriding it.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { normalizeConfig, cardFormData, cardFormToConfig, CARD_TAG } from '../src/main.ts';

const one = (item, extra = {}) => normalizeConfig({ items: [item], ...extra }).items[0];

/* -- the list ---------------------------------------------------------------- */

test('an item without a type is a button', () => {
  assert.equal(one({ entity: 'light.a' }).type, 'button');
  assert.equal(one({ type: 'button', entity: 'light.a' }).type, 'button');
});

test('an unknown type costs its own cell, not the card', () => {
  const config = normalizeConfig({ items: [{ type: 'gauge' }, { entity: 'light.a' }] });
  assert.equal(config.items.length, 2);
  assert.match(config.items[0].error, /Unknown item type "gauge"/);
  assert.equal(config.items[0].tap_action.action, 'none');
  assert.equal(config.items[1].error, null);
});

test('an unknown type keeps the placement it was given', () => {
  const item = one({ type: 'gauge', colspan: 2 });
  assert.equal(item.weight, 2);
});

/* -- the cell ---------------------------------------------------------------- */

test('item: sets the cell for every item', () => {
  const item = one({}, { item: { radius: 8, active_color: 'red', press_effect: 'fade' } });
  assert.equal(item.radius, 8);
  assert.equal(item.active_color, 'red');
  assert.equal(item.press_effect, 'fade');
});

test('without item:, the cell keeps the defaults it always had', () => {
  const item = one({});
  assert.equal(item.radius, 18);
  assert.equal(item.press_effect, 'scale');
  assert.equal(item.background, null);
});

test('a type block beats item:, and the item beats both', () => {
  const extra = { item: { radius: 8 }, button: { radius: 12 } };
  assert.equal(one({}, extra).radius, 12, 'button: over item:');
  assert.equal(one({ radius: 4 }, extra).radius, 4, 'the item over button:');
});

test('a type block may set cell keys for its own type', () => {
  const item = one({}, { button: { radius: 24, background: '#222', label_size: 15 } });
  assert.equal(item.radius, 24);
  assert.equal(item.background, '#222');
  assert.equal(item.label_size, 15);
});

test('button-only defaults stay in button:', () => {
  const item = one({}, { button: { layout: 'horizontal', show_name: false } });
  assert.equal(item.layout, 'horizontal');
  assert.equal(item.show_name, false);
});

test('a template in a cell field marks the item as templated', () => {
  assert.equal(one({ background: '[[[ return "red" ]]]' }).hasTemplates, true);
  assert.equal(one({ background: 'red' }).hasTemplates, false);
});

/* -- the editor's card page ------------------------------------------------ */

test('one item section edits item:, with the buttons-only arrangement in it', () => {
  const data = cardFormData({ item: { radius: 8, icon_size: 40 }, button: { layout: 'horizontal' } });
  assert.equal(data.item.radius, 8);
  assert.equal(data.item.icon_size, 40);
  assert.equal(data.item.button_layout, 'horizontal');
  assert.equal('button' in data, false, 'there is no separate button section');
});

test('icon size, icon colour and show_name apply to every type', () => {
  const config = normalizeConfig({
    item: { icon_size: 40, icon_color: 'red', show_name: false, label_size: 15 },
    items: [{ entity: 'light.a' }, { type: 'ring', entity: 'timer.a' }, { type: 'graph', entity: 'sensor.a' }],
  });
  for (const it of config.items) {
    assert.equal(it.icon_size, 40, it.type);
    assert.equal(it.icon_color, 'red', it.type);
    assert.equal(it.label_size, 15, it.type);
    assert.equal(it.show_name, false, it.type);
  }
});

test('the buttons-only arrangement is written back under button:, everything else under item:', () => {
  const config = { type: `custom:${CARD_TAG}`, button: { show_state: true }, items: [{}] };
  const value = cardFormData(config);
  value.item = { ...value.item, icon_size: 36, button_layout: 'horizontal' };
  const next = cardFormToConfig(config, value);
  assert.deepEqual(next.item, { icon_size: 36 });
  assert.deepEqual(next.button, { show_state: true, layout: 'horizontal' }, 'show_state is kept');
});

test('an edit leaves the cell keys of a type block where they are', () => {
  const config = { type: `custom:${CARD_TAG}`, button: { radius: 12, layout: 'horizontal' }, items: [{}] };
  const next = cardFormToConfig(config, cardFormData(config));

  assert.equal(next.item, undefined, 'nothing was changed in the item section');
  assert.deepEqual(next.button, { radius: 12, layout: 'horizontal' });
  assert.deepEqual(next.items, [{}], 'the list is not the form’s business');
});

test('colspan: full spans the whole row, whatever the column count', () => {
  const config = normalizeConfig({ items: [{ colspan: 'full' }, {}] });
  assert.equal(config.items[0].weight, 99, 'clamped against the columns when laid out');
});

test('only items: is read as the list', () => {
  assert.throws(() => normalizeConfig({ buttons: [{}] }), /"items" must be a non-empty list/);
});

test('an untouched card page writes nothing', () => {
  const config = { type: `custom:${CARD_TAG}`, items: [{}] };
  const next = cardFormToConfig(config, cardFormData(config));
  assert.deepEqual(next, config);
});
