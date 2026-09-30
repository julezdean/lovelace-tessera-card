/**
 * Raw points -> one value per time bucket.
 *
 * The functions and the gap rule follow mini-graph-card (src/graph.js), so a
 * graph configured the same way draws the same shape: `delta` is the spread
 * (max - min), `diff` the change (last - first), and an empty bucket carries
 * the last value on - a sensor that did not report did not change - except
 * for delta and diff, where "no change" is 0.
 *
 * Unlike there, buckets are aligned to the clock rather than to "now": a
 * bucket of an hour runs from :00 to :00. The graph then changes when a
 * bucket fills, not on every render, which is what lets it redraw once per
 * bucket instead of once a second.
 */

export type AggregateFunc =
  'avg' | 'median' | 'min' | 'max' | 'first' | 'last' | 'sum' | 'delta' | 'diff';

export const AGGREGATE_FUNCS: AggregateFunc[] = [
  'avg',
  'median',
  'min',
  'max',
  'first',
  'last',
  'sum',
  'delta',
  'diff',
];

export interface Point {
  /** epoch ms */
  t: number;
  v: number;
}

const REDUCERS: Record<AggregateFunc, (values: number[]) => number> = {
  avg: (v) => v.reduce((sum, x) => sum + x, 0) / v.length,
  median: (v) => {
    const sorted = [...v].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  },
  min: (v) => Math.min(...v),
  max: (v) => Math.max(...v),
  first: (v) => v[0],
  last: (v) => v[v.length - 1],
  sum: (v) => v.reduce((sum, x) => sum + x, 0),
  delta: (v) => Math.max(...v) - Math.min(...v),
  diff: (v) => v[v.length - 1] - v[0],
};

export interface Window {
  start: number;
  end: number;
  bucketMs: number;
  count: number;
}

/** The buckets for `hours` ending at the next bucket boundary after `now`. */
export function windowFor(now: number, hours: number, pointsPerHour: number): Window {
  const bucketMs = Math.max(60_000, Math.round(3_600_000 / pointsPerHour));
  const count = Math.max(2, Math.round((hours * 3_600_000) / bucketMs));
  const end = Math.ceil(now / bucketMs) * bucketMs;
  return { start: end - count * bucketMs, end, bucketMs, count };
}

/**
 * One value per bucket, null before the first known value. Points before the
 * window only seed the carried value: the state at the window's start is the
 * last one reported before it.
 */
export function bucketize(
  points: Point[],
  window: Window,
  func: AggregateFunc,
): Array<number | null> {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const out: Array<number | null> = [];
  const zeroGap = func === 'delta' || func === 'diff';
  let last: number | null = null;
  let i = 0;
  while (i < sorted.length && sorted[i].t < window.start) {
    last = sorted[i].v;
    i += 1;
  }
  for (let b = 0; b < window.count; b += 1) {
    const to = window.start + (b + 1) * window.bucketMs;
    const values: number[] = [];
    while (i < sorted.length && sorted[i].t < to) {
      values.push(sorted[i].v);
      i += 1;
    }
    if (values.length) {
      out.push(REDUCERS[func](values));
      last = values[values.length - 1];
    } else if (zeroGap) {
      out.push(last === null ? null : 0);
    } else {
      out.push(last);
    }
  }
  return out;
}

export interface Summary {
  min?: number;
  max?: number;
  avg?: number;
}

/** min, max and mean of what is drawn, for {{min}} {{max}} {{avg}}. */
export function summarize(values: Array<number | null>): Summary {
  const known = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (!known.length) return {};
  return {
    min: Math.min(...known),
    max: Math.max(...known),
    avg: known.reduce((sum, x) => sum + x, 0) / known.length,
  };
}
