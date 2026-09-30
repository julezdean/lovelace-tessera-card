import type { Dict, HomeAssistant } from '../types';
import { asList, isDict } from '../utils';

export type MatchMedia = (query: string) => boolean;

/**
 * Home Assistant's own condition grammar, as used by `visibility:` in sections
 * and by the conditional card. A list means "all of these", which is HA's
 * convention.
 *
 * An unknown condition type evaluates to true on purpose: a typo should leave
 * the item where it is, not make it vanish without a trace.
 */
export function conditionMet(
  condition: unknown,
  hass: HomeAssistant,
  matchMedia: MatchMedia,
): boolean {
  if (!isDict(condition)) return true;

  switch (condition.condition) {
    case 'state': {
      const stateObj = hass.states[condition.entity as string];
      const state = stateObj ? String(stateObj.state) : 'unavailable';
      if (condition.state !== undefined) {
        return asList(condition.state).some((value) => String(value) === state);
      }
      if (condition.state_not !== undefined) {
        return !asList(condition.state_not).some((value) => String(value) === state);
      }
      return !!stateObj;
    }

    case 'numeric_state': {
      const stateObj = hass.states[condition.entity as string];
      if (!stateObj) return false;
      const value = Number(
        condition.attribute ? stateObj.attributes[condition.attribute as string] : stateObj.state,
      );
      if (Number.isNaN(value)) return false;
      if (condition.above !== undefined && !(value > Number(condition.above))) return false;
      if (condition.below !== undefined && !(value < Number(condition.below))) return false;
      return true;
    }

    case 'screen': {
      if (!condition.media_query) return true;
      return matchMedia(condition.media_query as string);
    }

    case 'user': {
      const current = hass.user && hass.user.id;
      if (!current) return false;
      return asList(condition.users).some((id) => String(id) === String(current));
    }

    case 'and':
      return asList(condition.conditions).every((c) => conditionMet(c, hass, matchMedia));

    case 'or':
      return asList(condition.conditions).some((c) => conditionMet(c, hass, matchMedia));

    case 'not':
      return !asList(condition.conditions).some((c) => conditionMet(c, hass, matchMedia));

    default:
      return true;
  }
}

/** All conditions must hold; no conditions means always visible. */
export function isVisible(
  conditions: unknown[] | undefined | null,
  hass: HomeAssistant | null | undefined,
  matchMedia: MatchMedia,
): boolean {
  if (!conditions || conditions.length === 0) return true;
  if (!hass) return true;
  return conditions.every((condition) => conditionMet(condition, hass, matchMedia));
}

/** Every media query a config mentions, so they can be watched. */
export function collectMediaQueries(
  conditions: unknown,
  into: Set<string> = new Set(),
): Set<string> {
  asList(conditions).forEach((condition) => {
    if (!isDict(condition)) return;
    if (condition.condition === 'screen' && condition.media_query) {
      into.add(condition.media_query as string);
    }
    if (condition.conditions) collectMediaQueries(condition.conditions, into);
  });
  return into;
}

/** A single condition is allowed where a list is expected. */
export function normalizeVisibility(raw: unknown): Dict[] {
  if (raw === undefined || raw === null) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter((entry): entry is Dict => !!entry && typeof entry === 'object');
}
