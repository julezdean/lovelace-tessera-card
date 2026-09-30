/**
 * The vertical scale and the drawing.
 *
 * The SVG is drawn in a fixed 300 x 100 viewBox stretched to the cell with
 * preserveAspectRatio="none", and strokes are non-scaling. So the path does
 * not depend on the cell's size - no layout has to be read back to draw it -
 * and a 2 px line is 2 px however wide the cell is.
 */

export const VIEW_W = 300;
export const VIEW_H = 100;
/** Room above and below the line, so its stroke and a peak are not cut off. */
const PAD_Y = 6;

/** `15` is a hard bound; `~15` a soft one, which the data may push past. */
export type Bound = { value: number; soft: boolean } | null;

export function parseBound(raw: unknown): Bound {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? { value: raw, soft: false } : null;
  const text = String(raw).trim();
  const soft = text.startsWith('~');
  const value = Number(soft ? text.slice(1) : text);
  return Number.isFinite(value) ? { value, soft } : null;
}

export interface Scale {
  min: number;
  max: number;
  log: boolean;
}

/**
 * Bounds from the data, then the configured ones: a hard bound replaces the
 * data's, a soft one widens it only. min_bound_range keeps a flat line from
 * filling the whole height with noise - 21.3 to 21.4 °C is not a mountain.
 */
export function scaleFor(
  series: Array<Array<number | null>>,
  lower: Bound,
  upper: Bound,
  minRange: number | null,
  log: boolean,
): Scale | null {
  const values = series.flat().filter((v): v is number => v !== null && Number.isFinite(v));
  if (!values.length) return null;
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (lower) min = lower.soft ? Math.min(min, lower.value) : lower.value;
  if (upper) max = upper.soft ? Math.max(max, upper.value) : upper.value;
  if (minRange && max - min < minRange) {
    const grow = (minRange - (max - min)) / 2;
    min -= grow;
    max += grow;
  }
  if (max <= min) {
    // One flat value: put it in the middle rather than on the floor.
    min -= 1;
    max += 1;
  }
  if (log && min <= 0) log = false; // a log scale has no zero
  return { min, max, log };
}

export function yOf(value: number, scale: Scale): number {
  const t = scale.log
    ? (Math.log10(value) - Math.log10(scale.min)) / (Math.log10(scale.max) - Math.log10(scale.min))
    : (value - scale.min) / (scale.max - scale.min);
  const clamped = Math.min(1, Math.max(0, t));
  return round(VIEW_H - PAD_Y - clamped * (VIEW_H - 2 * PAD_Y));
}

const round = (n: number) => Math.round(n * 100) / 100;

type XY = [number, number];

/** Runs of consecutive known values, as coordinates. A gap splits the line. */
function runs(values: Array<number | null>, scale: Scale): XY[][] {
  const out: XY[][] = [];
  let current: XY[] = [];
  const step = values.length > 1 ? VIEW_W / (values.length - 1) : VIEW_W;
  values.forEach((value, i) => {
    if (value === null || !Number.isFinite(value)) {
      if (current.length) out.push(current);
      current = [];
      return;
    }
    current.push([round(i * step), yOf(value, scale)]);
  });
  if (current.length) out.push(current);
  return out;
}

/**
 * The line through the points. Smoothed the way mini-graph-card does it: a
 * quadratic curve through each point, ending halfway to the next, so the
 * line passes near every value and never overshoots between two of them.
 */
function runPath(run: XY[], smooth: boolean): string {
  if (run.length === 1) {
    const [x, y] = run[0];
    return `M${x},${y}h0.01`;
  }
  let d = `M${run[0][0]},${run[0][1]}`;
  if (!smooth) {
    for (let i = 1; i < run.length; i += 1) d += `L${run[i][0]},${run[i][1]}`;
    return d;
  }
  for (let i = 1; i < run.length - 1; i += 1) {
    const [x, y] = run[i];
    const mx = round((x + run[i + 1][0]) / 2);
    const my = round((y + run[i + 1][1]) / 2);
    d += `Q${x},${y} ${mx},${my}`;
  }
  const last = run[run.length - 1];
  return `${d}L${last[0]},${last[1]}`;
}

export interface Paths {
  line: string;
  fill: string;
}

export function linePaths(values: Array<number | null>, scale: Scale, smooth: boolean): Paths {
  const parts = runs(values, scale);
  const line = parts.map((run) => runPath(run, smooth)).join('');
  // The fill closes each run down to the bottom edge - full-bleed, so it
  // meets the cell's own edge.
  const fill = parts
    .map((run) => {
      const first = run[0];
      const last = run[run.length - 1];
      return `${runPath(run, smooth)}L${last[0]},${VIEW_H}L${first[0]},${VIEW_H}Z`;
    })
    .join('');
  return { line, fill };
}

/**
 * Bars: one slot per bucket, shared side by side by the lines drawn as bars.
 * Returned as one path, so a line's bars are a single element to update.
 */
export function barPath(
  values: Array<number | null>,
  scale: Scale,
  lane: number,
  lanes: number,
  spacing: number,
): string {
  const slot = VIEW_W / values.length;
  const gap = Math.min(slot * 0.4, spacing);
  const width = Math.max(0.5, (slot - gap) / lanes);
  const base = yOf(scale.log ? scale.min : Math.max(scale.min, Math.min(0, scale.max)), scale);
  let d = '';
  values.forEach((value, i) => {
    if (value === null || !Number.isFinite(value)) return;
    const x = round(i * slot + gap / 2 + lane * width);
    const y = yOf(value, scale);
    const top = Math.min(y, base);
    const height = Math.max(0.6, Math.abs(base - y));
    d += `M${x},${round(top)}h${round(width)}v${round(height)}h${round(-width)}Z`;
  });
  return d;
}

export interface Stop {
  /** 0..1 from the bottom of the drawing to its top. */
  offset: number;
  color: string;
}

/**
 * Colour thresholds as stops of a vertical gradient: the line is red where
 * it is above the red value, and so on. `hard` gives each band one colour;
 * `smooth` blends between the thresholds, as mini-graph-card's default does.
 */
export function thresholdStops(
  thresholds: Array<{ value: number; color: string }>,
  scale: Scale,
  hard: boolean,
): Stop[] {
  const sorted = [...thresholds].sort((a, b) => a.value - b.value);
  const at = (value: number) => (VIEW_H - yOf(value, scale)) / VIEW_H;
  const stops: Stop[] = [];
  sorted.forEach((threshold, i) => {
    const offset = Math.min(1, Math.max(0, at(threshold.value)));
    if (hard) {
      if (i > 0) stops.push({ offset, color: sorted[i - 1].color });
      stops.push({ offset, color: threshold.color });
    } else {
      stops.push({ offset, color: threshold.color });
    }
  });
  if (hard && sorted.length) stops.unshift({ offset: 0, color: sorted[0].color });
  return stops;
}
