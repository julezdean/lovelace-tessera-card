// Adapted from lovelace-advanced-countdown-card (src/utils/colors.ts). The
// primary colour is the item's accent here, so it is passed in.

import type { ColorConfig, Threshold } from './types';

/**
 * Colours stay CSS all the way down. A user may write a hex value, an rgb(),
 * a theme variable or one of Home Assistant's named colours, and only the
 * browser can resolve a var() -- so interpolation uses color-mix() instead of
 * arithmetic on hex strings, and works on all four.
 */

/** The names the `ui_color` selector offers, which map to theme variables. */
const HA_COLOR_NAMES = new Set([
  'primary',
  'accent',
  'red',
  'pink',
  'purple',
  'deep-purple',
  'indigo',
  'blue',
  'light-blue',
  'cyan',
  'teal',
  'green',
  'light-green',
  'lime',
  'yellow',
  'amber',
  'orange',
  'deep-orange',
  'brown',
  'light-grey',
  'grey',
  'dark-grey',
  'blue-grey',
  'black',
  'white',
  'disabled',
]);

/** A colour as written in the config -> something a CSS property accepts. */
export function resolveColor(value: string | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  if (!text) return undefined;
  if (HA_COLOR_NAMES.has(text)) return `var(--${text}-color)`;
  // A bare custom property name is a common shorthand in HA themes.
  if (text.startsWith('--')) return `var(${text})`;
  return text;
}

/**
 * Mixes `from` into `to`; t = 0 is `from`, t = 1 is `to`.
 *
 * In OKLCH, not sRGB: sRGB interpolates straight through the grey middle, so
 * green -> red passes through brown and blue -> orange through a flat grey.
 * OKLCH keeps lightness and chroma and walks the hue, so the same pair goes
 * green -> yellow -> red -- the traffic light a countdown gradient is meant
 * to be.
 */
export function mixColors(from: string, to: string, t: number): string {
  const share = Math.round(Math.min(1, Math.max(0, t)) * 1000) / 10;
  if (share <= 0) return from;
  if (share >= 100) return to;
  return `color-mix(in oklch, ${to} ${share}%, ${from})`;
}

/**
 * The first threshold whose value the metric reaches, scanning from the top.
 * Below the lowest threshold the lowest colour still applies -- a value of -5
 * on a 0/40/75 scale is "red", not "no colour".
 */
export function pickThreshold(metric: number, thresholds: Threshold[]): string | undefined {
  if (!thresholds.length) return undefined;
  const sorted = [...thresholds].sort((a, b) => b.value - a.value);
  const hit = sorted.find((t) => metric >= t.value) ?? sorted[sorted.length - 1];
  return resolveColor(hit.color);
}

export interface ColorInput {
  /** Fill as shown, 0..1, or null if unknown. */
  progress: number | null;
  /** 0 at the start of the course, 1 at its end -- independent of direction. */
  course: number | null;
  remainingMs?: number;
  value?: number;
}

export function progressColor(colors: ColorConfig, primary: string, input: ColorInput): string {
  if (colors.mode === 'thresholds') {
    let metric: number | undefined;
    if (colors.basis === 'remaining_seconds') {
      metric = input.remainingMs === undefined ? undefined : input.remainingMs / 1000;
    } else if (colors.basis === 'value') {
      metric = input.value;
    } else {
      metric = input.progress === null ? undefined : input.progress * 100;
    }
    if (metric === undefined) return primary;
    return pickThreshold(metric, colors.thresholds) ?? primary;
  }

  if (colors.mode === 'gradient') {
    if (input.course === null) return primary;
    const start = resolveColor(colors.start) ?? primary;
    const end = resolveColor(colors.end) ?? resolveColor(colors.secondary) ?? primary;
    return mixColors(start, end, input.course);
  }

  return primary;
}
