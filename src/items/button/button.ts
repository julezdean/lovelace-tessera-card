import { animationActive, normalizeAnimation } from '../../core/animation';
import { formatState, VALUE_DOMAINS } from '../../core/state';
import { hasTemplate, identity, type Resolve } from '../../core/templates';
import type { AnimationConfig, Dict, HassEntity, HomeAssistant, ItemBase } from '../../types';
import { domainOf } from '../../utils';
import type { CellParts, ItemType, SyncContext } from '../item-type';
import { buttonEditor } from './editor';
import { BUTTON_STYLES } from './styles';

export interface ButtonItem extends ItemBase {
  type: 'button';
  name: unknown;
  label: unknown;
  icon: unknown;
  show_name: unknown;
  show_state: unknown;
  state_display: unknown;
  layout: string;
  animation: AnimationConfig;
}

export interface ButtonParts extends CellParts {
  icon: HTMLElement & { icon?: string; hass?: HomeAssistant; stateObj?: HassEntity };
  name: HTMLElement;
  iconTag: 'ha-icon' | 'ha-state-icon';
}

interface ButtonView {
  icon: string | null;
  name: string;
  secondary: string;
  animate: boolean;
  showName: boolean;
}

export const DEFAULT_BUTTON: Dict = {
  show_state: 'auto',
  /**
   * How the icon and the text sit together: `vertical` (icon above) or
   * `horizontal` (icon beside).
   *
   * A decision, not a guess by height: a guess would do the wrong thing more
   * often than not. Beside a 26px icon a narrow button leaves the label a
   * fraction of its width, where stacking gives it all of it; and a switch by
   * height cannot tell a flat-and-wide button from a flat-and-narrow one -
   * the height is derived from the width, so the two are never
   * distinguishable, and reading the rendered height instead would feed the
   * layout back into itself.
   */
  layout: 'vertical', // vertical | horizontal
};

/**
 * The fields a template may fill, beyond the cell's own. Presentation only:
 * `entity` would break state tracking, `colspan` would rebuild the layout on
 * every update, and the actions are structure rather than appearance.
 * `layout` is read in the layout pass rather than the state sync, so a
 * template there would never run.
 */
const TEMPLATED_FIELDS = [
  'name',
  'label',
  'icon',
  'state_display',
  'show_name',
  'show_state',
] as const;

/* --- resolution ----------------------------------------------------------- */

/**
 * Icon resolution, in order:
 *   1. explicit string
 *   2. state map: { on: ..., off: ..., default: ... }
 *   3. entity icon / device class icon supplied by HA
 *   4. null -> caller renders <ha-state-icon> or a neutral fallback
 */
export function resolveIcon(
  button: { icon: unknown },
  stateObj: HassEntity | undefined,
  resolve: Resolve = identity,
): string | null {
  const icon = button.icon;
  if (typeof icon === 'string') return resolve(icon) as string | null;

  if (icon && typeof icon === 'object') {
    const map = icon as Dict;
    const state = stateObj ? String(stateObj.state) : 'unknown';
    if (map[state] !== undefined) return resolve(map[state]) as string | null;
    // YAML turns bare on/off into booleans, so check those too.
    if (state === 'on' && map.true !== undefined) return resolve(map.true) as string | null;
    if (state === 'off' && map.false !== undefined) return resolve(map.false) as string | null;
    if (map.default !== undefined) return resolve(map.default) as string | null;
    return null;
  }

  if (stateObj && stateObj.attributes && stateObj.attributes.icon) {
    return stateObj.attributes.icon;
  }
  return null;
}

export function resolveName(
  button: { name: unknown; entity: string | null },
  stateObj: HassEntity | undefined,
  resolve: Resolve = identity,
): string {
  if (button.name === false) return '';
  if (button.name) {
    const name = resolve(button.name);
    return name === undefined || name === null ? '' : String(name);
  }
  if (stateObj && stateObj.attributes && stateObj.attributes.friendly_name) {
    return stateObj.attributes.friendly_name;
  }
  if (button.entity) return button.entity.split('.').slice(1).join('.');
  return '';
}

/**
 * Decide whether the secondary line is worth its space.
 * 'auto' -> only for domains whose state is a value, not a lamp switch.
 */
function resolveShowState(
  button: ButtonItem,
  stateObj: HassEntity | undefined,
  resolve: Resolve,
): boolean {
  const configured = resolve(button.show_state);
  if (configured === true || configured === 'true') return true;
  if (configured === false || configured === 'false') return false;
  if (button.label) return true;
  if (!button.entity || !stateObj) return false;
  return VALUE_DOMAINS.has(domainOf(button.entity));
}

/** `state_display: "{{state}} in {{name}}"` - deliberately tiny, no Jinja. */
function applyStateTemplate(
  template: unknown,
  hass: HomeAssistant,
  stateObj: HassEntity | undefined,
  name: string,
): string {
  const state = stateObj ? String(stateObj.state) : '';
  const formatted = formatState(hass, stateObj);
  const attributes: Dict = (stateObj && stateObj.attributes) || {};
  return String(template).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => {
    if (key === 'state') return formatted;
    if (key === 'raw_state') return state;
    if (key === 'name') return name;
    if (key.startsWith('attributes.')) {
      const value = attributes[key.slice('attributes.'.length)];
      return value === undefined ? '' : String(value);
    }
    const value = attributes[key];
    return value === undefined ? '' : String(value);
  });
}

/* --- the type ------------------------------------------------------------- */

export const buttonType: ItemType<ButtonItem, ButtonParts, ButtonView> = {
  type: 'button',
  label: 'Button',
  icon: 'mdi:gesture-tap-button',
  defaults: DEFAULT_BUTTON,
  defaultActions: { tap: 'toggle', hold: 'more-info' },
  templatedFields: TEMPLATED_FIELDS,
  styles: BUTTON_STYLES,

  normalize(src, base, { defaults, animation }) {
    return {
      ...base,
      type: 'button',
      name: src.name ?? null,
      label: src.label ?? null,
      icon: src.icon ?? null,
      layout: (src.layout ?? defaults.layout) as string,
      show_name: src.show_name ?? defaults.show_name,
      show_state: src.show_state ?? defaults.show_state,
      state_display: src.state_display ?? null,
      animation: normalizeAnimation(src.animation ?? src.icon_animation, animation),
    };
  },

  build(button, root) {
    if (button.name && typeof button.name === 'string' && !hasTemplate(button.name)) {
      root.dataset.name = button.name;
    }

    const icon = document.createElement('ha-icon');
    icon.className = 'icon';

    const labels = document.createElement('div');
    labels.className = 'labels';
    const name = document.createElement('div');
    name.className = 'name';
    const state = document.createElement('div');
    state.className = 'state';
    labels.append(name, state);

    root.append(icon, labels);
    return { root, icon, name, state, iconTag: 'ha-icon' };
  },

  view(button, { hass, stateObj, active, resolve }) {
    const icon = resolveIcon(button, stateObj, resolve);
    const name = resolveName(button, stateObj, resolve);
    const label = resolve(button.label);
    const hasLabel = label !== undefined && label !== null && label !== '';

    let secondary = '';
    if (resolveShowState(button, stateObj, resolve)) {
      if (button.state_display) {
        const display = resolve(button.state_display);
        // A template produced the whole text; otherwise the placeholder
        // syntax still applies.
        secondary = hasTemplate(button.state_display)
          ? display === undefined || display === null
            ? ''
            : String(display)
          : applyStateTemplate(display, hass, stateObj, name);
      } else if (hasLabel) {
        secondary = String(label);
      } else {
        secondary = formatState(hass, stateObj);
      }
    } else if (hasLabel) {
      secondary = String(label);
    }

    return {
      icon,
      name,
      secondary,
      animate: animationActive(button.animation, stateObj, active),
      showName: button.show_name === false ? false : resolve(button.show_name) !== false,
    };
  },

  paint(parts, button, view, context) {
    renderIcon(parts, view, context);

    const showName = view.showName !== false && !!view.name;
    parts.name.textContent = showName ? view.name : '';
    parts.name.style.display = showName ? '' : 'none';

    parts.state.textContent = view.secondary;
    parts.state.style.display = view.secondary ? '' : 'none';

    // Animation: only class toggles, no style recalculation per frame.
    const animation = button.animation;
    parts.icon.className = 'icon';
    if (view.animate) {
      parts.icon.classList.add('anim', `anim-${animation.type}`);
      parts.icon.style.setProperty('--tsr-anim-d', animation.duration);
      parts.icon.style.setProperty('--tsr-anim-i', String(animation.intensity));
    } else {
      parts.icon.style.removeProperty('--tsr-anim-d');
      parts.icon.style.removeProperty('--tsr-anim-i');
    }

    const label = [view.name, view.secondary].filter(Boolean).join(', ');
    parts.root.setAttribute('aria-label', label || 'Button');
    if (button.entity) {
      parts.root.setAttribute('aria-pressed', context.active ? 'true' : 'false');
    }
  },

  arrange(parts, button, { columnWidth }) {
    parts.root.classList.toggle('compact', button.layout === 'horizontal');
    // Hide the name when there is genuinely no room for it.
    parts.root.classList.toggle('icon-only', columnWidth < 74);
  },

  editor: buttonEditor,
};

/**
 * Swap between <ha-icon> and <ha-state-icon> only when the kind actually
 * changes - element creation is the expensive part of an update.
 */
function renderIcon(parts: ButtonParts, view: ButtonView, context: SyncContext): void {
  const wantsStateIcon = !view.icon && !!context.stateObj;
  const wantedTag = wantsStateIcon ? 'ha-state-icon' : 'ha-icon';

  if (parts.iconTag !== wantedTag) {
    const next = document.createElement(wantedTag) as ButtonParts['icon'];
    next.className = parts.icon.className;
    parts.icon.replaceWith(next);
    parts.icon = next;
    parts.iconTag = wantedTag;
  }

  if (wantsStateIcon) {
    parts.icon.hass = context.hass;
    parts.icon.stateObj = context.stateObj;
  } else {
    const fallback = context.missing ? 'mdi:alert-circle-outline' : 'mdi:card-outline';
    parts.icon.icon = view.icon || fallback;
  }
}
