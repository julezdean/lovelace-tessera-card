import type { Dict, Gesture } from '../types';
import { isDict } from '../utils';

/**
 * Remove everything that equals the default, recursively, and drop sections
 * that end up empty. Without this the first touch of the editor would write
 * every option the card has into the user's YAML.
 */
export function pruneDefaults(value: unknown, defaults: Dict | undefined): Dict {
  if (!isDict(value)) return value as Dict;

  const out: Dict = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined || entry === null || entry === '') continue;

    const fallback = defaults ? defaults[key] : undefined;

    if (isDict(entry) && fallback && typeof fallback === 'object') {
      const nested = pruneDefaults(entry, fallback as Dict);
      if (Object.keys(nested).length > 0) out[key] = nested;
      continue;
    }
    if (fallback !== undefined && fallback === entry) continue;
    out[key] = entry;
  }
  return out;
}

/**
 * Write form output back into a config without losing anything the form does
 * not model.
 *
 * A form knows a fixed set of keys. Rebuilding the object from just those keys
 * silently drops everything else - and on a Lovelace card "everything else"
 * includes `grid_options`, which Home Assistant itself writes when the user
 * sizes the card in a section. Losing it resets the card to the default width
 * on the next edit.
 *
 * So: start from what is already there, remove only the keys this form owns,
 * then apply the new values.
 */
export function mergeOwnedKeys(previous: Dict, ownedKeys: readonly string[], values: Dict): Dict {
  const next = { ...previous };
  ownedKeys.forEach((key) => delete next[key]);
  return { ...next, ...values };
}

/**
 * The editor shows confirmation as a switch next to each action, but stores it
 * where the card and Home Assistant expect it: on the action. The action
 * picker never sees the key, so it cannot drop or duplicate it.
 */
export function confirmationFromConfig(item: Dict, kind: Gesture): unknown {
  const action = item[`${kind}_action`];
  return isDict(action) ? action.confirmation : undefined;
}

export function actionToForm(action: unknown): unknown {
  if (!action || typeof action !== 'object') return action;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { confirmation, ...rest } = action as Dict;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

export function actionFromForm(action: unknown, confirm: unknown, previous: unknown): unknown {
  const base = action && typeof action === 'object' ? actionToForm(action) : action;
  if (!confirm) return base;
  // Keep a custom text set in YAML rather than flattening it to `true`.
  const confirmation = previous && typeof previous === 'object' ? previous : true;
  if (typeof base === 'string') return { action: base, confirmation };
  return { ...((base as Dict) || {}), confirmation };
}

/**
 * The sizes and the icon colour every type has, form <-> config. A size
 * equal to what the card or the type block already sets is not written out.
 */
export function cellToForm(item: Dict, inherited: Dict): Dict {
  const size = (key: string) => {
    const n = parseFloat(String(item[key] ?? inherited[key] ?? ''));
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    icon_size: size('icon_size'),
    name_size: size('name_size'),
    name_weight: size('name_weight'),
    label_size: size('label_size'),
    label_weight: size('label_weight'),
    icon_color: item.icon_color ?? '',
    show_icon: item.show_icon ?? inherited.show_icon ?? true,
  };
}

export function cellFromForm(value: Dict): Dict {
  return {
    icon_size: value.icon_size,
    name_size: value.name_size,
    name_weight: value.name_weight,
    label_size: value.label_size,
    label_weight: value.label_weight,
    icon_color: value.icon_color,
    show_icon: value.show_icon,
  };
}

export function cellDefaults(inherited: Dict): Dict {
  const size = (key: string) => {
    const n = parseFloat(String(inherited[key] ?? ''));
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    icon_size: size('icon_size'),
    name_size: size('name_size'),
    name_weight: size('name_weight'),
    label_size: size('label_size'),
    label_weight: size('label_weight'),
    icon_color: inherited.icon_color ?? undefined,
    show_icon: inherited.show_icon ?? true,
  };
}

/** A tri-state (`auto` / true / false) round-trips through a select, which only carries strings. */
export function triStateToForm(value: unknown): string {
  if (value === true) return 'true';
  if (value === false) return 'false';
  return 'auto';
}

export function triStateFromForm(value: unknown): boolean | 'auto' {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return 'auto';
}
