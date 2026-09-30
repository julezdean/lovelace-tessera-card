import { animationActive } from '../core/animation';
import type { HassEntity, HomeAssistant } from '../types';
import { progressColor, resolveColor } from './colors';
import {
  formatClock,
  formatDuration,
  formatNumber,
  formatPercent,
  hour12Setting,
  splitDuration,
  type Unit,
} from './format';
import { epochToWallTime } from './iso-time';
import { translator, type Translate } from './localize';
import type { CountdownSnapshot, ErrorSnapshot, Snapshot, ValueSnapshot } from './sources';
import type { FormatConfig, ProgressItem, ProgressStatus } from './types';

/**
 * Snapshot + now -> what an item shows. Pure: no DOM, no timers. Everything
 * that depends on the current time is computed here and nowhere else, which
 * is what lets an item tick without touching Home Assistant.
 *
 * The result is a plain value on purpose: the card compares it with the last
 * one and writes nothing to the DOM when nothing changed.
 *
 * Adapted from lovelace-advanced-countdown-card (src/core/engine.ts).
 */

export interface ProgressView {
  kind: Snapshot['kind'];
  status: ProgressStatus;
  /** 0..1, direction already applied. null = not knowable (no start time). */
  progress: number | null;
  /** The main value as text: "02:35", "73 %", "Finished". */
  value: string;
  percentage?: string;
  /** The status in words - only where it says something (a timer can pause, a timestamp cannot). */
  statusText?: string;
  /** "Ends 20:28". */
  end?: string;
  /** The value in groups, for the digits type. */
  digits: string[];
  /** What follows the digits, where the groups alone would be ambiguous. */
  unit?: string;
  /** A fill colour of its own, from thresholds or a gradient; null = the accent. */
  color: string | null;
  active: boolean;
  animate: boolean;
  /** ms within the second at which the view next changes; null = it does not by itself. */
  tick: number | null;
  error?: string;
  /** For {{placeholders}} in `label`. */
  values: Record<string, string | undefined>;
}

export interface EngineEnv {
  t: Translate;
  locale: string;
  /** Zone for displayed wall-clock times; undefined = browser. */
  displayZone?: string;
  hour12?: boolean;
  entity?: HassEntity;
}

export function engineEnv(hass: HomeAssistant, entity?: HassEntity): EngineEnv {
  const locale = hass.locale?.language || hass.language || 'en';
  return {
    t: translator(locale),
    locale,
    displayZone: hass.locale?.time_zone === 'server' ? hass.config?.time_zone : undefined,
    hour12: hour12Setting(hass.locale?.time_format),
    entity,
  };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const COLON_UNITS: Record<string, Unit[]> = {
  SS: ['s'],
  'MM:SS': ['m', 's'],
  'HH:MM:SS': ['h', 'm', 's'],
  'DD:HH:MM:SS': ['d', 'h', 'm', 's'],
};

/** The groups of the digits type, always in colon form. */
function digitGroups(ms: number, format: FormatConfig, round: 'up' | 'down', minutes: boolean) {
  const abs = Math.abs(ms);
  let units = COLON_UNITS[format.style];
  if (!units) {
    if (minutes) units = abs >= 3_600_000 ? ['h', 'm'] : ['m'];
    else
      units =
        abs >= 86_400_000 ? ['d', 'h', 'm', 's'] : abs >= 3_600_000 ? ['h', 'm', 's'] : ['m', 's'];
    if (format.show_seconds === false && units.length > 1 && units[units.length - 1] === 's') {
      units = units.slice(0, -1);
    }
  }
  const values = splitDuration(abs, units, round);
  return {
    groups: units.map((unit) => String(values[unit]).padStart(2, '0')),
    // A lone minutes group needs saying what it is; "23" alone reads as anything.
    unit: units.length === 1 && units[0] === 'm' ? 'min' : undefined,
  };
}

function sameDay(a: number, b: number, zone?: string): boolean {
  const x = epochToWallTime(a, zone);
  const y = epochToWallTime(b, zone);
  return x.year === y.year && x.month === y.month && x.day === y.day;
}

function statusLabel(item: ProgressItem, status: ProgressStatus, t: Translate): string {
  return item.status_labels[status] ?? t(status);
}

/**
 * Does the item's animation run? The button grammar, plus two moments only a
 * countdown has: `finishing` (the last finishing_seconds) and `finished`.
 */
function animates(
  item: ProgressItem,
  status: ProgressStatus,
  remainingMs: number | undefined,
  active: boolean,
  entity: HassEntity | undefined,
): boolean {
  const { animation } = item;
  if (!animation.enabled || animation.type === 'none') return false;
  if (animation.when === 'finishing') {
    return (
      status === 'active' &&
      remainingMs !== undefined &&
      remainingMs <= item.finishing_seconds * 1000
    );
  }
  if (animation.when === 'finished') return status === 'finished';
  return animationActive(animation, entity, active);
}

function evaluateError(snapshot: ErrorSnapshot, env: EngineEnv): ProgressView {
  const message = env.t(`error_${snapshot.reason}`);
  return {
    kind: 'error',
    status: 'unknown',
    progress: null,
    value: '',
    digits: [],
    color: null,
    active: false,
    animate: false,
    tick: null,
    error: snapshot.detail ? `${message}: ${snapshot.detail}` : message,
    values: { name: snapshot.name },
  };
}

function evaluateCountdown(
  snapshot: CountdownSnapshot,
  item: ProgressItem,
  now: number,
  env: EngineEnv,
): ProgressView {
  const { t, locale } = env;
  let status: ProgressStatus = snapshot.status;
  let remainingMs: number | undefined;
  let finishedAt = snapshot.finishedAtMs;

  if (status === 'active' && snapshot.endMs !== undefined) {
    remainingMs = snapshot.endMs - now;
    // The browser reaches zero before Home Assistant says so; the item shows
    // "finished" from that moment rather than a frozen 00:00 labelled active.
    if (remainingMs <= 0) {
      status = 'finished';
      finishedAt = snapshot.endMs;
      remainingMs = 0;
    }
  } else if (status === 'finished') {
    remainingMs = 0;
  } else {
    remainingMs = snapshot.frozenRemainingMs;
  }

  const total =
    snapshot.startMs !== undefined && snapshot.endMs !== undefined
      ? snapshot.endMs - snapshot.startMs
      : snapshot.totalMs;

  let elapsed: number | null = null;
  if (status === 'finished') elapsed = 1;
  else if (status === 'idle') elapsed = total ? 0 : null;
  else if (total && total > 0 && remainingMs !== undefined) {
    elapsed = clamp01(1 - remainingMs / total);
  }
  const progress =
    elapsed === null ? null : item.progress.direction === 'elapsed' ? elapsed : 1 - elapsed;

  const done = status === 'finished';
  const countUp = done && item.on_complete.action === 'count_up' && finishedAt !== undefined;
  const shownMs = countUp ? -(now - (finishedAt as number)) : (remainingMs ?? 0);

  // A source that only knows whole minutes is shown in whole minutes.
  const minutes = (snapshot.resolutionMs ?? 1000) >= 60_000;
  const format: FormatConfig =
    minutes && item.format.style === 'auto'
      ? { ...item.format, style: 'short', show_seconds: false }
      : item.format;

  let value: string;
  if (countUp) {
    value = `+${formatDuration(-shownMs, format, locale, 'down').text}`;
  } else if (done && item.on_complete.action === 'show_text') {
    value = item.on_complete.text ?? t('finished');
  } else {
    value = formatDuration(shownMs, format, locale, 'up').text;
  }

  const percentage =
    progress === null ? undefined : formatPercent(progress, item.format.decimals, locale);
  const label = statusLabel(item, status, t);

  let end: string | undefined;
  let endTime: string | undefined;
  const endMs = status === 'active' ? snapshot.endMs : done ? finishedAt : undefined;
  if (endMs !== undefined) {
    endTime = formatClock(
      endMs,
      locale,
      env.displayZone,
      !sameDay(endMs, now, env.displayZone),
      env.hour12,
    );
    end = t(done ? 'ended' : 'ends', { time: endTime });
  }

  // A timestamp is simply running until it is over; only sources that can
  // pause or sit idle have a status worth a line.
  const hasStatus =
    snapshot.source !== 'timestamp' &&
    snapshot.source !== 'state' &&
    snapshot.source !== 'attribute';

  const active = status === 'active' || status === 'paused';
  const primary = 'var(--tsr-accent)';
  const color = progressColor(item.colors, primary, {
    progress,
    course: elapsed,
    remainingMs,
  });

  const digits =
    done && item.on_complete.action === 'show_text'
      ? { groups: [] as string[], unit: undefined }
      : digitGroups(shownMs, item.format, countUp ? 'down' : 'up', minutes);

  let tick: number | null = null;
  if (status === 'active' && snapshot.endMs !== undefined)
    tick = ((snapshot.endMs % 1000) + 1000) % 1000;
  else if (countUp) tick = (((finishedAt as number) % 1000) + 1000) % 1000;

  return {
    kind: 'countdown',
    status,
    progress,
    value,
    percentage,
    statusText: hasStatus ? label : undefined,
    end,
    digits: digits.groups,
    unit: digits.unit,
    color: color === primary ? null : color,
    active,
    animate: animates(item, status, remainingMs, active, env.entity),
    tick,
    values: {
      name: snapshot.name,
      state: env.entity?.state,
      value,
      remaining: value,
      percentage,
      status: label,
      end_time: endTime,
    },
  };
}

function evaluateValue(snapshot: ValueSnapshot, item: ProgressItem, env: EngineEnv): ProgressView {
  const { locale } = env;
  const { value, min, max } = snapshot;
  const fraction = clamp01((value - min) / (max - min));
  const percentUnit = snapshot.unit === '%';
  const number = formatNumber(value, item.format.decimals, locale);
  const text = percentUnit ? `${number} %` : snapshot.unit ? `${number} ${snapshot.unit}` : number;
  const percentage = formatPercent(fraction, item.format.decimals, locale);
  const active = value > min;
  const primary = 'var(--tsr-accent)';
  const color = progressColor(item.colors, primary, {
    progress: fraction,
    course: fraction,
    value,
  });

  return {
    kind: 'value',
    status: 'active',
    progress: fraction,
    value: text,
    percentage: percentUnit ? undefined : percentage,
    digits: [number],
    unit: snapshot.unit,
    color: color === primary ? null : color,
    active,
    animate: animates(item, 'active', undefined, active, env.entity),
    tick: null,
    values: {
      name: snapshot.name,
      state: env.entity?.state,
      value: text,
      percentage,
      unit: snapshot.unit,
    },
  };
}

export function evaluate(
  snapshot: Snapshot,
  item: ProgressItem,
  now: number,
  env: EngineEnv,
): ProgressView {
  switch (snapshot.kind) {
    case 'countdown':
      return evaluateCountdown(snapshot, item, now, env);
    case 'value':
      return evaluateValue(snapshot, item, env);
    default:
      return evaluateError(snapshot, env);
  }
}

export { resolveColor };
