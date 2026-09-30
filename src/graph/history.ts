import { CARD_TAG } from '../const';
import type { Dict, HomeAssistant } from '../types';
import type { Point } from './aggregate';

/**
 * The recorded history of the entities a graph draws, kept current.
 *
 * `history/stream` is what Home Assistant's own history graphs use: one
 * subscription delivers the history since `start_time` and then every new
 * state as it is recorded. The connection re-subscribes by itself after a
 * reconnect, and the first message after that carries the history again, so
 * a wall tablet that lost its connection overnight catches up on its own.
 *
 * The message format, from the frontend's src/data/history.ts:
 *   { states: { [entity_id]: [{ s: state, a?: attributes, lu: last_updated (s), lc? }] },
 *     start_time?: number (s) }
 */

export interface HistoryState {
  s: string;
  a?: Dict;
  lu: number;
  lc?: number;
}

interface StreamMessage {
  states: Record<string, HistoryState[]>;
  start_time?: number;
  end_time?: number;
}

export interface Connection {
  subscribeMessage<T>(callback: (message: T) => void, message: Dict): Promise<() => Promise<void>>;
}

/** What has been recorded, per entity, oldest first. */
export type HistoryData = Record<string, HistoryState[]>;

/**
 * Merges one stream message into what is already there. States older than
 * the window are dropped, except the last of them: it is the state that was
 * in force when the window starts.
 */
export function mergeHistory(
  current: HistoryData,
  message: StreamMessage,
  purgeBeforeMs: number,
): HistoryData {
  const out: HistoryData = {};
  const ids = new Set([...Object.keys(current), ...Object.keys(message.states || {})]);
  const cutoff = purgeBeforeMs / 1000;
  ids.forEach((id) => {
    let states = [...(current[id] || []), ...((message.states || {})[id] || [])];
    if (states.some((state, i) => i > 0 && state.lu < states[i - 1].lu)) {
      states.sort((a, b) => a.lu - b.lu);
    }
    // After a reconnect the stream sends the window again; what is already
    // there must not be drawn twice.
    states = states.filter((state, i) => i === 0 || state.lu !== states[i - 1].lu);
    const firstInside = states.findIndex((state) => state.lu >= cutoff);
    if (firstInside > 0) states = states.slice(firstInside - 1);
    else if (firstInside === -1 && states.length > 1) states = states.slice(-1);
    out[id] = states;
  });
  return out;
}

/** Reads a dotted attribute path, `forecast.0.temperature` included. */
function readPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (value === null || value === undefined) return undefined;
    return (value as Dict)[key];
  }, source);
}

export interface LineSource {
  entity: string;
  attribute?: string;
  state_map?: Record<string, number>;
  value_factor: number;
}

/** A number from a state, or nothing. Mapped first, so on/off can be drawn. */
export function toValue(raw: unknown, line: LineSource): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const key = String(raw);
  const mapped =
    line.state_map && Object.prototype.hasOwnProperty.call(line.state_map, key)
      ? line.state_map[key]
      : raw;
  const number = typeof mapped === 'number' ? mapped : Number(mapped);
  if (!Number.isFinite(number)) return undefined;
  return line.value_factor ? number * 10 ** line.value_factor : number;
}

/**
 * One line's points. An attribute is carried in `a` only on the states
 * where it changed, so the last seen attributes are carried along.
 */
export function pointsOf(history: HistoryData, line: LineSource): Point[] {
  const states = history[line.entity] || [];
  const points: Point[] = [];
  let attributes: Dict = {};
  states.forEach((state) => {
    if (state.a) attributes = { ...attributes, ...state.a };
    const raw = line.attribute ? readPath(attributes, line.attribute) : state.s;
    const value = toValue(raw, line);
    if (value !== undefined) points.push({ t: state.lu * 1000, v: value });
  });
  return points;
}

/**
 * Subscribes to the history of `entityIds` for the last `hours`. Calls back
 * with the merged history on every message. Returns the unsubscribe.
 */
export function subscribeHistory(
  hass: HomeAssistant & { connection?: Connection },
  entityIds: string[],
  hours: number,
  withAttributes: boolean,
  onData: (history: HistoryData) => void,
): () => void {
  const connection = hass.connection;
  if (!connection || typeof connection.subscribeMessage !== 'function' || !entityIds.length) {
    return () => undefined;
  }
  let history: HistoryData = {};
  let stopped = false;
  let unsubscribe: (() => Promise<void>) | null = null;
  const windowMs = hours * 3_600_000;

  connection
    .subscribeMessage<StreamMessage>(
      (message) => {
        if (stopped) return;
        history = mergeHistory(history, message, Date.now() - windowMs);
        onData(history);
      },
      {
        type: 'history/stream',
        entity_ids: entityIds,
        start_time: new Date(Date.now() - windowMs).toISOString(),
        // Attributes only when a line reads one: they are most of the payload.
        minimal_response: !withAttributes,
        no_attributes: !withAttributes,
        // Every recorded change: "significant" filters out small steps, and
        // small steps are what a graph of a room temperature consists of.
        significant_changes_only: false,
      },
    )
    .then((unsub) => {
      if (stopped) unsub().catch(() => undefined);
      else unsubscribe = unsub;
    })
    .catch((err) => {
      console.warn(`${CARD_TAG}: history for ${entityIds.join(', ')} is not available`, err);
    });

  return () => {
    stopped = true;
    if (unsubscribe) unsubscribe().catch(() => undefined);
    unsubscribe = null;
  };
}
