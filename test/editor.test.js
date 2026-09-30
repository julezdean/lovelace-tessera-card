/**
 * The editor writes the config the card has to read back. These tests cover
 * that contract - what the editor emits must survive normalizeConfig, and it
 * must not bloat the YAML with values that are already the default.
 *
 * How the form LOOKS is Home Assistant's business and cannot be checked here;
 * tools/demo/ drives the editor against a stub to cover the wiring.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  pruneDefaults,
  normalizeConfig,
  CARD_TAG,
  mergeOwnedKeys,
  CARD_FORM_KEYS,
  BUTTON_FORM_KEYS,
} from '../src/main.ts';

/* -- pruning -------------------------------------------------------------- */

test('values equal to their default are dropped', () => {
  const out = pruneDefaults({ gap: 12, radius: 24 }, { gap: 12, radius: 18 });
  assert.deepEqual(out, { radius: 24 });
});

test('empty strings and null are dropped, false and zero are kept', () => {
  const out = pruneDefaults(
    { a: '', b: null, c: undefined, shadow: false, gap: 0 },
    { shadow: true, gap: 12 },
  );
  assert.deepEqual(out, { shadow: false, gap: 0 });
});

test('nested sections are pruned and empty ones removed entirely', () => {
  const out = pruneDefaults(
    { layout: { gap: 12, mode: 'auto' }, appearance: { radius: 30 } },
    { layout: { gap: 12, mode: 'auto' }, appearance: { radius: 24 } },
  );
  assert.deepEqual(out, { appearance: { radius: 30 } });
});

test('a value with no default is always kept', () => {
  assert.deepEqual(pruneDefaults({ title: 'Hall' }, {}), { title: 'Hall' });
  assert.deepEqual(pruneDefaults({ title: 'Hall' }, undefined), { title: 'Hall' });
});

test('arrays are passed through untouched', () => {
  const out = pruneDefaults({ items: [{ name: 'a' }] }, { items: [] });
  assert.deepEqual(out.items, [{ name: 'a' }]);
});

/* -- the editor's output has to be a valid card config --------------------- */

/** What the editor produces after a few typical edits. */
const EDITED = {
  type: `custom:${CARD_TAG}`,
  title: 'Erdgeschoss',
  layout: { gap: 20 },
  items: [
    { name: 'Wohnzimmer', icon: 'mdi:sofa', entity: 'light.wohnzimmer' },
    {
      name: 'Küche',
      entity: 'light.kueche',
      colspan: 2,
      tap_action: { action: 'toggle' },
      hold_action: { action: 'more-info' },
      animation: { type: 'pulse', when: 'on' },
    },
  ],
};

test('the card accepts what the editor writes', () => {
  const config = normalizeConfig(EDITED);
  assert.equal(config.items.length, 2);
  assert.equal(config.layout.gap, 20);
  assert.equal(config.layout.mode, 'auto', 'untouched options keep their default');
  assert.equal(config.items[1].weight, 2);
  assert.equal(config.items[1].animation.type, 'pulse');
  config.items.forEach((button) => assert.equal(button.error, null));
});

test('a button the editor just added is valid on its own', () => {
  // _addButton() writes exactly this and nothing else.
  const config = normalizeConfig({ items: [{ name: 'Button 1' }] });
  assert.equal(config.items[0].error, null);
  assert.equal(config.items[0].tap_action.action, 'none', 'no entity yet, so no action');
});

test('show_state survives the round trip through the select control', () => {
  // The form carries strings; the config carries booleans and 'auto'.
  for (const [form, stored] of [
    ['true', true],
    ['false', false],
    ['auto', 'auto'],
  ]) {
    const config = normalizeConfig({ items: [{ entity: 'light.a', show_state: stored }] });
    assert.equal(config.items[0].show_state, stored, `form value ${form}`);
  }
});

test('an action edited to none is kept, not pruned back to a default', () => {
  // 'none' differs from the card's default for hold_action (more-info), so it
  // has to reach the config or the button would still open more-info.
  const config = normalizeConfig({
    items: [{ entity: 'light.a', hold_action: { action: 'none' } }],
  });
  assert.equal(config.items[0].hold_action.action, 'none');
});

/* -- the editor must not drop what it does not know ----------------------- */

test('keys the form does not model survive an edit', () => {
  // grid_options is written by Home Assistant itself when the user sizes the
  // card in a section. Losing it resets the card to the default width on the
  // next edit, which is exactly what happened before this was fixed.
  const previous = {
    type: `custom:${CARD_TAG}`,
    grid_options: { columns: 'full', rows: 'auto' },
    view_layout: { position: 'sidebar' },
    layout: { gap: 12 },
    items: [{ name: 'a' }],
  };
  const merged = mergeOwnedKeys(previous, CARD_FORM_KEYS, { layout: { gap: 20 } });

  assert.deepEqual(merged.grid_options, { columns: 'full', rows: 'auto' });
  assert.deepEqual(merged.view_layout, { position: 'sidebar' });
  assert.deepEqual(merged.layout, { gap: 20 }, 'the owned key is replaced');
  assert.deepEqual(merged.items, [{ name: 'a' }]);
  assert.equal(merged.type, `custom:${CARD_TAG}`);
});

test('an owned key set back to its default is removed, not kept stale', () => {
  const previous = { title: 'Old', grid_options: { columns: 6 } };
  // pruneDefaults dropped `title`, so it must not survive from `previous`.
  const merged = mergeOwnedKeys(previous, CARD_FORM_KEYS, {});
  assert.equal('title' in merged, false);
  assert.deepEqual(merged.grid_options, { columns: 6 });
});

test('per-button keys the form does not model survive too', () => {
  const previous = {
    name: 'Old',
    visibility: [{ condition: 'state', entity: 'light.a', state: 'on' }],
    some_future_option: 42,
  };
  const merged = mergeOwnedKeys(previous, BUTTON_FORM_KEYS, { name: 'New' });

  assert.equal(merged.name, 'New');
  assert.deepEqual(merged.visibility, [{ condition: 'state', entity: 'light.a', state: 'on' }]);
  assert.equal(merged.some_future_option, 42);
});

test('mergeOwnedKeys does not mutate what it was given', () => {
  const previous = { layout: { gap: 12 }, grid_options: { columns: 6 } };
  const merged = mergeOwnedKeys(previous, CARD_FORM_KEYS, { layout: { gap: 20 } });
  assert.deepEqual(previous.layout, { gap: 12 }, 'original untouched');
  assert.notEqual(merged, previous);
});
