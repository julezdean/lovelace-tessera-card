import { DEFAULT_APPEARANCE, DEFAULT_ITEM } from '../config';
import { DEFAULT_ANIMATION } from '../core/animation';
import { DEFAULT_LAYOUT } from '../core/layout';
import { DEFAULT_BUTTON } from '../items/button/button';
import type { Dict } from '../types';
import { isDict } from '../utils';
import { mergeOwnedKeys, pruneDefaults } from './transform';

/** The card-level keys the editor's form is responsible for. */
export const CARD_FORM_KEYS = ['title', 'layout', 'appearance', 'item', 'button', 'animation'];

function omit(source: unknown, keys: readonly string[]): Dict {
  if (!isDict(source)) return {};
  const out = { ...source };
  keys.forEach((key) => delete out[key]);
  return out;
}

/**
 * What the card page's form shows. Defaults are shown as current values, so
 * no control looks empty.
 *
 * The item section edits `item:`. A type's own block (`button:`, `ring:` …)
 * may override cell keys for that type; those stay YAML, untouched here -
 * except the buttons' arrangement of icon and text, which the section shows
 * as `button_layout` and writes to `button.layout`.
 */
export function cardFormData(config: Dict): Dict {
  return {
    title: config.title ?? '',
    layout: { ...DEFAULT_LAYOUT, ...((config.layout as Dict) || {}) },
    appearance: { ...DEFAULT_APPEARANCE, ...((config.appearance as Dict) || {}) },
    item: {
      ...DEFAULT_ITEM,
      ...((config.item as Dict) || {}),
      button_layout: (isDict(config.button) && config.button.layout) || DEFAULT_BUTTON.layout,
    },
    animation: { ...DEFAULT_ANIMATION, ...((config.animation as Dict) || {}) },
  };
}

/** The config after the card page's form changed. Anything it does not own is kept. */
export function cardFormToConfig(config: Dict, value: Dict): Dict {
  // Switching to automatic leaves `columns` behind otherwise: harmless now,
  // but it reads as if it still applied.
  if (isDict(value.layout) && value.layout.mode === 'auto') {
    value = { ...value, layout: { ...value.layout, columns: undefined } };
  }
  const pruned = pruneDefaults(
    {
      title: value.title,
      layout: value.layout,
      appearance: value.appearance,
      item: omit(value.item, ['button_layout']),
      // Cell keys live in `item:` from here on, so they leave `button:`; what
      // the form does not show there (show_state, say) stays.
      button: {
        ...omit(config.button, ['layout']),
        layout: isDict(value.item) ? value.item.button_layout : undefined,
      },
      animation: value.animation,
    },
    {
      title: '',
      layout: DEFAULT_LAYOUT as unknown as Dict,
      appearance: DEFAULT_APPEARANCE as unknown as Dict,
      item: DEFAULT_ITEM,
      button: DEFAULT_BUTTON,
      animation: DEFAULT_ANIMATION as unknown as Dict,
    },
  );
  return mergeOwnedKeys(config, CARD_FORM_KEYS, pruned);
}
