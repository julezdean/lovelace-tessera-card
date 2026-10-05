import { truthy } from '../core/active';
import { identity, type Resolve } from '../core/templates';
import type { HassEntity, HomeAssistant } from '../types';
import type { SyncContext } from './item-type';

/** What stands where the icon is: `<ha-icon>`, `<ha-state-icon>` or a picture. */
export type IconElement = HTMLElement & {
  icon?: string;
  hass?: HomeAssistant;
  stateObj?: HassEntity;
};

type IconTag = 'ha-icon' | 'ha-state-icon' | 'img';

/**
 * The picture shown instead of the icon, as button-card has it: only with
 * `show_entity_picture`, then the item's own `entity_picture`, then the one
 * the entity brings - a person's photo, a media player's cover. A media
 * player's local copy goes first, since its remote one may not be reachable
 * from the browser. null leaves the icon in place.
 */
export function resolvePicture(
  item: { show_entity_picture: unknown; entity_picture: unknown },
  stateObj: HassEntity | undefined,
  resolve: Resolve = identity,
): string | null {
  if (!truthy(resolve(item.show_entity_picture))) return null;
  const own = resolve(item.entity_picture);
  if (typeof own === 'string' && own.trim()) return own.trim();
  const attributes = (stateObj && stateObj.attributes) || {};
  const fromEntity = attributes.entity_picture_local || attributes.entity_picture;
  return typeof fromEntity === 'string' && fromEntity ? fromEntity : null;
}

/**
 * Pictures that did not load. They are not tried again on every update, which
 * would flash the icon and the broken picture in turn; a page reload does.
 */
const failed = new Set<string>();

/**
 * Draw the icon, or the picture in its place, into `parts[key]`, swapping the
 * element only when its kind changes - creating one is the expensive part of
 * an update, and a new <img> would load the picture again.
 *
 * A picture keeps its own colours: icon_color and the active accent are a
 * colour for a glyph, and the cell's outline still says it is active. If it
 * does not load, the icon takes its place.
 */
export function paintIcon<K extends string>(
  parts: { [key in K]?: IconElement },
  key: K,
  glyph: { icon: string | null; picture: string | null },
  context: SyncContext,
  fallback: string,
): IconElement {
  const url = glyph.picture ? pictureUrl(glyph.picture, context.hass) : null;
  const picture = url && !failed.has(url) ? url : null;
  const wantsState = !picture && !glyph.icon && !!context.stateObj;
  const tag: IconTag = picture ? 'img' : wantsState ? 'ha-state-icon' : 'ha-icon';

  let el = parts[key] as IconElement;
  if (el.tagName.toLowerCase() !== tag) {
    const next = document.createElement(tag) as IconElement;
    next.className = el.className;
    next.style.cssText = el.style.cssText;
    el.replaceWith(next);
    parts[key] = next;
    el = next;
  }
  el.classList.toggle('picture', tag === 'img');

  if (picture) {
    const img = el as unknown as HTMLImageElement;
    img.alt = '';
    img.decoding = 'async';
    img.onerror = () => {
      failed.add(picture);
      if (parts[key] === el) paintIcon(parts, key, { ...glyph, picture: null }, context, fallback);
    };
    if (img.getAttribute('src') !== picture) img.src = picture;
  } else if (wantsState) {
    el.hass = context.hass;
    el.stateObj = context.stateObj;
  } else {
    el.icon = glyph.icon || (context.missing ? 'mdi:alert-circle-outline' : fallback);
  }
  return el;
}

/**
 * `/local/...` and the paths Home Assistant hands out are relative to Home
 * Assistant, which is not always the page's origin - the companion app and a
 * path-prefixed proxy both differ.
 */
function pictureUrl(picture: string, hass: HomeAssistant): string {
  return picture.startsWith('/') && typeof hass.hassUrl === 'function'
    ? hass.hassUrl(picture)
    : picture;
}
