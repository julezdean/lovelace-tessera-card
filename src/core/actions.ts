import { CARD_TAG } from '../const';
import type { ActionConfig, Confirmation, Dict, HassEntity, HomeAssistant } from '../types';
import { domainOf, fireEvent } from '../utils';
import { isActiveState } from './state';

/**
 * Domains that need something other than homeassistant.toggle.
 * homeassistant.toggle only works where the domain implements turn_on/turn_off
 * or its own toggle - locks, buttons and scenes do not.
 */
const TOGGLE_OVERRIDES: Record<string, ((stateObj?: HassEntity) => [string, string]) | null> = {
  lock: (stateObj) => ['lock', stateObj && stateObj.state === 'locked' ? 'unlock' : 'lock'],
  cover: () => ['cover', 'toggle'],
  valve: () => ['valve', 'toggle'],
  scene: () => ['scene', 'turn_on'],
  script: () => ['script', 'turn_on'],
  button: () => ['button', 'press'],
  input_button: () => ['input_button', 'press'],
  vacuum: (stateObj) => ['vacuum', isActiveState(stateObj) ? 'return_to_base' : 'start'],
  alarm_control_panel: null, // no sensible toggle - handled as a warning
};

/**
 * Bring every action spelling onto one shape.
 * Supported: toggle, more-info, call-service / perform-action, navigate, url,
 * assist, none - plus the bare `{ service, target }` shorthand.
 */
export function normalizeAction(
  raw: unknown,
  entityFallback: unknown,
  fallbackAction: string,
): ActionConfig {
  const entity = typeof entityFallback === 'string' && entityFallback ? entityFallback : undefined;
  if (raw === undefined || raw === null) {
    return { action: fallbackAction, entity };
  }
  if (typeof raw === 'string') {
    return { action: raw, entity };
  }
  if (typeof raw !== 'object') {
    return { action: 'none' };
  }

  const action = { ...(raw as Dict) } as ActionConfig;

  // Shorthand: no `action:` key, but a service was given.
  if (!action.action) {
    if (action.service || action.perform_action) action.action = 'call-service';
    else if (action.navigation_path) action.action = 'navigate';
    else if (action.url_path || action.url) action.action = 'url';
    else action.action = fallbackAction;
  }

  // HA renamed call-service to perform-action; accept both, store one.
  if (action.action === 'perform-action') action.action = 'call-service';
  if (!action.service && action.perform_action) action.service = action.perform_action;

  if (!action.entity && entity) action.entity = entity;
  return action;
}

/**
 * `confirmation` lives on the action, as in Home Assistant's own action
 * grammar: `true`, `false` or `{ text }`. The item-level key predates that
 * and still means the tap. Resolves to `null` or `{ text }`, text possibly
 * null when the built-in one should be used.
 */
export function normalizeConfirmation(raw: unknown): Confirmation {
  if (!raw) return null;
  if (typeof raw === 'object') return { text: ((raw as Dict).text as string) || null };
  return { text: null };
}

/**
 * Execute one action. Every branch is defensive: a broken action must not take
 * the rest of the card down with it.
 */
export function performAction(
  hass: HomeAssistant | null,
  action: ActionConfig | null | undefined,
  sourceNode: HTMLElement,
): void {
  if (!action || action.action === 'none') return;
  if (!hass) return;

  try {
    switch (action.action) {
      case 'more-info': {
        const entityId = action.entity || action.entity_id;
        if (entityId) fireEvent(sourceNode, 'hass-more-info', { entityId });
        break;
      }

      case 'toggle': {
        const entityId = action.entity || action.entity_id;
        if (!entityId) break;
        const domain = domainOf(entityId);

        if (domain in TOGGLE_OVERRIDES) {
          const override = TOGGLE_OVERRIDES[domain];
          if (!override) {
            console.warn(`${CARD_TAG}: "${domain}" cannot be toggled - use call-service instead`);
            break;
          }
          const [serviceDomain, service] = override(hass.states[entityId]);
          hass.callService(serviceDomain, service, { entity_id: entityId });
          break;
        }

        hass.callService('homeassistant', 'toggle', { entity_id: entityId });
        break;
      }

      case 'call-service': {
        const service = action.service || action.perform_action;
        if (!service || !service.includes('.')) {
          console.warn(`${CARD_TAG}: call-service without a valid "service"`, action);
          break;
        }
        const [domain, name] = service.split('.', 2);
        const data = { ...(action.data || action.service_data || {}) };
        const target = action.target || undefined;
        hass.callService(domain, name, data, target);
        break;
      }

      case 'navigate': {
        const path = action.navigation_path;
        if (!path) break;
        if (/^https?:\/\//.test(path)) {
          window.location.href = path;
          break;
        }
        window.history.pushState(null, '', path);
        fireEvent(window, 'location-changed', { replace: false });
        break;
      }

      case 'url': {
        const url = action.url_path || action.url;
        if (url) window.open(url, action.new_tab === false ? '_self' : '_blank');
        break;
      }

      case 'assist': {
        fireEvent(sourceNode, 'show-dialog', {
          dialogTag: 'ha-voice-command-dialog',
          dialogImport: () => Promise.resolve(),
          dialogParams: {
            pipeline_id: action.pipeline_id,
            start_listening: !!action.start_listening,
          },
        });
        break;
      }

      case 'fire-dom-event': {
        fireEvent(sourceNode, 'll-custom', action);
        break;
      }

      default:
        console.warn(`${CARD_TAG}: unknown action "${action.action}"`);
    }
  } catch (err) {
    console.error(`${CARD_TAG}: action failed`, action, err);
  }
}

/** Short haptic cue - HA listens for this globally on supported devices. */
export function haptic(node: HTMLElement, type = 'light'): void {
  fireEvent(node, 'haptic', type);
}
