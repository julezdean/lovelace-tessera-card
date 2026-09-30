// Copied from lovelace-advanced-countdown-card (src/utils/duration.ts) and kept
// identical, so that both cards can later share it as one package.

/**
 * Durations as Home Assistant writes them, and as a user writes them.
 *
 * Timers format `duration` and `remaining` with their own _format_timedelta,
 * which produces "H:MM:SS" with the hours unbounded ("26:00:00", never
 * "1 day, 2:00:00"). Python's str(timedelta) does produce the "day" form, and
 * other integrations and older cores use it, so both are accepted.
 */

const HMS = /^(-)?(?:(\d+)\s+days?,\s*)?(\d+):(\d{1,2})(?::(\d{1,2})(?:\.(\d+))?)?$/;

/** "0:05:00", "26:00:00", "1 day, 2:00:00", "05:00" -> ms. */
export function parseHmsDuration(text: unknown): number | undefined {
  if (typeof text === 'number') return Number.isFinite(text) ? text * 1000 : undefined;
  if (typeof text !== 'string') return undefined;
  const match = HMS.exec(text.trim());
  if (!match) return undefined;
  const [, negative, days, a, b, c, frac] = match;
  // "MM:SS" when there is no third group; "H:MM:SS" otherwise.
  const hours = c === undefined ? 0 : Number(a);
  const minutes = c === undefined ? Number(a) : Number(b);
  const seconds = c === undefined ? Number(b) : Number(c);
  if (minutes > 59 && c !== undefined) return undefined;
  if (seconds > 59) return undefined;
  const ms =
    ((Number(days ?? 0) * 24 + hours) * 3600 + minutes * 60 + seconds) * 1000 +
    (frac ? Number(frac.slice(0, 3).padEnd(3, '0')) : 0);
  return negative ? -ms : ms;
}

const UNIT_MS: Record<string, number> = {
  d: 86_400_000,
  h: 3_600_000,
  m: 60_000,
  s: 1000,
};

/**
 * A user-written span for `progress.window`: "24h", "90m", "1d 2h 30m", a
 * plain number of seconds, or "H:MM:SS".
 */
export function parseSpan(value: unknown): number | undefined {
  if (typeof value === 'number') return value > 0 ? value * 1000 : undefined;
  if (typeof value !== 'string') return undefined;
  const text = value.trim().toLowerCase();
  if (!text) return undefined;
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text) * 1000 || undefined;
  if (text.includes(':')) {
    const ms = parseHmsDuration(text);
    return ms && ms > 0 ? ms : undefined;
  }
  const parts = text.split(/\s+/);
  let total = 0;
  for (const part of parts) {
    const match = /^(\d+(?:\.\d+)?)([dhms])$/.exec(part);
    if (!match) return undefined;
    total += Number(match[1]) * UNIT_MS[match[2]];
  }
  return total > 0 ? total : undefined;
}
