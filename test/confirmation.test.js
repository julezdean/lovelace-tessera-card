/**
 * Confirmation is settable per gesture. The card reads it from the action,
 * the way Home Assistant's own action grammar has it, and still honours the
 * older button-level key for the tap. The editor shows it as a switch per
 * action but must store it on the action.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  normalizeConfig,
  actionToForm,
  actionFromForm,
  confirmationFromConfig,
} from '../src/main.ts';
import { confirmStep } from '../src/core/confirm.ts';

const only = (button) => normalizeConfig({ items: [button] }).items[0];

/* -- the card ------------------------------------------------------------- */

test('no confirmation unless asked for', () => {
  assert.deepEqual(only({ entity: 'light.a' }).confirmation, { tap: null, hold: null, double_tap: null });
});

test('each action can ask for its own confirmation', () => {
  const button = only({
    entity: 'light.a',
    hold_action: { action: 'toggle', confirmation: { text: 'Nochmal halten' } },
    double_tap_action: { action: 'toggle', confirmation: true },
  });
  assert.equal(button.confirmation.tap, null);
  assert.deepEqual(button.confirmation.hold, { text: 'Nochmal halten' });
  assert.deepEqual(button.confirmation.double_tap, { text: null });
});

test('confirmation on an action without action: survives the default being filled in', () => {
  // The default tap action is rebuilt from the entity; the confirmation must
  // not be lost in that step.
  const button = only({ entity: 'light.a', tap_action: { confirmation: true } });
  assert.equal(button.tap_action.action, 'toggle');
  assert.deepEqual(button.confirmation.tap, { text: null });
});

/* -- the editor ----------------------------------------------------------- */

test('the action picker never sees the confirmation key', () => {
  assert.deepEqual(actionToForm({ action: 'toggle', confirmation: true }), { action: 'toggle' });
  assert.equal(actionToForm({ confirmation: true }), undefined, 'nothing left means no action set');
  assert.equal(actionToForm(undefined), undefined);
});

test('switching confirmation on writes it onto the action', () => {
  assert.deepEqual(actionFromForm({ action: 'toggle' }, true), { action: 'toggle', confirmation: true });
  assert.deepEqual(actionFromForm(undefined, true), { confirmation: true }, 'default action, confirmed');
  assert.deepEqual(actionFromForm('toggle', true), { action: 'toggle', confirmation: true });
});

test('switching it off removes the key, and a custom text is kept while on', () => {
  assert.deepEqual(actionFromForm({ action: 'toggle', confirmation: true }, false), { action: 'toggle' });
  assert.deepEqual(actionFromForm({ action: 'toggle' }, true, { text: 'Sicher?' }), {
    action: 'toggle',
    confirmation: { text: 'Sicher?' },
  });
});

/* -- what a gesture does on an armed item ---------------------------------- */


const guarded = only({
  entity: 'lock.haustuer',
  tap_action: { action: 'toggle', confirmation: true },
  hold_action: { action: 'more-info', confirmation: true },
  double_tap_action: { action: 'none' },
});

test('the editor reads confirmation from the action, and only there', () => {
  assert.equal(confirmationFromConfig({ hold_action: { action: 'toggle', confirmation: true } }, 'hold'), true);
  assert.equal(confirmationFromConfig({ confirmation: true }, 'tap'), undefined, 'not from the item itself');
});

test('a gesture with confirmation arms the item instead of running', () => {
  assert.deepEqual(confirmStep(guarded, null, 'hold'), { arm: 'hold' });
  assert.deepEqual(confirmStep(guarded, null, 'tap'), { arm: 'tap' });
});

test('a tap confirms a hold - the hold action runs, not the tap action', () => {
  assert.deepEqual(confirmStep(guarded, 'hold', 'tap'), { run: 'hold' });
});

test('a tap confirms a tap, as before', () => {
  assert.deepEqual(confirmStep(guarded, 'tap', 'tap'), { run: 'tap' });
});

test('holding again does not confirm; it arms the hold anew', () => {
  assert.deepEqual(confirmStep(guarded, 'hold', 'hold'), { arm: 'hold' });
});

test('a tap confirms even when the item has no tap action of its own', () => {
  const holdOnly = only({
    name: 'Alles aus',
    tap_action: { action: 'none' },
    hold_action: { action: 'call-service', service: 'light.turn_off', confirmation: true },
  });
  assert.deepEqual(confirmStep(holdOnly, null, 'tap'), null, 'unarmed, the tap does nothing');
  assert.deepEqual(confirmStep(holdOnly, 'hold', 'tap'), { run: 'hold' });
});

test('without confirmation a gesture simply runs', () => {
  assert.deepEqual(confirmStep(only({ entity: 'light.a' }), null, 'tap'), { run: 'tap' });
});
