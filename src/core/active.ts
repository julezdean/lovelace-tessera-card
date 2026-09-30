import type { Resolve } from './templates';
import type { ItemBase } from '../types';

/**
 * What a template result means as a yes or no. A template returns a boolean
 * as often as the string it built one from, so both count: "off", "false",
 * "0" and an empty string are no.
 */
export function truthy(value: unknown): boolean {
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    return !(text === '' || text === 'false' || text === 'off' || text === '0' || text === 'no');
  }
  return !!value;
}

/**
 * `active_when`, resolved: true or false when the item sets it, null when the
 * type's own rule applies. A template that fails yields undefined, which
 * reads as "not active" rather than as "let the type decide" - a broken
 * template should be visible, not silently ignored.
 */
export function activeWhen(item: ItemBase, resolve: Resolve): boolean | null {
  if (item.active_when === null || item.active_when === undefined) return null;
  return truthy(resolve(item.active_when));
}

/** `show_drawing`: always, only while active, or what a template says. */
export function drawingShown(item: ItemBase, resolve: Resolve, active: boolean): boolean {
  const value = resolve(item.show_drawing);
  if (value === undefined || value === null || value === 'always') return true;
  if (value === 'active') return active;
  if (value === 'inactive') return !active;
  return truthy(value);
}
