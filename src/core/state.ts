import type { HassEntity, HomeAssistant } from '../types';
import { domainOf } from '../utils';

/** States that count as "off" for visual feedback purposes. */
const INACTIVE_STATES = new Set([
  'off',
  'closed',
  'locked',
  'idle',
  'standby',
  'docked',
  'not_home',
  'disarmed',
  'unavailable',
  'unknown',
  'none',
  '',
]);

const UNAVAILABLE_STATES = new Set(['unavailable', 'unknown']);

/**
 * Domains that have no on/off, only moments: their state is the timestamp of
 * the last press, activation or event. Read as a state, that timestamp is
 * "active" forever after the first press. So they count as inactive, and the
 * card lights them up briefly when the timestamp changes instead - see
 * PRESS_FLASH_MS. `unknown` just means "never pressed yet" here.
 */
const STATELESS_DOMAINS = new Set(['button', 'input_button', 'scene', 'event']);

/**
 * Domains whose state carries a *value* worth reading from across the room.
 * For pure on/off domains the colour already tells the story, so the extra
 * text line is noise - see resolveShowState().
 *
 * The list does double duty: it is also how isActiveState() knows that a
 * numeric state of zero means "nothing going on". A domain missing here whose
 * state is a count therefore reads as permanently active.
 */
export const VALUE_DOMAINS = new Set([
  'sensor',
  'binary_sensor',
  'number',
  'input_number',
  'climate',
  'water_heater',
  'humidifier',
  'cover',
  'media_player',
  'person',
  'device_tracker',
  'weather',
  'vacuum',
  'lock',
  'alarm_control_panel',
  'counter',
  'todo',
  'input_select',
  'select',
  'update',
  'timer',
]);

export function isStateless(stateObj: HassEntity | undefined): boolean {
  return !!stateObj && STATELESS_DOMAINS.has(domainOf(stateObj.entity_id));
}

export function isUnavailable(stateObj: HassEntity | undefined): boolean {
  if (!stateObj) return true;
  if (isStateless(stateObj)) return stateObj.state === 'unavailable';
  return UNAVAILABLE_STATES.has(stateObj.state);
}

/** HA's notion of "this thing is doing something right now". */
export function isActiveState(stateObj: HassEntity | undefined): boolean {
  if (!stateObj) return false;
  const state = String(stateObj.state).toLowerCase();
  if (UNAVAILABLE_STATES.has(state)) return false;
  if (INACTIVE_STATES.has(state)) return false;
  // Only ever active for a moment, and that moment is tracked by the card.
  if (isStateless(stateObj)) return false;
  // Numeric entities: any non-zero value counts as active.
  if (VALUE_DOMAINS.has(domainOf(stateObj.entity_id)) && !Number.isNaN(Number(state))) {
    return Number(state) !== 0;
  }
  return true;
}

/** Prefer HA's own localisation; fall back to raw state plus unit. */
export function formatState(hass: HomeAssistant, stateObj: HassEntity | undefined): string {
  if (!stateObj) return '';
  try {
    if (typeof hass.formatEntityState === 'function') {
      return hass.formatEntityState(stateObj);
    }
  } catch {
    /* fall through to the manual path */
  }
  const unit = stateObj.attributes && stateObj.attributes.unit_of_measurement;
  return unit ? `${stateObj.state} ${unit}` : String(stateObj.state);
}
