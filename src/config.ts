import { normalizeAction, normalizeConfirmation } from './core/actions';
import { DEFAULT_ANIMATION, normalizeAnimation } from './core/animation';
import { DEFAULT_LAYOUT } from './core/layout';
import { hasTemplate } from './core/templates';
import { normalizeVisibility } from './core/visibility';
import { getItemType, DEFAULT_TYPE } from './items/registry';
import type { AppearanceConfig, CardConfig, Dict, ItemBase } from './types';
import { isDict } from './utils';

/**
 * The card renders a real <ha-card>, so background, corner radius and shadow
 * come from the active theme unless the configuration overrides them. They
 * default to null rather than to a value of their own: writing a default would
 * silently beat the theme, which is exactly what made this card the one that
 * ignored it. `padding` is the card's own inner spacing and has no theme
 * equivalent, so it keeps a real default.
 */
export const DEFAULT_APPEARANCE: AppearanceConfig = {
  background: null,
  radius: null,
  padding: 14,
  shadow: null,
};

/**
 * The cell every item sits in, whatever its type. Kept in one place so a
 * button and whatever sits next to it cannot drift apart: same corners, same
 * surface, same accent, same press feedback, same type size.
 *
 * Set per card in `item:`, per type in its own defaults block (`button:`),
 * and per item on the item itself - the more specific one wins.
 */
export const DEFAULT_ITEM: Dict = {
  radius: 18,
  background: null,
  active_background: null,
  color: null,
  active_color: null,
  name_size: null,
  name_weight: null,
  label_size: null,
  label_weight: null,
  icon_size: null,
  icon_color: null,
  show_name: true,
  show_icon: true,
  press_effect: 'scale', // scale | fade | none
};

export const ITEM_KEYS = Object.keys(DEFAULT_ITEM);

/** Cell fields a template may fill, for every type. */
const ITEM_TEMPLATED_FIELDS = [
  'color',
  'active_color',
  'background',
  'active_background',
  'icon_color',
  'style',
  'active_when',
  'show_drawing',
  'show_icon',
];

/**
 * Turn whatever the user wrote into a fully resolved object.
 * Everything downstream may assume defaults are already applied.
 */
export function normalizeConfig(raw: unknown): CardConfig {
  if (!isDict(raw)) {
    throw new Error('tessera-card: invalid configuration');
  }
  const list = raw.items;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('tessera-card: "items" must be a non-empty list');
  }

  const layout = { ...DEFAULT_LAYOUT, ...((raw.layout as Dict) || {}) };
  const appearance = { ...DEFAULT_APPEARANCE, ...((raw.appearance as Dict) || {}) };
  const item = { ...DEFAULT_ITEM, ...((raw.item as Dict) || {}) };
  const animation = normalizeAnimation(raw.animation, DEFAULT_ANIMATION);

  // "columns: 3" without a mode is a convenient shorthand for grid mode - but
  // only without a mode. Applying it on top of an explicit `mode: auto` made
  // the automatic layout unreachable for anyone who had ever set a column
  // count, since the number stays in the configuration after switching back.
  if (isDict(raw.layout) && raw.layout.mode === undefined && typeof layout.columns === 'number') {
    layout.mode = 'grid';
  }

  const defaults: Record<string, Dict> = {};
  const items = list.map((entry, index) => {
    const typeName = isDict(entry) && entry.type !== undefined ? String(entry.type) : DEFAULT_TYPE;
    if (!defaults[typeName]) {
      defaults[typeName] = typeDefaults(typeName, raw[typeName], item);
    }
    return normalizeItem(entry, index, typeName, defaults[typeName], animation);
  });

  return {
    title: (raw.title as string) || null,
    layout,
    appearance,
    item,
    defaults,
    animation,
    variables: isDict(raw.variables) ? raw.variables : {},
    items,
  };
}

/**
 * A type's defaults: its own built-ins, the cell defaults from `item:`, and
 * then its own block on top - which may also carry cell keys, so an older
 * `button: { radius: 12 }` still means what it meant.
 */
function typeDefaults(typeName: string, block: unknown, item: Dict): Dict {
  const itemType = getItemType(typeName);
  return {
    ...(itemType ? itemType.defaults : {}),
    ...item,
    ...(isDict(block) ? block : {}),
  };
}

function normalizeItem(
  raw: unknown,
  index: number,
  typeName: string,
  defaults: Dict,
  animation: CardConfig['animation'],
): ItemBase {
  const src: Dict = isDict(raw) ? raw : {};
  const itemType = getItemType(typeName);
  const error = !isDict(raw)
    ? 'Item configuration must be a mapping'
    : itemType
      ? null
      : `Unknown item type "${typeName}"`;
  const actions = itemType ? itemType.defaultActions : { tap: 'none', hold: 'none' };

  const base: ItemBase = {
    index,
    type: typeName,
    error,
    entity: typeof src.entity === 'string' ? src.entity : null,
    // Per-item overrides fall back to the type's defaults, then to `item:`.
    radius: src.radius ?? defaults.radius,
    background: src.background ?? defaults.background,
    active_background: src.active_background ?? defaults.active_background,
    color: src.color ?? defaults.color,
    active_color: src.active_color ?? src.color ?? defaults.active_color,
    name_size: src.name_size ?? defaults.name_size,
    name_weight: src.name_weight ?? defaults.name_weight,
    label_size: src.label_size ?? defaults.label_size,
    label_weight: src.label_weight ?? defaults.label_weight,
    show_icon: src.show_icon ?? defaults.show_icon,
    icon_size: src.icon_size ?? defaults.icon_size,
    icon_color: src.icon_color ?? defaults.icon_color,
    press_effect: (src.press_effect ?? defaults.press_effect) as string,
    // CSS declarations for this item, e.g. "border: 2px solid red".
    // Templated like every other presentation field.
    style: src.style ?? null,
    active_when: src.active_when ?? defaults.active_when ?? null,
    show_drawing: src.show_drawing ?? defaults.show_drawing ?? 'always',
    // `visibility` is the sections spelling, `conditions` the conditional
    // card's. Both appear in the wild, so both are accepted.
    visibility: normalizeVisibility(src.visibility ?? src.conditions),
    weight: resolveWeight(src),
    tap_action: normalizeAction(src.tap_action ?? src.action, src.entity, 'default'),
    hold_action: normalizeAction(src.hold_action, src.entity, actions.hold),
    double_tap_action: normalizeAction(src.double_tap_action, src.entity, 'none'),
    confirmation: { tap: null, hold: null, double_tap: null },
    hasTemplates: false,
  };

  // Resolved before the default tap action is filled in below, which would
  // otherwise drop a `confirmation` given on an action without `action:`.
  base.confirmation = {
    tap: normalizeConfirmation(base.tap_action.confirmation),
    hold: normalizeConfirmation(base.hold_action.confirmation),
    double_tap: normalizeConfirmation(base.double_tap_action.confirmation),
  };

  // An item with an entity and no explicit tap action does what its type
  // suggests - a button toggles it; without an entity it does nothing rather
  // than throwing. Likewise more-info with no entity to show.
  if (base.tap_action.action === 'default') {
    base.tap_action =
      base.entity && actions.tap !== 'none'
        ? { action: actions.tap, entity: base.entity }
        : { action: 'none' };
  }
  if (base.hold_action.action === 'more-info' && !base.hold_action.entity && !base.entity) {
    base.hold_action = { action: 'none' };
  }

  const item = itemType ? itemType.normalize(src, base, { defaults, animation }) : base;

  const templated = [...ITEM_TEMPLATED_FIELDS, ...(itemType ? itemType.templatedFields : [])];
  item.hasTemplates = templated.some((field) => {
    const value = (item as unknown as Dict)[field];
    if (hasTemplate(value)) return true;
    // A state-keyed map (an icon per state) may hold templates in its branches.
    if (value && typeof value === 'object') {
      return Object.values(value).some((entry) => hasTemplate(entry));
    }
    return false;
  });

  return item;
}

/**
 * How many slots an item spans: a number up to 6, or `full` for the whole
 * row whatever the column count - clamped against it later.
 */
function resolveWeight(src: Dict): number {
  const colspan = src.colspan;
  if (colspan === 'full') return 99;
  if (typeof colspan === 'number' && Number.isFinite(colspan)) {
    return Math.max(1, Math.min(6, Math.round(colspan)));
  }
  return 1;
}
