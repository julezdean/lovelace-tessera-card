import type { Dict, HassEntity, HomeAssistant } from '../types';
import { isDict } from '../utils';
import { parseHmsDuration, parseSpan } from './duration';
import { nextTimeOfDay, parseIsoTimestamp } from './iso-time';
import type { ErrorReason } from './localize';
import type { EntityRef, ProgressItem, TimeRef } from './types';

/**
 * Entity -> Snapshot: what a source reads, independent of the current time.
 * The engine then turns a snapshot and "now" into what is shown, which is what
 * lets an item tick every second without asking Home Assistant anything.
 *
 * Adapted from lovelace-advanced-countdown-card (src/sources/, src/core/
 * pipeline.ts). Two differences: templates are this card's `[[[ JavaScript ]]]`
 * rather than Jinja rendered by the server, and there is a `remaining` source
 * for sensors that report the time left as a number.
 */

interface SnapshotBase {
  name?: string;
  unit?: string;
  /** Which source produced it, after auto detection. */
  source: string;
}

export interface CountdownSnapshot extends SnapshotBase {
  kind: 'countdown';
  /**
   * `active` means "running towards endMs"; whether it has already passed is
   * decided by the engine, because that depends on the current time.
   */
  status: 'active' | 'paused' | 'idle' | 'finished';
  endMs?: number;
  startMs?: number;
  /** Paused: the remaining time frozen at the pause. Idle: the full duration. */
  frozenRemainingMs?: number;
  totalMs?: number;
  /** When a finished countdown ended, for count_up. */
  finishedAtMs?: number;
  /**
   * The smallest step the source can tell apart. A sensor reporting whole
   * minutes knows nothing about seconds, and showing them would be invented.
   */
  resolutionMs?: number;
}

export interface ValueSnapshot extends SnapshotBase {
  kind: 'value';
  value: number;
  min: number;
  max: number;
}

export interface ErrorSnapshot extends SnapshotBase {
  kind: 'error';
  reason: ErrorReason;
  detail?: string;
}

export type Snapshot = CountdownSnapshot | ValueSnapshot | ErrorSnapshot;

interface SourceContext {
  hass: HomeAssistant;
  item: ProgressItem;
  entity?: HassEntity;
  now: number;
  /** IANA zone for timestamps without an offset; undefined = browser zone. */
  naiveZone?: string;
  /** What `source.template` returned, for `type: template`. */
  rendered?: unknown;
}

interface SourceDefinition {
  type: string;
  /** For `auto`: a priority if this source can read the entity, else null. */
  detect?(entity: HassEntity): number | null;
  read(ctx: SourceContext): Snapshot;
}

/* --- reading values --------------------------------------------------------- */

function entityName(entity: HassEntity | undefined): string | undefined {
  if (!entity) return undefined;
  const name = entity.attributes?.friendly_name;
  return typeof name === 'string' && name ? name : entity.entity_id;
}

function baseOf(ctx: SourceContext, source: string): SnapshotBase {
  const unit = ctx.entity?.attributes?.unit_of_measurement;
  return {
    source,
    name: entityName(ctx.entity),
    unit: typeof unit === 'string' ? unit : undefined,
  };
}

function errorOf(
  ctx: SourceContext,
  source: string,
  reason: ErrorReason,
  detail?: string,
): ErrorSnapshot {
  return { ...baseOf(ctx, source), kind: 'error', reason, detail };
}

/** The configured raw value, after `source.map`. */
function readRaw(ctx: SourceContext): unknown {
  const { entity, item } = ctx;
  if (!entity) return undefined;
  const attribute = item.source.attribute;
  const raw = attribute ? entity.attributes?.[attribute] : entity.state;
  const map = item.source.map;
  if (map && (typeof raw === 'string' || typeof raw === 'number')) {
    const key = String(raw);
    if (Object.prototype.hasOwnProperty.call(map, key)) return map[key];
  }
  return raw;
}

/**
 * A whole number or nothing. parseFloat reads a prefix, so a timestamp state
 * like "2026-09-29T14:16:25+00:00" would come out as 2026 -- a proportion has
 * to be a value, not the first digits of something else. A trailing "%" is
 * accepted because template sensors write it; a decimal comma is not, because
 * "1,234" is ambiguous and Home Assistant states always use a point.
 */
export function strictNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const match = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*%?\s*$/i.exec(value);
  return match ? Number(match[1]) : undefined;
}

const EPOCH_MS_THRESHOLD = 100_000_000_000; // 1973 in ms, 5138 in seconds

/**
 * A raw value -> epoch ms. Accepts ISO strings (with or without offset), a
 * bare time of day ("22:30", the next occurrence), and epoch numbers in either
 * seconds or milliseconds.
 */
function toEpoch(value: unknown, ctx: SourceContext): number | undefined {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return undefined;
    return value < EPOCH_MS_THRESHOLD ? value * 1000 : value;
  }
  if (value instanceof Date) return value.getTime();
  return parseIsoTimestamp(value, ctx.naiveZone) ?? nextTimeOfDay(value, ctx.now, ctx.naiveZone);
}

/** Units a duration sensor reports in, as Home Assistant spells them. */
const DURATION_UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  sec: 1000,
  min: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** A number in `unit`, or "H:MM:SS" -> ms. A bare number without a unit is seconds. */
function durationOf(value: unknown, unit: unknown): number | undefined {
  const number = strictNumber(value);
  if (number !== undefined) {
    const factor = typeof unit === 'string' ? DURATION_UNIT_MS[unit] : undefined;
    return number * (factor ?? 1000);
  }
  return parseHmsDuration(value);
}

function readRef(ref: EntityRef, ctx: SourceContext): { raw: unknown; entity?: HassEntity } {
  const entity = ctx.hass.states[ref.entity];
  if (!entity) return { raw: undefined };
  return { raw: ref.attribute ? entity.attributes?.[ref.attribute] : entity.state, entity };
}

function resolveTimeRef(ref: TimeRef | undefined, ctx: SourceContext): number | undefined {
  if (ref === undefined || ref === null) return undefined;
  if (ref === 'last_changed') return parseIsoTimestamp(ctx.entity?.last_changed);
  if (isDict(ref)) return toEpoch(readRef(ref as EntityRef, ctx).raw, ctx);
  return toEpoch(ref, ctx);
}

/** `progress.window`: a span as written, or a duration an entity holds. */
function resolveWindow(ref: TimeRef | undefined, ctx: SourceContext): number | undefined {
  if (ref === undefined || ref === null) return undefined;
  if (isDict(ref)) {
    const { raw, entity } = readRef(ref as EntityRef, ctx);
    const ms = durationOf(raw, entity?.attributes?.unit_of_measurement);
    return ms !== undefined && ms > 0 ? ms : undefined;
  }
  return parseSpan(ref);
}

/** Min/max for a value: the config first, then what the entity itself declares. */
function rangeOf(ctx: SourceContext, percentage: boolean): { min: number; max: number } {
  const { progress } = ctx.item;
  const attrs: Dict = ctx.entity?.attributes ?? {};
  const fromEntity = (keys: string[]): number | undefined => {
    for (const key of keys) {
      const value = strictNumber(attrs[key]);
      if (value !== undefined) return value;
    }
    return undefined;
  };
  const min = progress.min ?? (percentage ? undefined : fromEntity(['min', 'minimum'])) ?? 0;
  const max = progress.max ?? (percentage ? undefined : fromEntity(['max', 'maximum'])) ?? 100;
  // A counter without a maximum reports none; an inverted range from the
  // entity is not the user's fault and falls back rather than throwing.
  return max > min ? { min, max } : { min: 0, max: 100 };
}

/** Looks at a raw value and decides whether it is a point in time or a number. */
function interpretValue(
  value: unknown,
  ctx: SourceContext,
  source: string,
  range: { min: number; max: number },
): Snapshot {
  const base = baseOf(ctx, source);
  const number = strictNumber(value);
  if (number !== undefined) {
    return { ...base, kind: 'value', value: number, ...range };
  }
  const epoch = typeof value === 'string' ? toEpoch(value, ctx) : undefined;
  if (epoch !== undefined) {
    return { ...base, unit: undefined, kind: 'countdown', status: 'active', endMs: epoch };
  }
  if (value === undefined || value === null || value === '') {
    return errorOf(ctx, source, 'unknown_state');
  }
  return errorOf(ctx, source, 'undetectable', String(value));
}

/* --- the sources ------------------------------------------------------------ */

/**
 * Home Assistant `timer` entities, as core writes them (timer/__init__.py):
 *
 *   state      attributes present
 *   active     duration, remaining, finishes_at, last_transition
 *   paused     duration, remaining,              last_transition
 *   idle       duration,                         last_transition
 *
 * The timer writes its state only on transitions, never while it runs, so
 * `remaining` on an active timer is the value from when it was started -- the
 * live countdown has to come from `finishes_at`, which is exactly what Home
 * Assistant's own frontend does (timerTimeRemaining in src/data/timer.ts).
 *
 * `last_transition` (since 2026.5) is what tells a finished timer from a
 * cancelled one once both are idle. Without it an idle timer is just idle.
 */
const timerSource: SourceDefinition = {
  type: 'timer',
  detect: (entity) => (entity.entity_id.startsWith('timer.') ? 100 : null),
  read(ctx) {
    const entity = ctx.entity;
    if (!entity) return errorOf(ctx, 'timer', 'entity_missing');
    const attrs: Dict = entity.attributes ?? {};
    const base = { ...baseOf(ctx, 'timer'), unit: undefined };
    const totalMs = parseHmsDuration(attrs.duration);
    const remainingMs = parseHmsDuration(attrs.remaining);
    const total = totalMs && totalMs > 0 ? totalMs : undefined;

    switch (entity.state) {
      case 'active': {
        let endMs = parseIsoTimestamp(attrs.finishes_at);
        // An active timer always has finishes_at on current cores. If one does
        // not, remaining counted from the last state write is the next best.
        if (endMs === undefined && remainingMs !== undefined) {
          const changed = parseIsoTimestamp(entity.last_changed);
          if (changed !== undefined) endMs = changed + remainingMs;
        }
        if (endMs === undefined) {
          return errorOf(ctx, 'timer', 'invalid_timestamp', String(attrs.finishes_at));
        }
        const snapshot: CountdownSnapshot = { ...base, kind: 'countdown', status: 'active', endMs };
        if (total !== undefined) {
          snapshot.totalMs = total;
          snapshot.startMs = endMs - total;
        }
        return snapshot;
      }
      case 'paused':
        return {
          ...base,
          kind: 'countdown',
          status: 'paused',
          frozenRemainingMs: remainingMs ?? totalMs ?? 0,
          totalMs: total,
        };
      case 'idle':
        if (attrs.last_transition === 'finished') {
          return {
            ...base,
            kind: 'countdown',
            status: 'finished',
            frozenRemainingMs: 0,
            totalMs: total,
            // The finishing transition is the last state write.
            finishedAtMs: parseIsoTimestamp(entity.last_changed),
          };
        }
        return {
          ...base,
          kind: 'countdown',
          status: 'idle',
          frozenRemainingMs: totalMs ?? 0,
          totalMs: total,
        };
      default:
        return errorOf(ctx, 'timer', 'undetectable', entity.state);
    }
  },
};

/**
 * Any entity whose state or attribute is a point in time: sensors with
 * device_class: timestamp, input_datetime, calendar-like attributes.
 *
 * A timestamp says when something ends, not when it started, so there is no
 * progress unless progress.start or progress.window supplies the other end.
 * Without one the item shows the countdown on a full ring rather than
 * inventing a start -- last_changed would be the obvious guess, and it resets
 * on every Home Assistant restart.
 */
const timestampSource: SourceDefinition = {
  type: 'timestamp',
  detect(entity) {
    const deviceClass = entity.attributes?.device_class;
    if (deviceClass === 'timestamp' || deviceClass === 'date') return 90;
    if (entity.entity_id.startsWith('input_datetime.')) return 90;
    // Anything else only if the state really is a date-time; a bare number
    // must never be mistaken for one.
    if (/^\d{4}-\d{2}-\d{2}/.test(entity.state) && parseIsoTimestamp(entity.state, 'UTC')) {
      return 50;
    }
    return null;
  },
  read(ctx) {
    const raw = readRaw(ctx);
    if (raw === undefined || raw === null || raw === '') {
      return errorOf(ctx, 'timestamp', 'unknown_state');
    }
    const endMs = toEpoch(raw, ctx);
    if (endMs === undefined) return errorOf(ctx, 'timestamp', 'invalid_timestamp', String(raw));
    return {
      ...baseOf(ctx, 'timestamp'),
      unit: undefined,
      kind: 'countdown',
      status: 'active',
      endMs,
    };
  },
};

/**
 * A sensor that reports the time left as a number: a washing machine's
 * "23 min", a dishwasher's remaining seconds. The number counts from the
 * moment it was reported, so the end is that moment plus the number - and the
 * item counts down on its own between reports, in the unit the sensor uses.
 *
 * A new report moves the end. That is information, not jitter: the machine
 * has recalculated.
 */
const remainingSource: SourceDefinition = {
  type: 'remaining',
  detect(entity) {
    if (strictNumber(entity.state) === undefined) return null;
    const unit = entity.attributes?.unit_of_measurement;
    if (entity.attributes?.device_class === 'duration') return 60;
    return typeof unit === 'string' && unit !== 'ms' && DURATION_UNIT_MS[unit] ? 60 : null;
  },
  read(ctx) {
    const entity = ctx.entity;
    const raw = readRaw(ctx);
    const unit = entity?.attributes?.unit_of_measurement;
    const number = strictNumber(raw);
    const ms = durationOf(raw, unit);
    if (ms === undefined) return errorOf(ctx, 'remaining', 'invalid_number', String(raw));
    const base = { ...baseOf(ctx, 'remaining'), unit: undefined };
    const unitMs = typeof unit === 'string' ? DURATION_UNIT_MS[unit] : undefined;
    // Whole minutes are all a minute sensor knows; seconds would be invented.
    const resolutionMs = number !== undefined && unitMs && unitMs >= 60_000 ? unitMs : 1000;
    if (ms <= 0) {
      return { ...base, kind: 'countdown', status: 'finished', frozenRemainingMs: 0, resolutionMs };
    }
    // An attribute can change without the state changing; last_updated
    // covers both, last_changed only the state.
    const reported = parseIsoTimestamp(
      ctx.item.source.attribute ? entity?.last_updated : entity?.last_changed,
    );
    if (reported === undefined) {
      return { ...base, kind: 'countdown', status: 'paused', frozenRemainingMs: ms, resolutionMs };
    }
    return { ...base, kind: 'countdown', status: 'active', endMs: reported + ms, resolutionMs };
  },
};

const PERCENT_CLASSES = new Set(['battery', 'humidity', 'moisture']);

/**
 * A number on a scale. `percentage` is the same thing fixed to 0..100 unless
 * progress.min/max say otherwise; `numeric` also takes the range an entity
 * declares itself (input_number, number: min/max; counter: minimum/maximum).
 *
 * A value outside the range is clamped for the drawing but shown as it is in
 * the text: a battery that reports 104 % should look full and still say 104.
 */
function readNumber(ctx: SourceContext, type: string, percentage: boolean): Snapshot {
  const raw = readRaw(ctx);
  if (raw === undefined || raw === null || raw === '') return errorOf(ctx, type, 'unknown_state');
  const value = strictNumber(raw);
  if (value === undefined) return errorOf(ctx, type, 'invalid_number', String(raw));
  const base = baseOf(ctx, type);
  return {
    ...base,
    unit: base.unit ?? (percentage ? '%' : undefined),
    kind: 'value',
    value,
    ...rangeOf(ctx, percentage),
  };
}

const percentageSource: SourceDefinition = {
  type: 'percentage',
  detect(entity) {
    const attrs = entity.attributes ?? {};
    const looksPercent =
      attrs.unit_of_measurement === '%' ||
      PERCENT_CLASSES.has(String(attrs.device_class ?? '')) ||
      /%\s*$/.test(entity.state);
    return looksPercent && strictNumber(entity.state) !== undefined ? 80 : null;
  },
  read: (ctx) => readNumber(ctx, 'percentage', true),
};

const numericSource: SourceDefinition = {
  type: 'numeric',
  detect: (entity) => (strictNumber(entity.state) !== undefined ? 40 : null),
  read: (ctx) => readNumber(ctx, 'numeric', false),
};

/**
 * `state` and `attribute`: read that one value and decide from the value
 * itself whether it is a point in time or a number.
 */
const stateSource: SourceDefinition = {
  type: 'state',
  read: (ctx) => interpretValue(readRaw(ctx), ctx, 'state', rangeOf(ctx, false)),
};
const attributeSource: SourceDefinition = {
  type: 'attribute',
  read: (ctx) => interpretValue(readRaw(ctx), ctx, 'attribute', rangeOf(ctx, false)),
};

const STATUSES = new Set(['active', 'paused', 'idle', 'finished']);

/**
 * `type: template`: a `[[[ ... ]]]` template returns
 *   - a number                       -> a value on progress.min..max
 *   - a string                       -> a timestamp, or a number
 *   - a mapping with any of
 *       end, start, value, min, max, status, name, duration, remaining
 *                                    -> whatever it says, for templates that
 *                                       need to supply more than one number
 */
function fromMapping(obj: Dict, ctx: SourceContext): Snapshot {
  const base = { ...baseOf(ctx, 'template'), unit: undefined };
  const name = typeof obj.name === 'string' ? obj.name : base.name;
  const value = strictNumber(obj.value);
  if (value !== undefined) {
    const range = rangeOf(ctx, false);
    return {
      ...base,
      name,
      unit: typeof obj.unit === 'string' ? obj.unit : undefined,
      kind: 'value',
      value,
      min: strictNumber(obj.min) ?? range.min,
      max: strictNumber(obj.max) ?? range.max,
    };
  }
  const endMs = toEpoch(obj.end, ctx);
  const startMs = toEpoch(obj.start, ctx);
  const durationMs =
    typeof obj.duration === 'number' ? obj.duration * 1000 : parseHmsDuration(obj.duration);
  const status = (STATUSES.has(String(obj.status)) ? String(obj.status) : 'active') as
    'active' | 'paused' | 'idle' | 'finished';
  if (endMs === undefined && status === 'active') {
    return errorOf(ctx, 'template', 'invalid_timestamp', JSON.stringify(obj.end));
  }
  return {
    ...base,
    name,
    kind: 'countdown',
    status,
    endMs,
    startMs: startMs ?? (endMs !== undefined && durationMs ? endMs - durationMs : undefined),
    totalMs: durationMs,
    frozenRemainingMs:
      status === 'active' ? undefined : (parseHmsDuration(obj.remaining) ?? durationMs),
  };
}

const templateSource: SourceDefinition = {
  type: 'template',
  read(ctx) {
    const value = ctx.rendered;
    if (isDict(value)) return fromMapping(value, ctx);
    const snapshot = interpretValue(
      typeof value === 'string' ? value.trim() : value,
      ctx,
      'template',
      rangeOf(ctx, false),
    );
    // The template, not the entity, produced this value; the entity's unit
    // would be a guess.
    return snapshot.kind === 'value' ? snapshot : { ...snapshot, unit: undefined };
  },
};

const SOURCES: SourceDefinition[] = [
  timerSource,
  timestampSource,
  remainingSource,
  percentageSource,
  numericSource,
  stateSource,
  attributeSource,
  templateSource,
];
const BY_TYPE = new Map(SOURCES.map((source) => [source.type, source]));

function detectSource(entity: HassEntity): SourceDefinition | undefined {
  let best: SourceDefinition | undefined;
  let bestScore = -Infinity;
  for (const definition of SOURCES) {
    const score = definition.detect?.(entity);
    if (score !== null && score !== undefined && score > bestScore) {
      best = definition;
      bestScore = score;
    }
  }
  return best;
}

/**
 * progress.start / end / window apply to every countdown source the same way,
 * which is why they live here and not in each source. `end` overrides what the
 * source read; `start` beats `window`, which beats what the source knew.
 */
function applyProgress(snapshot: Snapshot, ctx: SourceContext): Snapshot {
  if (snapshot.kind !== 'countdown') return snapshot;
  const { progress } = ctx.item;
  const out = { ...snapshot };

  const end = resolveTimeRef(progress.end, ctx);
  if (end !== undefined && out.status === 'active') out.endMs = end;

  const start = resolveTimeRef(progress.start, ctx);
  const window = resolveWindow(progress.window, ctx);
  if (start !== undefined) {
    out.startMs = start;
  } else if (window !== undefined && out.endMs !== undefined) {
    out.startMs = out.endMs - window;
  } else if (window !== undefined) {
    // Paused, idle or finished: no end to count back from, but the span
    // still says how full the frozen remainder is.
    out.totalMs = window;
  }
  if (out.startMs !== undefined && out.endMs !== undefined) {
    // A start at or after the end cannot carry a proportion.
    out.totalMs = out.endMs > out.startMs ? out.endMs - out.startMs : undefined;
    if (out.totalMs === undefined) out.startMs = undefined;
  }
  return out;
}

export function readSnapshot(
  hass: HomeAssistant,
  item: ProgressItem,
  now: number,
  rendered?: unknown,
): Snapshot {
  const entity = item.entity ? hass.states[item.entity] : undefined;
  const naiveZone = item.source.naive_timezone === 'server' ? hass.config?.time_zone : undefined;
  const ctx: SourceContext = { hass, item, entity, now, naiveZone, rendered };
  const type = item.source.type;

  if (type !== 'template') {
    if (!item.entity) return errorOf(ctx, type, 'no_entity');
    if (!entity) return errorOf(ctx, type, 'entity_missing', item.entity);
    if (entity.state === 'unavailable') return errorOf(ctx, type, 'unavailable');
    // An attribute can be perfectly readable while the state is unknown.
    if (entity.state === 'unknown' && !item.source.attribute) {
      return errorOf(ctx, type, 'unknown_state');
    }
  }

  let definition: SourceDefinition | undefined;
  if (type === 'auto') {
    definition = item.source.attribute
      ? attributeSource
      : entity
        ? detectSource(entity)
        : undefined;
    if (!definition) return errorOf(ctx, 'auto', 'undetectable', entity?.state);
  } else {
    definition = BY_TYPE.get(type);
    if (!definition) return errorOf(ctx, type, 'undetectable', `no source "${type}"`);
  }

  return applyProgress(definition.read(ctx), ctx);
}
