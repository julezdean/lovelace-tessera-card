// Copied from lovelace-advanced-countdown-card (src/utils/iso-time.ts) and kept
// identical, so that both cards can later share it as one package.

/**
 * ISO 8601 parsing without Date.parse.
 *
 * Date.parse is implementation-defined for anything outside the one format in
 * the ECMAScript spec, and Home Assistant produces several that are outside it:
 * microseconds (`.123456+00:00`), a space instead of `T` (input_datetime), and
 * no offset at all. A strict parser is deterministic across browsers and
 * testable; the cost is thirty lines.
 *
 * A timestamp WITH an offset is an absolute instant and the time zone does not
 * matter. One WITHOUT an offset is a wall-clock time, and the browser would
 * read it in the browser's zone -- but it was written by the Home Assistant
 * server, so by default it is read in the server's zone instead.
 */

const ISO =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

const TIME_ONLY = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

export interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  ms: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Offset of `timeZone` from UTC at the instant `epochMs`, in ms. */
export function zoneOffsetMs(epochMs: number, timeZone: string): number {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(new Date(epochMs))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour === 24 ? 0 : parts.hour,
    parts.minute,
    parts.second,
  );
  const wholeSeconds = epochMs - (((epochMs % 1000) + 1000) % 1000);
  return asUtc - wholeSeconds;
}

/**
 * A wall-clock time in `timeZone` -> epoch ms. Two passes cover DST: the first
 * guess uses the offset at the naive instant, the second corrects it if the
 * guess landed on the other side of a transition. A time inside the spring-
 * forward gap resolves to the later offset, as browsers do.
 */
export function wallTimeToEpoch(wall: WallTime, timeZone?: string): number {
  if (!timeZone) {
    return new Date(
      wall.year,
      wall.month - 1,
      wall.day,
      wall.hour,
      wall.minute,
      wall.second,
      wall.ms,
    ).getTime();
  }
  const naive = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
    wall.ms,
  );
  const first = naive - zoneOffsetMs(naive, timeZone);
  const second = naive - zoneOffsetMs(first, timeZone);
  return second;
}

/** The wall-clock fields of an instant in `timeZone` (browser zone if omitted). */
export function epochToWallTime(epochMs: number, timeZone?: string): WallTime {
  if (!timeZone) {
    const d = new Date(epochMs);
    return {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
      hour: d.getHours(),
      minute: d.getMinutes(),
      second: d.getSeconds(),
      ms: d.getMilliseconds(),
    };
  }
  const shifted = new Date(epochMs + zoneOffsetMs(epochMs, timeZone));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    ms: shifted.getUTCMilliseconds(),
  };
}

function validDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/**
 * Parses an ISO 8601 date or date-time into epoch ms, or undefined if the text
 * is not one. `naiveZone` is the IANA zone used when the text has no offset;
 * undefined means the browser's zone.
 */
export function parseIsoTimestamp(text: unknown, naiveZone?: string): number | undefined {
  if (typeof text !== 'string') return undefined;
  const match = ISO.exec(text.trim());
  if (!match) return undefined;

  const [, y, mo, d, h, mi, s, frac, offset] = match;
  const wall: WallTime = {
    year: Number(y),
    month: Number(mo),
    day: Number(d),
    hour: h === undefined ? 0 : Number(h),
    minute: mi === undefined ? 0 : Number(mi),
    second: s === undefined ? 0 : Number(s),
    // Microseconds and beyond are cut to milliseconds, never rounded up into
    // the next second.
    ms: frac === undefined ? 0 : Number(frac.slice(0, 3).padEnd(3, '0')),
  };

  if (!validDate(wall.year, wall.month, wall.day)) return undefined;
  if (wall.hour > 23 || wall.minute > 59 || wall.second > 59) return undefined;

  if (offset === undefined) return wallTimeToEpoch(wall, naiveZone);

  const utc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
    wall.ms,
  );
  if (offset.toUpperCase() === 'Z') return utc;

  const sign = offset[0] === '-' ? -1 : 1;
  const digits = offset.slice(1).replace(':', '');
  const hours = Number(digits.slice(0, 2));
  const minutes = digits.length > 2 ? Number(digits.slice(2, 4)) : 0;
  if (hours > 23 || minutes > 59) return undefined;
  return utc - sign * (hours * 3_600_000 + minutes * 60_000);
}

/**
 * A time of day without a date ("22:30" or "22:30:00", as an input_datetime
 * with has_date: false reports it) -> the next time the clock shows it, in
 * `zone`. "Next" includes now: at exactly 22:30:00 it is now, not tomorrow.
 */
export function nextTimeOfDay(text: unknown, nowMs: number, zone?: string): number | undefined {
  if (typeof text !== 'string') return undefined;
  const match = TIME_ONLY.exec(text.trim());
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] === undefined ? 0 : Number(match[3]);
  if (hour > 23 || minute > 59 || second > 59) return undefined;

  const today = epochToWallTime(nowMs, zone);
  const candidate = wallTimeToEpoch({ ...today, hour, minute, second, ms: 0 }, zone);
  if (candidate >= nowMs - 999) return candidate;
  // Tomorrow: step the date, not 24 hours, so a DST night stays correct.
  const tomorrow = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
  return wallTimeToEpoch(
    {
      year: tomorrow.getUTCFullYear(),
      month: tomorrow.getUTCMonth() + 1,
      day: tomorrow.getUTCDate(),
      hour,
      minute,
      second,
      ms: 0,
    },
    zone,
  );
}
