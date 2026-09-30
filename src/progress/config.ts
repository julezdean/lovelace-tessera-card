import { DEFAULT_ANIMATION, normalizeAnimation } from '../core/animation';
import type { Dict, ItemBase } from '../types';
import { isDict } from '../utils';
import { parseSpan } from './duration';
import type {
  ColorConfig,
  FormatConfig,
  FormatStyle,
  OnComplete,
  ProgressItem,
  ProgressRange,
  SourceConfig,
  SourceType,
  Threshold,
  Tristate,
} from './types';

/**
 * A progress item's options, as written -> fully resolved.
 *
 * Unlike the countdown card this does not throw: a card with ten items must
 * not disappear because one of them has a typo. A problem sets the item's
 * `error`, which draws it as an invalid cell with the reason, and everything
 * else keeps a sensible default.
 */

const SOURCE_TYPES: SourceType[] = [
  'auto',
  'timer',
  'timestamp',
  'remaining',
  'percentage',
  'numeric',
  'state',
  'attribute',
  'template',
];

const FORMAT_STYLES: FormatStyle[] = [
  'auto',
  'SS',
  'MM:SS',
  'HH:MM:SS',
  'DD:HH:MM:SS',
  'short',
  'long',
];

/** Every progress type's defaults. A type block (`ring:`) or the item overrides them. */
export const PROGRESS_DEFAULTS: Dict = {
  show_name: true,
  inner: 'auto',
  rounded: true,
  track: true,
  gradient: false,
  arc: 360,
  segments: 10,
  tiles: true,
  finishing_seconds: 60,
};

/** Per type, what differs from the shared defaults. */
export const TYPE_DEFAULTS: Record<ProgressItem['type'], Dict> = {
  // Percent of the diameter: the ring scales with the cell, so a pixel value
  // would be too thick in a small cell and too thin in a large one.
  ring: { thickness: 10 },
  bar: { thickness: 4 },
  segments: { thickness: 4 },
  digits: { thickness: 4 },
};

class Problems {
  first: string | null = null;
  add(message: string): void {
    if (!this.first) this.first = message;
  }
}

function section(value: unknown, key: string, shorthand: string, problems: Problems): Dict {
  if (value === undefined || value === null) return {};
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return { [shorthand]: value };
  }
  if (!isDict(value)) {
    problems.add(`"${key}" must be a mapping`);
    return {};
  }
  return value;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
  key: string,
  problems: Problems,
): T {
  if (value === undefined || value === null) return fallback;
  if (allowed.includes(value as T)) return value as T;
  problems.add(`"${key}" must be one of ${allowed.join(', ')}`);
  return fallback;
}

function number(
  value: unknown,
  fallback: number,
  key: string,
  problems: Problems,
  min?: number,
  max?: number,
): number {
  if (value === undefined || value === null || value === '') return fallback;
  const num = typeof value === 'string' ? Number(value) : value;
  if (typeof num !== 'number' || !Number.isFinite(num)) {
    problems.add(`"${key}" must be a number`);
    return fallback;
  }
  if (min !== undefined && num < min) return min;
  if (max !== undefined && num > max) return max;
  return num;
}

/** "auto" | true | false, also from the strings the editor's select writes. */
function tristate(value: unknown, key: string, problems: Problems): Tristate {
  if (value === undefined || value === null || value === 'auto') return 'auto';
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  problems.add(`"${key}" must be auto, true or false`);
  return 'auto';
}

function thresholds(value: unknown, problems: Problems): Threshold[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    problems.add('"colors.thresholds" must be a list');
    return [];
  }
  const out: Threshold[] = [];
  value.forEach((entry, i) => {
    if (!isDict(entry) || typeof entry.color !== 'string' || !entry.color) {
      problems.add(`"colors.thresholds[${i}]" needs a value and a color`);
      return;
    }
    const v = number(entry.value, NaN, `colors.thresholds[${i}].value`, problems);
    if (Number.isFinite(v)) out.push({ value: v, color: entry.color });
  });
  return out;
}

function timeRef(value: unknown, key: string, problems: Problems): ProgressRange['start'] {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (isDict(value) && typeof value.entity === 'string') {
    return {
      entity: value.entity,
      attribute: typeof value.attribute === 'string' ? value.attribute : undefined,
    };
  }
  problems.add(`"${key}" must be a time, a number or { entity, attribute }`);
  return undefined;
}

export function normalizeProgress(
  type: ProgressItem['type'],
  src: Dict,
  base: ItemBase,
  defaults: Dict,
): ProgressItem {
  const problems = new Problems();
  const pick = (key: string) => src[key] ?? defaults[key];

  /* source ---------------------------------------------------------------- */
  const rawSource = section(pick('source'), 'source', 'type', problems);
  const source: SourceConfig = {
    type: oneOf(rawSource.type, SOURCE_TYPES, 'auto', 'source.type', problems),
    naive_timezone: rawSource.naive_timezone === 'browser' ? 'browser' : 'server',
  };
  if (typeof rawSource.attribute === 'string') source.attribute = rawSource.attribute;
  if (isDict(rawSource.map)) source.map = rawSource.map as SourceConfig['map'];
  if (typeof rawSource.template === 'string') source.template = rawSource.template;
  if (source.type === 'template' && !source.template) {
    problems.add('source: template needs "source.template"');
  }
  if (source.type === 'attribute' && !source.attribute) {
    problems.add('source: attribute needs "source.attribute"');
  }

  /* progress -------------------------------------------------------------- */
  const rawProgress = section(pick('progress'), 'progress', 'direction', problems);
  const progress: ProgressRange = {
    direction: oneOf(
      rawProgress.direction,
      ['remaining', 'elapsed'] as const,
      'remaining',
      'progress.direction',
      problems,
    ),
    start: timeRef(rawProgress.start, 'progress.start', problems),
    end: timeRef(rawProgress.end, 'progress.end', problems),
    window: timeRef(rawProgress.window, 'progress.window', problems),
  };
  if (
    progress.window !== undefined &&
    !isDict(progress.window) &&
    parseSpan(progress.window) === undefined
  ) {
    problems.add('"progress.window" must be a span such as 2h, 90m or 1d 2h, or an entity');
  }
  if (rawProgress.min !== undefined)
    progress.min = number(rawProgress.min, 0, 'progress.min', problems);
  if (rawProgress.max !== undefined)
    progress.max = number(rawProgress.max, 100, 'progress.max', problems);
  if (progress.min !== undefined && progress.max !== undefined && progress.min >= progress.max) {
    problems.add('"progress.min" must be below "progress.max"');
  }

  /* format ---------------------------------------------------------------- */
  const rawFormat = section(pick('format'), 'format', 'style', problems);
  const format: FormatConfig = {
    style: oneOf(rawFormat.style, FORMAT_STYLES, 'auto', 'format.style', problems),
    largest_units: Math.round(
      number(rawFormat.largest_units, 2, 'format.largest_units', problems, 1, 4),
    ),
    show_days: tristate(rawFormat.show_days, 'format.show_days', problems),
    show_hours: tristate(rawFormat.show_hours, 'format.show_hours', problems),
    show_minutes: tristate(rawFormat.show_minutes, 'format.show_minutes', problems),
    show_seconds: tristate(rawFormat.show_seconds, 'format.show_seconds', problems),
    decimals: Math.round(number(rawFormat.decimals, 0, 'format.decimals', problems, 0, 3)),
  };

  /* colours --------------------------------------------------------------- */
  const rawColors = section(pick('colors'), 'colors', 'mode', problems);
  const colors: ColorConfig = {
    mode: oneOf(
      rawColors.mode ?? (rawColors.thresholds ? 'thresholds' : undefined),
      ['static', 'thresholds', 'gradient'] as const,
      'static',
      'colors.mode',
      problems,
    ),
    basis: oneOf(
      rawColors.basis,
      ['progress', 'remaining_seconds', 'value'] as const,
      'progress',
      'colors.basis',
      problems,
    ),
    thresholds: thresholds(rawColors.thresholds, problems),
  };
  for (const key of ['start', 'end', 'secondary', 'track'] as const) {
    if (typeof rawColors[key] === 'string') colors[key] = rawColors[key] as string;
  }
  if (colors.mode === 'thresholds' && colors.thresholds.length === 0) {
    problems.add('colors.mode: thresholds needs "colors.thresholds"');
  }

  /* on_complete ----------------------------------------------------------- */
  const rawDone = section(pick('on_complete'), 'on_complete', 'action', problems);
  const onComplete: OnComplete = {
    action: oneOf(
      rawDone.action,
      ['show_zero', 'show_text', 'count_up'] as const,
      'show_zero',
      'on_complete.action',
      problems,
    ),
  };
  if (typeof rawDone.text === 'string') onComplete.text = rawDone.text;

  /* status labels ---------------------------------------------------------- */
  const rawLabels = pick('status_labels');
  const statusLabels = isDict(rawLabels) ? (rawLabels as ProgressItem['status_labels']) : {};

  /* drawing --------------------------------------------------------------- */
  const inner = oneOf(
    pick('inner'),
    ['auto', 'value', 'percentage', 'icon', 'none'] as const,
    'auto',
    'inner',
    problems,
  );
  const isRing = type === 'ring';
  const thickness = number(
    pick('thickness'),
    isRing ? 10 : 4,
    'thickness',
    problems,
    1,
    // A bar lives in the cell's bottom padding, which is 10 px.
    isRing ? 40 : 6,
  );

  const item: ProgressItem = {
    ...base,
    type,
    name: src.name ?? null,
    icon: src.icon ?? null,
    label: src.label ?? null,
    show_name: pick('show_name'),
    source,
    progress,
    format,
    colors,
    on_complete: onComplete,
    status_labels: statusLabels,
    // The card's `animation:` block is the buttons' default; a progress item
    // animates its drawing, which is a different thing to default.
    animation: normalizeAnimation(pick('animation'), DEFAULT_ANIMATION),
    finishing_seconds: number(pick('finishing_seconds'), 60, 'finishing_seconds', problems, 1),
    inner,
    thickness,
    rounded: pick('rounded') !== false,
    track: pick('track') !== false,
    gradient: pick('gradient') === true,
    arc: number(pick('arc'), 360, 'arc', problems, 90, 360),
    segments: Math.round(number(pick('segments'), 10, 'segments', problems, 2, 40)),
    tiles: pick('tiles') !== false,
  };
  if (!item.error && problems.first) item.error = problems.first;
  return item;
}
