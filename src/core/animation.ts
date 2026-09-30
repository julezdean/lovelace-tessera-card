import type { AnimationConfig, Dict, HassEntity } from '../types';
import { isActiveState, isUnavailable } from './state';

export const VALID_ANIMATIONS = new Set([
  'none',
  'pulse',
  'bounce',
  'spin',
  'shake',
  'glow',
  'breathe',
  'blink',
  'wobble',
]);

export const DEFAULT_ANIMATION: AnimationConfig = {
  enabled: true,
  type: 'none',
  duration: '2s',
  intensity: 1,
  when: 'active',
};

function normalizeDuration(value: unknown): string {
  if (typeof value === 'number') return `${value}s`;
  const text = String(value).trim();
  return /^[\d.]+$/.test(text) ? `${text}s` : text;
}

/**
 * Animation config accepts a bare string (`animation: pulse`) or a mapping.
 * `state:` and `when:` are aliases - both spellings appear in the wild.
 */
export function normalizeAnimation(raw: unknown, fallback: AnimationConfig): AnimationConfig {
  const base = { ...fallback };
  if (raw === undefined || raw === null) return base;

  if (typeof raw === 'string') {
    return { ...base, type: raw, enabled: raw !== 'none' };
  }
  if (typeof raw !== 'object') return base;

  const src = raw as Dict;
  const merged = { ...base };
  if (src.enabled !== undefined) merged.enabled = !!src.enabled;
  if (src.type !== undefined) merged.type = String(src.type);
  if (src.duration !== undefined) merged.duration = normalizeDuration(src.duration);
  if (src.intensity !== undefined) {
    const value = Number(src.intensity);
    merged.intensity = Number.isFinite(value) ? Math.max(0, Math.min(3, value)) : 1;
  }
  // when / state / above / below all describe the same condition object.
  if (src.when !== undefined) merged.when = src.when;
  else if (src.state !== undefined) merged.when = src.state;
  if (src.above !== undefined || src.below !== undefined) {
    merged.when = { above: src.above, below: src.below };
  }

  if (!VALID_ANIMATIONS.has(merged.type)) merged.type = 'none';
  return merged;
}

/**
 * Does the animation condition hold right now?
 *
 * when: "always"            -> always
 * when: "active"            -> HA's active semantics (default)
 * when: "on" / 42 / "heat"  -> exact state match
 * when: ["on", "heat"]      -> any of
 * when: { above: 30 }       -> numeric comparison
 * when: { state: "on" }     -> same as the bare string
 */
export function animationActive(
  animation: AnimationConfig | null | undefined,
  stateObj: HassEntity | undefined,
  active: boolean = isActiveState(stateObj),
): boolean {
  if (!animation || !animation.enabled || animation.type === 'none') return false;

  const condition = animation.when;
  if (condition === undefined || condition === null) return true;
  if (condition === 'always' || condition === true) return true;
  if (condition === 'never' || condition === false) return false;
  if (condition === 'active') return active;
  if (condition === 'inactive') return !!stateObj && !active;
  if (condition === 'unavailable') return isUnavailable(stateObj);

  if (!stateObj) return false;
  const state = String(stateObj.state);

  if (Array.isArray(condition)) {
    return condition.some((value) => String(value) === state);
  }

  if (typeof condition === 'object') {
    const range = condition as Dict;
    if (range.state !== undefined) return String(range.state) === state;
    const numeric = Number(state);
    if (Number.isNaN(numeric)) return false;
    if (range.above !== undefined && !(numeric > Number(range.above))) return false;
    if (range.below !== undefined && !(numeric < Number(range.below))) return false;
    return range.above !== undefined || range.below !== undefined;
  }

  // YAML unquoted `on:` arrives as boolean true - already handled above,
  // but `state: on` inside a mapping may arrive as the string "true".
  if (condition === 'true') return state === 'on';
  if (condition === 'false') return state === 'off';

  return String(condition) === state;
}
