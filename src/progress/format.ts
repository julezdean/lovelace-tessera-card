// Adapted from lovelace-advanced-countdown-card (src/utils/format.ts): the
// same functions, typed against this card's FormatConfig.

import type { FormatConfig, FormatStyle, Tristate } from './types';

/**
 * Time formatting.
 *
 * A countdown rounds UP to its smallest visible unit. With seconds shown,
 * 0.4 s left reads 00:01 and 00:00 appears exactly when the time is up -- the
 * convention of every kitchen timer. Rounding down would show 00:00 for the
 * whole last second, which reads as "done" while it is not. Elapsed time
 * (count_up) rounds down for the same reason in reverse.
 */

export type Unit = 'd' | 'h' | 'm' | 's';
const ORDER: Unit[] = ['d', 'h', 'm', 's'];
const UNIT_MS: Record<Unit, number> = {
  d: 86_400_000,
  h: 3_600_000,
  m: 60_000,
  s: 1000,
};
const SHOW_KEY: Record<Unit, keyof FormatConfig> = {
  d: 'show_days',
  h: 'show_hours',
  m: 'show_minutes',
  s: 'show_seconds',
};
const PATTERN_UNITS: Partial<Record<FormatStyle, Unit[]>> = {
  SS: ['s'],
  'MM:SS': ['m', 's'],
  'HH:MM:SS': ['h', 'm', 's'],
  'DD:HH:MM:SS': ['d', 'h', 'm', 's'],
};
const INTL_UNIT: Record<Unit, string> = {
  d: 'day',
  h: 'hour',
  m: 'minute',
  s: 'second',
};

export interface FormattedDuration {
  text: string;
  /** The zero-padded groups of a colon format, for the digital renderer. */
  groups: string[];
}

/** Splits `ms` over `units`; the largest unit absorbs everything above it. */
export function splitDuration(
  ms: number,
  units: Unit[],
  round: 'up' | 'down',
): Record<Unit, number> {
  const smallest = UNIT_MS[units[units.length - 1]];
  const steps = round === 'up' ? Math.ceil(ms / smallest) : Math.floor(ms / smallest);
  let rest = Math.max(0, steps) * smallest;
  const out: Record<Unit, number> = { d: 0, h: 0, m: 0, s: 0 };
  for (const unit of units) {
    out[unit] = Math.floor(rest / UNIT_MS[unit]);
    rest -= out[unit] * UNIT_MS[unit];
  }
  return out;
}

function applyShow(units: Unit[], format: FormatConfig): Unit[] {
  const chosen = units.filter((unit) => format[SHOW_KEY[unit]] !== false);
  // show_x: true adds a unit the pattern would not have had.
  for (const unit of ORDER) {
    if (format[SHOW_KEY[unit]] === true && !chosen.includes(unit)) chosen.push(unit);
  }
  chosen.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  return chosen.length ? chosen : ['s'];
}

/**
 * `auto` picks the shortest honest format for the magnitude:
 *   under an hour  -> MM:SS
 *   under a day    -> H:MM:SS
 *   a day or more  -> 2d 04h 12m (a colon format with days is unreadable)
 */
function autoUnits(ms: number): { units: Unit[]; style: 'colon' | 'short' } {
  if (ms >= UNIT_MS.d) return { units: ['d', 'h', 'm'], style: 'short' };
  if (ms >= UNIT_MS.h) return { units: ['h', 'm', 's'], style: 'colon' };
  return { units: ['m', 's'], style: 'colon' };
}

function unitFormatter(locale: string, unit: Unit): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: INTL_UNIT[unit],
      unitDisplay: 'long',
    });
  } catch {
    return new Intl.NumberFormat('en', {
      style: 'unit',
      unit: INTL_UNIT[unit],
      unitDisplay: 'long',
    });
  }
}

function joinList(locale: string, parts: string[]): string {
  try {
    return new Intl.ListFormat(locale, { style: 'long', type: 'unit' }).format(parts);
  } catch {
    return parts.join(' ');
  }
}

/** Drops leading zero units, but always keeps at least the last one. */
function trimLeading(units: Unit[], values: Record<Unit, number>): Unit[] {
  const first = units.findIndex((unit) => values[unit] > 0);
  return first === -1 ? units.slice(-1) : units.slice(first);
}

export function formatDuration(
  ms: number,
  format: FormatConfig,
  locale: string,
  round: 'up' | 'down' = 'up',
): FormattedDuration {
  const magnitude = Math.abs(ms);
  let style: 'colon' | 'short' | 'long';
  let units: Unit[];

  if (format.style === 'auto') {
    const picked = autoUnits(magnitude);
    style = picked.style;
    units = applyShow(picked.units, format);
  } else if (format.style === 'short' || format.style === 'long') {
    style = format.style;
    units = applyShow(ORDER, format);
  } else {
    style = 'colon';
    units = applyShow(PATTERN_UNITS[format.style] ?? ['m', 's'], format);
  }

  let values = splitDuration(magnitude, units, round);

  if (style === 'colon') {
    // In auto mode a leading zero hour is dropped (59:59, not 0:59:59) --
    // but the choice was made on the unrounded value, so 59:59.5 rounded up
    // to 1:00:00 must be re-split to keep the hour.
    if (format.style === 'auto' && units[0] === 'm' && values.m >= 60) {
      units = applyShow(['h', 'm', 's'], format);
      values = splitDuration(magnitude, units, round);
    }
    const groups = units.map((unit) => String(values[unit]).padStart(2, '0'));
    return { text: groups.join(':'), groups };
  }

  // auto for a day or more shows all three of d/h/m -- "2d 04h 12m" is the
  // point of it; largest_units applies when short/long is chosen explicitly.
  const limit = format.style === 'auto' ? units.length : Math.max(1, format.largest_units);
  let visible = trimLeading(units, values).slice(0, limit);
  // Rounding up happened at the smallest configured unit; once units are cut
  // off, the rounding has to move to the new smallest one, or 2h 33m 10s would
  // read "2h 33m" with the minutes rounded down.
  let recut = splitDuration(magnitude, visible, round);
  // Rounding can carry into a larger unit (1h 59m 50s -> "2h 00m"), and a
  // trailing zero says nothing: "1 hour", not "1 hour, 0 minutes". auto keeps
  // its fixed shape so the width does not jump while it counts down.
  if (format.style !== 'auto') {
    while (visible.length > 1 && recut[visible[visible.length - 1]] === 0) {
      visible = visible.slice(0, -1);
    }
    recut = splitDuration(magnitude, visible, round);
  }

  if (style === 'short') {
    const text = visible
      .map((unit, i) => {
        const value = String(recut[unit]);
        return `${i === 0 ? value : value.padStart(2, '0')}${unit}`;
      })
      .join(' ');
    return { text, groups: visible.map((unit) => String(recut[unit])) };
  }

  const parts = visible.map((unit) => unitFormatter(locale, unit).format(recut[unit]));
  return { text: joinList(locale, parts), groups: parts };
}

export function formatNumber(value: number, decimals: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  } catch {
    return value.toFixed(decimals);
  }
}

export function formatPercent(fraction: number, decimals: number, locale: string): string {
  return `${formatNumber(fraction * 100, decimals, locale)} %`;
}

/** Wall-clock time of an instant, following the user's time-zone setting. */
export function formatClock(
  epochMs: number,
  locale: string,
  timeZone: string | undefined,
  withDate: boolean,
  hour12?: boolean,
): string {
  const options: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  };
  if (hour12 !== undefined) options.hour12 = hour12;
  if (withDate) {
    options.day = 'numeric';
    options.month = 'short';
  }
  try {
    return new Intl.DateTimeFormat(locale, options).format(new Date(epochMs));
  } catch {
    return new Date(epochMs).toISOString().slice(11, 16);
  }
}

export function isTristate(value: unknown): value is Tristate {
  return value === 'auto' || value === true || value === false;
}

/**
 * Home Assistant's own 12/24 h setting (profile -> time format). "language"
 * leaves it to the locale; "system" to the browser, which Intl cannot ask
 * directly, so it is read from a formatted probe.
 */
export function hour12Setting(timeFormat: string | undefined): boolean | undefined {
  if (timeFormat === '12') return true;
  if (timeFormat === '24') return false;
  if (timeFormat === 'system') {
    try {
      const probe = new Intl.DateTimeFormat(undefined, {
        hour: 'numeric',
      }).resolvedOptions();
      return probe.hourCycle === 'h12' || probe.hourCycle === 'h11';
    } catch {
      return undefined;
    }
  }
  return undefined;
}
