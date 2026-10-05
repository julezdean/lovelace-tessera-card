/**
 * The card is a list of typed items. An item without `type:` is a button,
 * and the cell every item sits in is configured in `item:` - with a type's
 * own defaults block and the item itself overriding it.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { normalizeConfig, cardFormData, cardFormToConfig, CARD_TAG } from '../src/main.ts';
import { resolvePicture } from '../src/items/icon.ts';
import { getItemType } from '../src/items/registry.ts';

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

test('name and second line have their own size and weight, and the icon can be left out', () => {
  const config = normalizeConfig({
    item: { name_size: 18, name_weight: 700, label_size: 11, label_weight: 500, show_icon: false },
    items: [{ entity: 'light.a' }, { type: 'ring', entity: 'timer.a' }, { type: 'graph', entity: 'sensor.a' }],
  });
  for (const it of config.items) {
    assert.equal(it.name_size, 18, it.type);
    assert.equal(it.name_weight, 700, it.type);
    assert.equal(it.label_size, 11, it.type);
    assert.equal(it.label_weight, 500, it.type);
    assert.equal(it.show_icon, false, it.type);
  }
});

test('by default the icon is shown and nothing is sized by hand', () => {
  const it = normalizeConfig({ items: [{}] }).items[0];
  assert.equal(it.show_icon, true);
  assert.equal(it.name_size, null);
  assert.equal(it.label_size, null);
});

test('the item section edits all of them, and an untouched one writes nothing', () => {
  const config = { type: `custom:${CARD_TAG}`, item: { name_size: 16, label_weight: 600 }, items: [{}] };
  const data = cardFormData(config);
  assert.equal(data.item.name_size, 16);
  assert.equal(data.item.label_weight, 600);
  assert.equal(data.item.show_icon, true);
  assert.deepEqual(cardFormToConfig(config, data).item, { name_size: 16, label_weight: 600 });
});

/* -- entity_picture ------------------------------------------------------------ */

test('a picture replaces the icon only when asked for, on every type', () => {
  const config = normalizeConfig({
    item: { show_entity_picture: true },
    items: [
      { entity: 'script.a', entity_picture: '/local/a.svg' },
      { type: 'ring', entity: 'timer.a' },
      { type: 'graph', entity: 'sensor.a', show_entity_picture: false },
    ],
  });
  assert.deepEqual(
    config.items.map((it) => [it.show_entity_picture, it.entity_picture]),
    [
      [true, '/local/a.svg'],
      [true, null],
      [false, null],
    ],
  );
  assert.equal(one({ entity_picture: '/local/a.svg' }).show_entity_picture, false);
});

test('the item picture goes before the entity one, the local copy before the remote', () => {
  const entity = {
    entity_id: 'media_player.a',
    state: 'playing',
    attributes: { entity_picture: '/api/remote', entity_picture_local: '/api/local' },
  };
  const on = { show_entity_picture: true, entity_picture: null };
  assert.equal(resolvePicture({ ...on, entity_picture: '/local/a.svg' }, entity), '/local/a.svg');
  assert.equal(resolvePicture(on, entity), '/api/local');
  assert.equal(
    resolvePicture(on, { ...entity, attributes: { entity_picture: '/api/remote' } }),
    '/api/remote',
  );
  assert.equal(resolvePicture(on, { ...entity, attributes: {} }), null);
  assert.equal(resolvePicture({ show_entity_picture: false, entity_picture: '/local/a.svg' }, entity), null);
  assert.equal(resolvePicture({ show_entity_picture: 'false', entity_picture: '/local/a.svg' }, entity), null);
});

test('the item section sets the picture switch, and leaving it off writes nothing', () => {
  const config = { type: `custom:${CARD_TAG}`, items: [{}] };
  const data = cardFormData(config);
  assert.equal(data.item.show_entity_picture, false);
  assert.equal(cardFormToConfig(config, data).item, undefined);
  data.item.show_entity_picture = true;
  assert.deepEqual(cardFormToConfig(config, data).item, { show_entity_picture: true });
});

test('a button form keeps its picture and drops an empty one', () => {
  const config = { type: `custom:${CARD_TAG}`, items: [] };
  const editor = getItemType('button').editor;
  const button = { entity: 'script.a', show_entity_picture: true, entity_picture: '/local/a.svg' };
  const form = editor.toForm(button, { config });
  assert.equal(form.show_entity_picture, true);
  assert.equal(form.entity_picture, '/local/a.svg');
  assert.deepEqual(editor.fromForm(form, button, { config }), button);
  const cleared = editor.fromForm({ ...form, show_entity_picture: false, entity_picture: '' }, button, { config });
  assert.deepEqual(cleared, { entity: 'script.a' });
});
