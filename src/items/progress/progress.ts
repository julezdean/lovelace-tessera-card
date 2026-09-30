import { drawingShown } from '../../core/active';
import { animationActive } from '../../core/animation';
import { hasTemplate } from '../../core/templates';
import { normalizeProgress, PROGRESS_DEFAULTS, TYPE_DEFAULTS } from '../../progress/config';
import { engineEnv, evaluate, type ProgressView } from '../../progress/engine';
import { readSnapshot } from '../../progress/sources';
import type { ProgressItem } from '../../progress/types';
import type { Dict, HassEntity, HomeAssistant } from '../../types';
import { cssLength } from '../../utils';
import { resolveIcon, resolveName } from '../button/button';
import type { CellParts, ItemType, SyncContext } from '../item-type';
import { progressEditor } from './editor';
import { PROGRESS_STYLES } from './styles';

/**
 * The four progress types - ring, bar, segments, digits. They read the same
 * sources, count the same way and take the same options; they differ only in
 * the drawing, which is the one thing each defines below.
 *
 * Inside the cell they follow the button's arrangement - drawing where the
 * icon is, name, state line - so that a progress item next to a button reads
 * as the same kind of thing.
 */

export interface ProgressParts extends CellParts {
  name: HTMLElement;
  visual: HTMLElement;
}

export interface ItemView {
  p: ProgressView;
  name: string;
  showName: boolean;
  icon: string | null;
  /** What the state line says. */
  line: string;
  /** ring: what is in the middle, after `inner: auto` has been decided. */
  inner: 'value' | 'percentage' | 'icon' | 'none';
  /** show_drawing, decided. Without it the item looks like a button. */
  showDrawing: boolean;
}

/** One type's drawing: built once, painted on every change. */
interface Drawing<P extends ProgressParts> {
  build(item: ProgressItem, visual: HTMLElement, parts: ProgressParts): P;
  paint(parts: P, item: ProgressItem, view: ItemView, context: SyncContext): void;
  /** The state line, when `label` does not set it. */
  line(view: ProgressView, inner: ItemView['inner']): string;
  /** Whether the drawing stands where the icon would, and is taller. */
  tall: boolean;
}

/* --- placeholders --------------------------------------------------------- */

/** `label: "{{value}} left"` - the same small syntax as a button's state_display. */
function fillLabel(text: string, values: ProgressView['values'], entity?: HassEntity): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => {
    if (key.startsWith('attributes.')) {
      const value = entity?.attributes?.[key.slice('attributes.'.length)];
      return value === undefined || value === null ? '' : String(value);
    }
    const value = values[key];
    return value === undefined ? '' : value;
  });
}

/* --- shared -------------------------------------------------------------- */

function progressView(
  item: ProgressItem,
  context: SyncContext,
  drawing: Drawing<ProgressParts>,
): ItemView {
  const { hass, stateObj, resolve, now } = context;
  const rendered =
    item.source.type === 'template' && item.source.template
      ? resolve(item.source.template)
      : undefined;
  const p = evaluate(readSnapshot(hass, item, now, rendered), item, now, engineEnv(hass, stateObj));

  // active_when overrides "running or paused"; the animation follows it
  // where it runs on being active.
  if (context.activeWhen !== null) {
    p.active = context.activeWhen;
    if (item.animation.when !== 'finishing' && item.animation.when !== 'finished') {
      p.animate = animationActive(item.animation, stateObj, p.active);
    }
  }
  const showDrawing = drawingShown(item, resolve, p.active);

  // Without its drawing a ring is a button: the icon in its place, the value
  // in the state line.
  const inner = showDrawing ? innerFor(item, p, context) : item.type === 'ring' ? 'icon' : 'none';
  const label = resolve(item.label);
  let line: string;
  if (p.error) line = p.error;
  else if (label !== undefined && label !== null && label !== '') {
    line = hasTemplate(item.label) ? String(label) : fillLabel(String(label), p.values, stateObj);
  } else if (!showDrawing && item.type === 'digits') {
    // The digits are gone, so the value comes down to the state line.
    line = [p.value, p.status !== 'active' ? p.statusText : undefined].filter(Boolean).join(' · ');
  } else line = drawing.line(p, inner);

  return {
    p,
    name: resolveName(item, stateObj, resolve),
    showName: item.show_name === false ? false : resolve(item.show_name) !== false,
    icon: resolveIcon(item, stateObj, resolve),
    line,
    inner,
    showDrawing,
  };
}

/**
 * `inner: auto` puts the value in the ring when it can be read there, and
 * the icon otherwise - with the value moving to the state line. "Can be read"
 * is a size: below 10 px a clock face is decoration.
 */
function innerFor(item: ProgressItem, p: ProgressView, context: SyncContext): ItemView['inner'] {
  if (item.type !== 'ring') return 'none';
  if (item.inner !== 'auto') return item.inner;
  if (p.error || !p.value) return 'icon';
  return ringFontSize(item, p.value, context.geometry.visualSize) >= 10 ? 'value' : 'icon';
}

/** The size the ring's value gets: as large as fits across the inside of the ring. */
export function ringFontSize(item: ProgressItem, text: string, size: number): number {
  const inside = size * (1 - (2 * item.thickness) / 100) * 0.82;
  return Math.floor(Math.min(size * 0.32, inside / textWidthEm(text)));
}

/**
 * How wide a text sets, in em, without measuring it: tabular figures are
 * about 0.6 em, a colon, point or space about a third of that. Measuring
 * would read the layout back on every tick.
 */
export function textWidthEm(text: string): number {
  let width = 0;
  for (const char of text) {
    if (/[0-9]/.test(char)) width += 0.6;
    else if (/[:., ]/.test(char)) width += 0.3;
    else width += 0.62;
  }
  return Math.max(1.2, width);
}

/** A tick repaints once a second; text that did not change is not rewritten. */
function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
  const display = text ? '' : 'none';
  if (el.style.display !== display) el.style.display = display;
}

function setVar(el: HTMLElement, name: string, value: string | null | undefined): void {
  if (value === null || value === undefined || value === '') el.style.removeProperty(name);
  else el.style.setProperty(name, value);
}

function paintShared(parts: ProgressParts, item: ProgressItem, view: ItemView): void {
  const { root } = parts;
  // A colour of its own (thresholds, gradient) is the fill's, and with it the
  // accent the cell's outline and icon take.
  setVar(root, '--tsr-progress', view.p.color);
  root.classList.toggle('indeterminate', view.p.progress === null);
  root.classList.toggle('data-error', !!view.p.error);
  root.classList.toggle('drawing-off', !view.showDrawing);
  root.dataset.status = view.p.status;

  const showName = view.showName !== false && !!view.name;
  setText(parts.name, showName ? view.name : '');
  setText(parts.state, view.line);

  // The same animations as a button's icon, on the drawing.
  const animation = item.animation;
  parts.visual.classList.toggle('anim', view.p.animate);
  [...parts.visual.classList]
    .filter((name) => name.startsWith('anim-'))
    .forEach((name) => parts.visual.classList.remove(name));
  if (view.p.animate) {
    parts.visual.classList.add(`anim-${animation.type}`);
    parts.visual.style.setProperty('--tsr-anim-d', animation.duration);
    parts.visual.style.setProperty('--tsr-anim-i', String(animation.intensity));
  }

  const label = [view.name, view.p.value, view.p.statusText].filter(Boolean).join(', ');
  root.setAttribute('aria-label', label || item.type);
}

type StateIcon = HTMLElement & { icon?: string; hass?: HomeAssistant; stateObj?: HassEntity };

/** An icon, as a button draws it: its own, or the one Home Assistant picks. */
function iconElement(
  parts: { iconEl?: StateIcon },
  host: HTMLElement,
  className: string,
): StateIcon {
  if (!parts.iconEl) {
    parts.iconEl = document.createElement('ha-icon') as StateIcon;
    parts.iconEl.className = className;
    host.appendChild(parts.iconEl);
  }
  return parts.iconEl;
}

function paintIcon(
  parts: { iconEl?: StateIcon },
  host: HTMLElement,
  className: string,
  icon: string | null,
  context: SyncContext,
): void {
  const wantsState = !icon && !!context.stateObj;
  const tag = wantsState ? 'ha-state-icon' : 'ha-icon';
  let el = iconElement(parts, host, className);
  if (el.tagName.toLowerCase() !== tag) {
    const next = document.createElement(tag) as StateIcon;
    next.className = el.className;
    el.replaceWith(next);
    parts.iconEl = next;
    el = next;
  }
  if (wantsState) {
    el.hass = context.hass;
    el.stateObj = context.stateObj;
  } else {
    el.icon = icon || (context.missing ? 'mdi:alert-circle-outline' : 'mdi:progress-clock');
  }
}

function makeType<P extends ProgressParts>(
  type: ProgressItem['type'],
  label: string,
  icon: string,
  drawing: Drawing<P>,
): ItemType<ProgressItem, P, ItemView> {
  return {
    type,
    label,
    icon,
    defaults: { ...PROGRESS_DEFAULTS, ...TYPE_DEFAULTS[type] },
    // A countdown is looked at, not switched: a tap opens it, and what
    // holding it does is for the config to say (cancel the timer, say).
    defaultActions: { tap: 'more-info', hold: 'none' },
    templatedFields: ['name', 'icon', 'label', 'show_name', 'source'],
    styles: '', // the four share one stylesheet, added once below
    tallVisual: drawing.tall,

    normalize(src: Dict, base, { defaults }) {
      return normalizeProgress(type, src, base, defaults);
    },

    build(item, root) {
      root.classList.add('progress', `progress-${type}`);
      if (item.thickness) root.style.setProperty('--tsr-thickness', `${item.thickness}`);
      if (item.colors.track) root.style.setProperty('--tsr-track', item.colors.track);

      const visual = document.createElement('div');
      visual.className = `visual ${type}`;
      const labels = document.createElement('div');
      labels.className = 'labels';
      const name = document.createElement('div');
      name.className = 'name';
      const state = document.createElement('div');
      state.className = 'state';
      labels.append(name, state);
      root.append(visual, labels);
      return drawing.build(item, visual, { root, state, name, visual });
    },

    view: (item, context) =>
      progressView(item, context, drawing as unknown as Drawing<ProgressParts>),
    activeOf: (view) => view.p.active,
    tickOf: (view) => view.p.tick,

    paint(parts, item, view, context) {
      paintShared(parts, item, view);
      drawing.paint(parts, item, view, context);
    },

    arrange(parts, _item, { columnWidth }) {
      // Too narrow for text: the drawing alone, as a button keeps its icon.
      parts.root.classList.toggle('icon-only', columnWidth < 74);
    },

    editor: progressEditor(type, label),
  };
}

/* --- ring ---------------------------------------------------------------- */

const SVG = 'http://www.w3.org/2000/svg';
let gradientCounter = 0;

interface RingParts extends ProgressParts {
  fill: SVGGeometryElement;
  length: number;
  value: HTMLElement;
  inner: HTMLElement;
  iconEl?: StateIcon;
}

/** Degrees clockwise from twelve o'clock -> a point on the circle. */
function polar(r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [50 + r * Math.cos(rad), 50 + r * Math.sin(rad)];
}

/** An arc with its opening centred at six o'clock, as a gauge has it. */
function arcPath(r: number, arc: number): string {
  const start = 180 + (360 - arc) / 2;
  const [x1, y1] = polar(r, start);
  const [x2, y2] = polar(r, start + Math.min(359.999, arc));
  const f = (n: number) => Math.round(n * 1000) / 1000;
  return `M ${f(x1)} ${f(y1)} A ${f(r)} ${f(r)} 0 ${arc > 180 ? 1 : 0} 1 ${f(x2)} ${f(y2)}`;
}

function ringShape(item: ProgressItem, r: number, className: string): SVGGeometryElement {
  const open = item.arc < 360;
  const el = document.createElementNS(SVG, open ? 'path' : 'circle') as SVGGeometryElement;
  el.setAttribute('class', className);
  el.setAttribute('stroke-width', String(item.thickness));
  el.setAttribute('stroke-linecap', item.rounded ? 'round' : 'butt');
  if (open) {
    el.setAttribute('d', arcPath(r, item.arc));
  } else {
    el.setAttribute('cx', '50');
    el.setAttribute('cy', '50');
    el.setAttribute('r', String(r));
    // Starts at twelve o'clock and fills clockwise, the way a clock is read.
    el.setAttribute('transform', 'rotate(-90 50 50)');
  }
  return el;
}

/**
 * A ring - or, with `arc` below 360, a gauge open at the bottom. The stroke is
 * drawn in a 100 x 100 viewBox, so `thickness` is a share of the diameter and
 * the ring looks the same in a small cell and a large one.
 *
 * Without a known proportion (a timestamp and no start) the ring is drawn
 * full and muted: the countdown still counts, it just has nothing to measure
 * against. Inventing a start would draw a proportion that is not true.
 */
const ring: Drawing<RingParts> = {
  tall: true,
  build(item, visual, parts) {
    const r = 50 - item.thickness / 2 - 1;
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('aria-hidden', 'true');
    if (item.track) svg.appendChild(ringShape(item, r, 'track'));
    const fill = ringShape(item, r, 'fill');
    const length = item.arc < 360 ? (2 * Math.PI * r * item.arc) / 360 : 2 * Math.PI * r;
    fill.style.strokeDasharray = `${length}`;
    fill.style.strokeDashoffset = `${length}`;
    if (item.gradient && item.colors.secondary) {
      const id = `tsr-ring-${++gradientCounter}`;
      const defs = document.createElementNS(SVG, 'defs');
      const gradient = document.createElementNS(SVG, 'linearGradient');
      gradient.setAttribute('id', id);
      gradient.setAttribute('x1', '0');
      gradient.setAttribute('y1', '0');
      gradient.setAttribute('x2', '1');
      gradient.setAttribute('y2', '1');
      [
        ['0', 'var(--tsr-fill)'],
        ['1', item.colors.secondary],
      ].forEach(([offset, color]) => {
        const stop = document.createElementNS(SVG, 'stop');
        stop.setAttribute('offset', offset);
        stop.setAttribute('style', `stop-color: ${color}`);
        gradient.appendChild(stop);
      });
      defs.appendChild(gradient);
      svg.insertBefore(defs, svg.firstChild);
      fill.style.stroke = `url(#${id})`;
    }
    svg.appendChild(fill);

    const inner = document.createElement('div');
    inner.className = 'inner';
    const value = document.createElement('span');
    value.className = 'inner-value';
    inner.appendChild(value);
    visual.append(svg, inner);
    return { ...parts, fill, length, value, inner };
  },
  paint(parts, item, view, context) {
    const fraction = view.p.progress ?? 1;
    parts.fill.style.strokeDashoffset = `${parts.length * (1 - Math.min(1, Math.max(0, fraction)))}`;
    parts.fill.classList.toggle('empty', fraction <= 0.0005);

    const text =
      view.inner === 'value'
        ? view.p.value
        : view.inner === 'percentage'
          ? (view.p.percentage ?? '')
          : '';
    setText(parts.value, text);
    parts.value.style.fontSize = text
      ? `${ringFontSize(item, text, context.geometry.visualSize)}px`
      : '';
    if (view.inner === 'icon') {
      paintIcon(parts, parts.inner, 'inner-icon', view.icon, context);
      (parts.iconEl as StateIcon).style.display = '';
    } else if (parts.iconEl) {
      parts.iconEl.style.display = 'none';
    }
  },
  line(p, inner) {
    // The value is in the ring; the line says how it is going. When the ring
    // shows something else, the value comes down here instead.
    if (inner === 'icon' || inner === 'none' || inner === 'percentage') {
      return [p.value, p.status !== 'active' ? p.statusText : undefined]
        .filter(Boolean)
        .join(' · ');
    }
    return p.statusText ?? p.end ?? '';
  },
};

/* --- bar and segments -------------------------------------------------------- */

interface BarParts extends ProgressParts {
  fills: HTMLElement[];
  iconEl?: StateIcon;
}

/**
 * The fill is clipped rather than scaled or resized. Scaling squashes a
 * gradient and the rounded end with it; resizing re-lays out on every tick.
 * clip-path: inset() keeps the gradient fixed to the track and transitions
 * smoothly.
 */
function clipFor(fraction: number, round: boolean): string {
  const hidden = `${Math.round((1 - Math.min(1, Math.max(0, fraction))) * 10000) / 100}%`;
  return `inset(0 ${hidden} 0 0${round ? ' round var(--tsr-bar-radius)' : ''})`;
}

/**
 * The fill of each of `count` segments. The segment the progress is in is
 * filled partially, so the display moves every tick instead of jumping one
 * segment at a time - a 12-segment countdown over an hour would otherwise sit
 * still for five minutes and read as frozen.
 */
export function segmentFills(fraction: number, count: number): number[] {
  const scaled = Math.min(1, Math.max(0, fraction)) * count;
  return Array.from({ length: count }, (_, i) => Math.min(1, Math.max(0, scaled - i)));
}

function barDrawing(segmented: boolean): Drawing<BarParts> {
  return {
    tall: false,
    build(item, visual, parts) {
      // The icon stands where a button's does; the bar runs along the bottom
      // of the cell, out of the way of the text, so the icon and the name sit
      // exactly where a button's do.
      visual.classList.add('icon-slot');
      const track = document.createElement('div');
      track.className = segmented ? 'segments-track' : 'bar-track';
      track.style.setProperty('--tsr-bar-size', cssLength(item.thickness, '4px'));
      track.style.setProperty('--tsr-bar-radius', item.rounded ? `${item.thickness / 2}px` : '1px');
      if (!item.track) track.classList.add('no-track');
      const count = segmented ? item.segments : 1;
      const fills: HTMLElement[] = [];
      for (let i = 0; i < count; i += 1) {
        const segment = document.createElement('div');
        segment.className = 'segment';
        const fill = document.createElement('div');
        fill.className = 'segment-fill';
        if (item.gradient && item.colors.secondary) {
          fill.style.background = segmented
            ? `color-mix(in oklch, ${item.colors.secondary} ${count > 1 ? Math.round((i / (count - 1)) * 100) : 0}%, var(--tsr-fill))`
            : `linear-gradient(90deg, var(--tsr-fill), ${item.colors.secondary})`;
        }
        segment.appendChild(fill);
        track.appendChild(segment);
        fills.push(fill);
      }
      parts.root.appendChild(track);
      return { ...parts, fills };
    },
    paint(parts, item, view, context) {
      paintIcon(parts, parts.visual, 'icon', view.icon, context);
      const fraction = view.p.progress ?? 1;
      const shares = segmented ? segmentFills(fraction, parts.fills.length) : [fraction];
      // A segment's moving edge is cut straight: a rounded cut inside a
      // rounded segment leaves a crescent that reads as a rendering fault.
      parts.fills.forEach((fill, i) => {
        fill.style.clipPath = clipFor(shares[i] ?? 0, !segmented && item.rounded);
      });
    },
    line(p) {
      // Where a button shows its state, this shows the value - and the status
      // when it is not simply running.
      const status = p.status !== 'active' ? p.statusText : undefined;
      return [p.value, status].filter(Boolean).join(' · ');
    },
  };
}

/* --- digits ------------------------------------------------------------------ */

interface DigitParts extends ProgressParts {
  iconEl?: StateIcon;
  row: HTMLElement;
  groups: HTMLElement[];
  sign: HTMLElement;
  unit: HTMLElement;
  text: HTMLElement;
}

/**
 * The value in digits where the icon is: 02 : 35. Tabular figures keep every
 * group the same width, so "11" and "00" do not make the row twitch.
 */
const digits: Drawing<DigitParts> = {
  tall: true,
  build(item, visual, parts) {
    const row = document.createElement('div');
    row.className = `digits-row${item.tiles ? ' tiles' : ''}`;
    const sign = document.createElement('span');
    sign.className = 'sign';
    const unit = document.createElement('span');
    unit.className = 'unit';
    const text = document.createElement('span');
    text.className = 'digits-text';
    row.append(sign, unit);
    visual.append(row, text);
    return { ...parts, row, groups: [], sign, unit, text };
  },
  paint(parts, item, view, context) {
    const { p } = view;
    // Without its drawing, the icon stands where the digits would.
    if (!view.showDrawing) {
      paintIcon(parts, parts.visual, 'icon', view.icon, context);
      (parts.iconEl as StateIcon).style.display = '';
      parts.row.style.display = 'none';
      parts.text.style.display = 'none';
      return;
    }
    if (parts.iconEl) parts.iconEl.style.display = 'none';
    const groups = p.digits;
    // Text instead of digits: a finished countdown saying so, or an error.
    const asText = groups.length === 0;
    parts.row.style.display = asText ? 'none' : '';
    parts.text.style.display = asText ? '' : 'none';
    parts.text.textContent = asText ? (p.error ? '–' : p.value) : '';

    if (parts.groups.length !== groups.length) {
      parts.groups.forEach((group) => group.remove());
      parts.row.querySelectorAll('.colon').forEach((colon) => colon.remove());
      parts.groups = groups.map((_, i) => {
        const group = document.createElement('span');
        group.className = 'group';
        if (i > 0) {
          const colon = document.createElement('span');
          colon.className = 'colon';
          colon.textContent = ':';
          parts.row.insertBefore(colon, parts.unit);
        }
        parts.row.insertBefore(group, parts.unit);
        return group;
      });
    }
    groups.forEach((value, i) => {
      if (parts.groups[i].textContent !== value) parts.groups[i].textContent = value;
    });
    parts.sign.textContent = p.value.startsWith('+') && p.kind === 'countdown' ? '+' : '';
    parts.unit.textContent = p.unit ?? '';

    // As large as the room and the width allow; set in px, measured from the
    // character count, so it never needs the layout read back.
    const chars =
      groups.join('').length +
      Math.max(0, groups.length - 1) * 0.5 +
      (p.unit ? p.unit.length * 0.5 : 0);
    const { visualSize: size, trackWidth, columns, gap } = context.geometry;
    const span = Math.max(1, Math.min(item.weight, columns));
    const width = Math.max(40, trackWidth * span + gap * (span - 1) - 28);
    const tiles = parts.row.classList.contains('tiles') ? 1.25 : 1;
    const fontSize = Math.floor(Math.min(size * 0.58, width / (Math.max(2, chars) * 0.62 * tiles)));
    parts.visual.style.fontSize = `${fontSize}px`;
  },
  line(p) {
    if (p.kind === 'value') return '';
    return p.statusText ?? p.end ?? '';
  },
};

/* --- the types --------------------------------------------------------------- */

export const ringType = makeType('ring', 'Ring', 'mdi:circle-slice-5', ring);
export const barType = makeType('bar', 'Bar', 'mdi:minus-thick', barDrawing(false));
export const segmentsType = makeType(
  'segments',
  'Segments',
  'mdi:dots-horizontal',
  barDrawing(true),
);
export const digitsType = makeType('digits', 'Digits', 'mdi:numeric', digits);

/** One stylesheet for all four, registered on the first of them. */
ringType.styles = PROGRESS_STYLES;
