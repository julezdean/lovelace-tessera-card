import type { AnimationConfig, ItemBase } from '../types';

/**
 * The options every progress type shares - ring, bar, segments and digits
 * differ in how they draw a proportion, not in where it comes from.
 */

export type SourceType =
  | 'auto'
  | 'timer'
  | 'timestamp'
  | 'remaining'
  | 'percentage'
  | 'numeric'
  | 'state'
  | 'attribute'
  | 'template';

export type FormatStyle = 'auto' | 'SS' | 'MM:SS' | 'HH:MM:SS' | 'DD:HH:MM:SS' | 'short' | 'long';

export type Tristate = 'auto' | boolean;

export type ProgressStatus = 'active' | 'paused' | 'idle' | 'finished' | 'unknown';

/** A point in time or a span: literal, or read from an entity. */
export type EntityRef = { entity: string; attribute?: string };
export type TimeRef = string | number | EntityRef;

export interface SourceConfig {
  type: SourceType;
  attribute?: string;
  /** State (or attribute) value -> number or timestamp, before interpretation. */
  map?: Record<string, number | string>;
  /** `[[[ ... ]]]` for `type: template`. */
  template?: string;
  /** How a timestamp without an offset is read. */
  naive_timezone: 'server' | 'browser';
}

export interface ProgressRange {
  direction: 'remaining' | 'elapsed';
  start?: TimeRef;
  end?: TimeRef;
  /** The whole span: "2h", seconds, or an entity holding a duration. */
  window?: TimeRef;
  min?: number;
  max?: number;
}

export interface FormatConfig {
  style: FormatStyle;
  largest_units: number;
  show_days: Tristate;
  show_hours: Tristate;
  show_minutes: Tristate;
  show_seconds: Tristate;
  decimals: number;
}

export interface Threshold {
  value: number;
  color: string;
}

export interface ColorConfig {
  mode: 'static' | 'thresholds' | 'gradient';
  basis: 'progress' | 'remaining_seconds' | 'value';
  thresholds: Threshold[];
  /** gradient mode: the colours at the start and the end of the course. */
  start?: string;
  end?: string;
  /** Second colour of a fill drawn as a gradient along its length. */
  secondary?: string;
  track?: string;
}

export interface OnComplete {
  action: 'show_zero' | 'show_text' | 'count_up';
  text?: string;
}

export interface ProgressItem extends ItemBase {
  type: 'ring' | 'bar' | 'segments' | 'digits';
  name: unknown;
  icon: unknown;
  label: unknown;
  show_name: unknown;
  source: SourceConfig;
  progress: ProgressRange;
  format: FormatConfig;
  colors: ColorConfig;
  on_complete: OnComplete;
  status_labels: Partial<Record<ProgressStatus, string>>;
  animation: AnimationConfig;
  /** Seconds before the end at which `when: finishing` starts. */
  finishing_seconds: number;

  /* How it is drawn. Not every type reads every one of these. */
  /** ring: what sits in the middle. */
  inner: 'auto' | 'value' | 'percentage' | 'icon' | 'none';
  /** ring: percent of the diameter; bar and segments: px. */
  thickness: number;
  rounded: boolean;
  track: boolean;
  /** Fill drawn from the accent to colors.secondary along its length. */
  gradient: boolean;
  /** ring: degrees of the circle drawn; below 360 it is an open gauge. */
  arc: number;
  /** segments: how many. */
  segments: number;
  /** digits: each group on its own tile. */
  tiles: boolean;
}
