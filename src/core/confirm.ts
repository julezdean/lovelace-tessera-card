import type { ActionConfig, Gesture, ItemBase } from '../types';

/**
 * Two-step confirmation instead of a modal: the first gesture arms the item,
 * a tap within the timeout runs what was armed.
 *
 * Confirming is always a tap, whatever armed it. Repeating the gesture -
 * holding again to confirm a hold - would ask for the slowest gesture twice
 * where one quick touch says "yes" as well. A tap on an item armed by a hold therefore runs the hold action, not
 * the tap action; the prompt says so.
 */

export type Step = { run: Gesture } | { arm: Gesture } | null;

export function actionFor(item: ItemBase, kind: Gesture): ActionConfig {
  return kind === 'hold'
    ? item.hold_action
    : kind === 'double_tap'
      ? item.double_tap_action
      : item.tap_action;
}

/**
 * What a gesture on an item does, given what the item is armed with.
 * `armed` is null when the item is not armed.
 */
export function confirmStep(item: ItemBase, armed: Gesture | null, kind: Gesture): Step {
  if (armed && kind === 'tap') return { run: armed };
  const action = actionFor(item, kind);
  if (!action || action.action === 'none') return null;
  return item.confirmation[kind] ? { arm: kind } : { run: kind };
}
