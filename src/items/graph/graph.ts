import { drawingShown } from '../../core/active';
import { formatState } from '../../core/state';
import { hasTemplate } from '../../core/templates';
import {
  AGGREGATE_FUNCS,
  bucketize,
  summarize,
  windowFor,
  type AggregateFunc,
} from '../../graph/aggregate';
import {
  pointsOf,
  subscribeHistory,
  toValue,
  type HistoryData,
  type LineSource,
} from '../../graph/history';
import {
  barPath,
  linePaths,
  parseBound,
  scaleFor,
  thresholdStops,
  VIEW_H,
  VIEW_W,
  type Bound,
  type Stop,
} from '../../graph/scale';
import { resolveColor } from '../../progress/colors';
import { formatNumber } from '../../progress/format';
import type { Dict, HassEntity, HomeAssistant, ItemBase } from '../../types';
import { cssLength, isDict } from '../../utils';
import { resolveIcon, resolveName } from '../button/button';
import type { CellParts, ItemType, SyncContext } from '../item-type';
import { graphEditor } from './editor';
import { GRAPH_STYLES } from './styles';

/**
 * A sensor's recent history, modelled on mini-graph-card: its options where
 * they make sense in a cell, drawn full-bleed along the bottom of the cell.
 *
 * Two arrangements (`graph_layout`):
 *   split       the text on top - icon beside name and value, as a button
 *               with `layout: horizontal` has it - and the graph below
 *   background  a button's arrangement, with the graph behind it
 *
 * A graph is a display, not a switch: it never counts as active, whatever
 * its value, so a wall of temperatures does not light up.
 */

const SVG = 'http://www.w3.org/2000/svg';

/**
 * Colours for lines without one: the accent first, then Home Assistant's own
 * palette, so a graph follows the theme instead of bringing colours along.
 */
export const PALETTE = [
  'var(--tsr-accent)',
  'var(--blue-color, #2196f3)',
  'var(--orange-color, #ff9800)',
  'var(--green-color, #4caf50)',
  'var(--purple-color, #9c27b0)',
  'var(--red-color, #f44336)',
];

export interface GraphLine extends LineSource {
  name?: string;
  color: string;
  fill: boolean | 'fade';
  aggregate_func: AggregateFunc;
  smoothing: boolean;
  /**
   * Which scale the line is drawn on. `secondary` gives it one of its own,
   * as mini-graph-card's y_axis does - a humidity next to a temperature
   * would otherwise flatten the temperature to a straight line.
   */
  y_axis: 'primary' | 'secondary';
}

export interface GraphItem extends ItemBase {
  type: 'graph';
  name: unknown;
  icon: unknown;
  label: unknown;
  show_name: unknown;
  unit?: string;
  decimals?: number;
  hours_to_show: number;
  points_per_hour: number;
  graph: 'line' | 'bar';
  line_width: number;
  lower_bound: Bound;
  upper_bound: Bound;
  min_bound_range: number | null;
  lower_bound_secondary: Bound;
  upper_bound_secondary: Bound;
  min_bound_range_secondary: number | null;
  logarithmic: boolean;
  bar_spacing: number;
  graph_layout: 'split' | 'background';
  graph_height: string;
  thresholds: Array<{ value: number; color: string }>;
  threshold_transition: 'smooth' | 'hard';
  /** The item's own entity first, then `lines:`. */
  lines: GraphLine[];
}

interface GraphParts extends CellParts {
  name: HTMLElement;
  icon: HTMLElement & { icon?: string; hass?: HomeAssistant; stateObj?: HassEntity };
  svg: SVGSVGElement;
  lines: Array<{ fill: SVGPathElement; line: SVGPathElement; fade: SVGLinearGradientElement }>;
  thresholds: SVGLinearGradientElement | null;
}

interface GraphView {
  name: string;
  showName: boolean;
  icon: string | null;
  line: string;
  paths: Array<{ line: string; fill: string }>;
  stops: Stop[] | null;
  refreshAt: number | null;
  showDrawing: boolean;
}

/* --- configuration ------------------------------------------------------ */

const DEFAULTS: Dict = {
  show_name: true,
  hours_to_show: 24,
  points_per_hour: 1,
  aggregate_func: 'avg',
  graph: 'line',
  fill: 'fade',
  smoothing: true,
  line_width: 2,
  logarithmic: false,
  bar_spacing: 2,
  graph_layout: 'split',
  graph_height: '50%',
  color_thresholds_transition: 'smooth',
};

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function positive(value: unknown, fallback: number, max = Infinity): number {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
}

function fillOf(value: unknown, fallback: boolean | 'fade'): boolean | 'fade' {
  if (value === 'fade') return 'fade';
  if (value === true || value === false) return value;
  return fallback;
}

function stateMap(value: unknown): Record<string, number> | undefined {
  if (!isDict(value)) return undefined;
  const out: Record<string, number> = {};
  Object.entries(value).forEach(([key, v]) => {
    const n = Number(v);
    if (Number.isFinite(n)) out[key] = n;
  });
  return out;
}

function thresholdsOf(src: Dict): Array<{ value: number; color: string }> {
  // `colors.thresholds` as the progress types spell it; `color_thresholds`
  // as mini-graph-card does - a config copied from there still works.
  const colors = isDict(src.colors) ? src.colors : {};
  const raw = colors.thresholds ?? src.color_thresholds;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is Dict => isDict(entry) && typeof entry.color === 'string')
    .map((entry) => ({
      value: Number(entry.value),
      color: resolveColor(entry.color as string) as string,
    }))
    .filter((entry) => Number.isFinite(entry.value));
}

function normalizeGraph(src: Dict, base: ItemBase, defaults: Dict): GraphItem {
  const pick = (key: string) => src[key] ?? defaults[key];
  const func = oneOf(pick('aggregate_func'), AGGREGATE_FUNCS, 'avg');
  const fill = fillOf(pick('fill'), 'fade');
  const smoothing = pick('smoothing') !== false;
  const factor = Number(pick('value_factor')) || 0;

  const main: GraphLine | null = base.entity
    ? {
        entity: base.entity,
        attribute: typeof src.attribute === 'string' ? src.attribute : undefined,
        state_map: stateMap(pick('state_map')),
        value_factor: factor,
        color: PALETTE[0],
        fill,
        aggregate_func: func,
        smoothing,
        // The main line sets the primary scale; that is what its value and
        // the thresholds refer to.
        y_axis: 'primary',
      }
    : null;

  const extra = (Array.isArray(src.lines) ? src.lines : [])
    .filter((line): line is Dict => isDict(line) && typeof line.entity === 'string')
    .map((line, i) => ({
      entity: line.entity as string,
      name: typeof line.name === 'string' ? line.name : undefined,
      attribute: typeof line.attribute === 'string' ? line.attribute : undefined,
      state_map: stateMap(line.state_map) ?? main?.state_map,
      value_factor: Number(line.value_factor ?? factor) || 0,
      color:
        resolveColor(typeof line.color === 'string' ? line.color : undefined) ??
        PALETTE[((main ? 1 : 0) + i) % PALETTE.length],
      // Further lines are lines, not areas, unless asked: several fills on
      // top of each other only muddy the one that matters.
      fill: fillOf(line.fill, false),
      aggregate_func: oneOf(line.aggregate_func, AGGREGATE_FUNCS, func),
      smoothing: line.smoothing === undefined ? smoothing : line.smoothing !== false,
      y_axis: (line.y_axis === 'secondary' ? 'secondary' : 'primary') as GraphLine['y_axis'],
    }));

  const height = pick('graph_height');
  const decimals = Number(pick('decimals'));
  const range = (key: string) => {
    const value = Number(pick(key));
    return Number.isFinite(value) && value > 0 ? value : null;
  };

  return {
    ...base,
    type: 'graph',
    name: src.name ?? null,
    icon: src.icon ?? null,
    label: src.label ?? null,
    show_name: pick('show_name'),
    unit: typeof pick('unit') === 'string' ? (pick('unit') as string) : undefined,
    decimals: Number.isFinite(decimals) && pick('decimals') !== undefined ? decimals : undefined,
    hours_to_show: positive(pick('hours_to_show'), 24, 24 * 10),
    points_per_hour: positive(pick('points_per_hour'), 1, 60),
    graph: oneOf(pick('graph'), ['line', 'bar'] as const, 'line'),
    line_width: positive(pick('line_width'), 2, 12),
    lower_bound: parseBound(pick('lower_bound')),
    upper_bound: parseBound(pick('upper_bound')),
    min_bound_range: range('min_bound_range'),
    lower_bound_secondary: parseBound(pick('lower_bound_secondary')),
    upper_bound_secondary: parseBound(pick('upper_bound_secondary')),
    min_bound_range_secondary: range('min_bound_range_secondary'),
    logarithmic: pick('logarithmic') === true,
    bar_spacing: Math.max(0, Number(pick('bar_spacing')) || 0),
    graph_layout: oneOf(pick('graph_layout'), ['split', 'background'] as const, 'split'),
    graph_height: cssLength(height, '50%'),
    thresholds: thresholdsOf(src).length ? thresholdsOf(src) : thresholdsOf(defaults),
    threshold_transition: oneOf(
      pick('color_thresholds_transition'),
      ['smooth', 'hard'] as const,
      'smooth',
    ),
    lines: [...(main ? [main] : []), ...extra],
    error: base.error ?? (main || extra.length ? null : 'A graph needs an entity'),
  };
}

/* --- the view ------------------------------------------------------------- */

function fillLabel(
  text: string,
  values: Record<string, string | undefined>,
  entity?: HassEntity,
): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => {
    if (key.startsWith('attributes.')) {
      const value = entity?.attributes?.[key.slice('attributes.'.length)];
      return value === undefined || value === null ? '' : String(value);
    }
    return values[key] ?? '';
  });
}

/**
 * The precision the entity reports in: min and max of "21.4" read 18.9, of
 * "212" read 905. A sensor that reports whole watts has nothing after the point.
 */
export function decimalsOf(state: string | undefined): number {
  const match = /^-?\d+(?:\.(\d+))?$/.exec(String(state ?? '').trim());
  return match && match[1] ? Math.min(3, match[1].length) : 0;
}

function currentValue(
  item: GraphItem,
  hass: HomeAssistant,
  stateObj: HassEntity | undefined,
): string {
  if (!stateObj) return '';
  const unit = item.unit ?? stateObj.attributes?.unit_of_measurement ?? '';
  const main = item.lines[0];
  const raw = main?.attribute ? stateObj.attributes?.[main.attribute] : stateObj.state;
  // Your own decimals or unit is a request to format it yourself; otherwise
  // Home Assistant's own formatting, as a button shows the state.
  if (item.decimals !== undefined || item.unit !== undefined || main?.attribute) {
    const value = main ? toValue(raw, { ...main, state_map: undefined }) : undefined;
    if (value === undefined) return raw === undefined ? '' : String(raw);
    const number = formatNumber(
      value,
      item.decimals ?? decimalsOf(String(raw)),
      hass.locale?.language || hass.language || 'en',
    );
    return unit ? `${number} ${unit}` : number;
  }
  return formatState(hass, stateObj);
}

function graphView(item: GraphItem, context: SyncContext): GraphView {
  const { hass, stateObj, resolve, now } = context;
  const history = (context.data as HistoryData | undefined) ?? null;
  const window = windowFor(now, item.hours_to_show, item.points_per_hour);

  const series = item.lines.map((line) =>
    history ? bucketize(pointsOf(history, line), window, line.aggregate_func) : [],
  );
  // Each axis is scaled by its own lines only. Without a secondary line the
  // secondary scale is simply never used.
  const on = (axis: GraphLine['y_axis']) => series.filter((_, i) => item.lines[i].y_axis === axis);
  const scale0 = scaleFor(
    on('primary'),
    item.lower_bound,
    item.upper_bound,
    item.min_bound_range,
    item.logarithmic,
  );
  const secondary = scaleFor(
    on('secondary'),
    item.lower_bound_secondary,
    item.upper_bound_secondary,
    item.min_bound_range_secondary,
    item.logarithmic,
  );

  const bars = item.graph === 'bar';
  const paths = series.map((values, i) => {
    const scale = item.lines[i].y_axis === 'secondary' ? secondary : scale0;
    if (!scale || !values.length) return { line: '', fill: '' };
    if (bars) return { line: '', fill: barPath(values, scale, i, series.length, item.bar_spacing) };
    return linePaths(values, scale, item.lines[i].smoothing);
  });

  const locale = hass.locale?.language || hass.language || 'en';
  const summary = summarize(series[0] ?? []);
  const unit = item.unit ?? stateObj?.attributes?.unit_of_measurement ?? '';
  const decimals = item.decimals ?? decimalsOf(stateObj?.state);
  const fmt = (value: number | undefined) =>
    value === undefined ? undefined : formatNumber(value, decimals, locale);
  const value = currentValue(item, hass, stateObj);
  const name = resolveName(item, stateObj, resolve);

  const label = resolve(item.label);
  let line = value;
  if (label !== undefined && label !== null && label !== '') {
    line = hasTemplate(item.label)
      ? String(label)
      : fillLabel(
          String(label),
          {
            value,
            name,
            state: stateObj?.state,
            unit,
            min: fmt(summary.min),
            max: fmt(summary.max),
            avg: fmt(summary.avg),
          },
          stateObj,
        );
  }

  return {
    name,
    showName: item.show_name === false ? false : resolve(item.show_name) !== false,
    icon: resolveIcon(item, stateObj, resolve),
    line,
    paths,
    stops:
      scale0 && item.thresholds.length
        ? thresholdStops(item.thresholds, scale0, item.threshold_transition === 'hard')
        : null,
    // The window moves on when the current bucket is full.
    refreshAt: window.end,
    // A graph is never active by itself; active_when can make it so, and
    // show_drawing: active then shows the graph only while it is.
    showDrawing: drawingShown(item, resolve, context.activeWhen ?? false),
  };
}

/* --- drawing ---------------------------------------------------------------- */

let gradientCounter = 0;

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
  return el;
}

function gradient(id: string, stops: Array<[string, string, string]>): SVGLinearGradientElement {
  const el = svgEl('linearGradient', { id, x1: '0', y1: '0', x2: '0', y2: '1' });
  stops.forEach(([offset, color, opacity]) => {
    el.appendChild(
      svgEl('stop', { offset, style: `stop-color: ${color}; stop-opacity: ${opacity}` }),
    );
  });
  return el;
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
  const display = text ? '' : 'none';
  if (el.style.display !== display) el.style.display = display;
}

export const graphType: ItemType<GraphItem, GraphParts, GraphView> = {
  type: 'graph',
  label: 'Graph',
  icon: 'mdi:chart-bell-curve-cumulative',
  defaults: DEFAULTS,
  defaultActions: { tap: 'more-info', hold: 'none' },
  templatedFields: ['name', 'icon', 'label', 'show_name'],
  styles: GRAPH_STYLES,

  normalize: (src, base, { defaults }) => normalizeGraph(src, base, defaults),

  build(item, root) {
    root.classList.add('graph', `graph-${item.graph_layout}`);
    root.style.setProperty('--tsr-graph-h', item.graph_height);
    root.style.setProperty('--tsr-graph-line', `${item.line_width}px`);

    const area = document.createElement('div');
    area.className = 'graph-area';
    const svg = svgEl('svg', {
      viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
      preserveAspectRatio: 'none',
      'aria-hidden': 'true',
    });
    const defs = svgEl('defs', {});
    svg.appendChild(defs);

    let thresholds: SVGLinearGradientElement | null = null;
    let thresholdId = '';
    if (item.thresholds.length) {
      thresholdId = `tsr-graph-t-${++gradientCounter}`;
      // In the drawing's own coordinates, so a stop's offset is a value.
      thresholds = svgEl('linearGradient', {
        id: thresholdId,
        gradientUnits: 'userSpaceOnUse',
        x1: '0',
        y1: String(VIEW_H),
        x2: '0',
        y2: '0',
      });
      defs.appendChild(thresholds);
    }

    const lines = item.lines.map((line, i) => {
      const color = i === 0 && thresholdId ? `url(#${thresholdId})` : line.color;
      const fadeId = `tsr-graph-f-${++gradientCounter}`;
      const fade = gradient(fadeId, [
        ['0', i === 0 && thresholdId ? 'var(--tsr-graph-top)' : line.color, '0.34'],
        ['1', i === 0 && thresholdId ? 'var(--tsr-graph-top)' : line.color, '0'],
      ]);
      defs.appendChild(fade);
      const fill = svgEl('path', { class: `graph-fill${item.graph === 'bar' ? ' bars' : ''}` });
      if (item.graph === 'bar') fill.style.fill = color;
      else if (line.fill === 'fade') fill.style.fill = `url(#${fadeId})`;
      else if (line.fill === true) fill.style.fill = color;
      else fill.style.display = 'none';
      if (line.fill === true && item.graph !== 'bar') fill.style.opacity = '0.22';
      const stroke = svgEl('path', { class: 'graph-line' });
      stroke.style.stroke = color;
      if (item.graph === 'bar') stroke.style.display = 'none';
      svg.append(fill, stroke);
      return { fill, line: stroke, fade };
    });
    area.appendChild(svg);

    const icon = document.createElement('ha-icon') as GraphParts['icon'];
    icon.className = 'icon';
    const labels = document.createElement('div');
    labels.className = 'labels';
    const name = document.createElement('div');
    name.className = 'name';
    const state = document.createElement('div');
    state.className = 'state';
    labels.append(name, state);

    if (item.graph_layout === 'split') {
      const head = document.createElement('div');
      head.className = 'graph-head';
      head.append(icon, labels);
      root.append(area, head);
    } else {
      root.append(area, icon, labels);
    }
    return { root, state, name, icon, svg, lines, thresholds };
  },

  view: graphView,
  activeOf: () => false,
  refreshOf: (view) => view.refreshAt,

  subscribe(item, hass, onData) {
    const ids = [...new Set(item.lines.map((line) => line.entity))];
    const withAttributes = item.lines.some((line) => !!line.attribute);
    return subscribeHistory(hass, ids, item.hours_to_show, withAttributes, onData);
  },

  paint(parts, _item, view, context) {
    const wantsState = !view.icon && !!context.stateObj;
    const tag = wantsState ? 'ha-state-icon' : 'ha-icon';
    if (parts.icon.tagName.toLowerCase() !== tag) {
      const next = document.createElement(tag) as GraphParts['icon'];
      next.className = parts.icon.className;
      parts.icon.replaceWith(next);
      parts.icon = next;
    }
    if (wantsState) {
      parts.icon.hass = context.hass;
      parts.icon.stateObj = context.stateObj;
    } else {
      parts.icon.icon =
        view.icon || (context.missing ? 'mdi:alert-circle-outline' : 'mdi:chart-line');
    }

    parts.root.classList.toggle('drawing-off', !view.showDrawing);
    setText(parts.name, view.showName ? view.name : '');
    setText(parts.state, view.line);
    parts.root.setAttribute('aria-label', [view.name, view.line].filter(Boolean).join(', '));

    view.paths.forEach((path, i) => {
      const line = parts.lines[i];
      if (!line) return;
      if (line.line.getAttribute('d') !== path.line) line.line.setAttribute('d', path.line);
      if (line.fill.getAttribute('d') !== path.fill) line.fill.setAttribute('d', path.fill);
    });

    if (parts.thresholds) {
      parts.thresholds.replaceChildren(
        ...(view.stops ?? []).map((stop) =>
          svgEl('stop', { offset: String(stop.offset), style: `stop-color: ${stop.color}` }),
        ),
      );
      // The fade under a threshold-coloured line takes the colour at its top.
      const top = view.stops && view.stops.length ? view.stops[view.stops.length - 1].color : '';
      if (top) parts.root.style.setProperty('--tsr-graph-top', top);
    }
  },

  arrange(parts, item, { nameSize, iconSize }) {
    // The graph may take the configured share of the cell, but never the room
    // the text above it needs.
    const head =
      item.graph_layout === 'split'
        ? 10 + Math.max(iconSize * 0.8, nameSize * 1.2 + 2 + (nameSize - 2) * 1.2) + 6
        : 0;
    parts.root.style.setProperty('--tsr-graph-head', `${Math.round(head)}px`);
  },

  editor: graphEditor,
};
