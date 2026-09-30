/* -------------------------------------------------------------------------- */
/* Home Assistant                                                              */
/* -------------------------------------------------------------------------- */

/** A loosely typed mapping, as YAML hands it over. */
export type Dict = Record<string, unknown>;

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Dict & {
    friendly_name?: string;
    icon?: string;
    unit_of_measurement?: string;
  };
  last_changed?: string;
  last_updated?: string;
}

/**
 * Only the parts of `hass` this card touches. Hand-written on purpose: the
 * community type packages are unmaintained and type several of these wrong.
 */
export interface HomeAssistant {
  states: Record<string, HassEntity>;
  user?: { id: string; name?: string };
  language?: string;
  locale?: { language: string; time_format?: string; time_zone?: 'local' | 'server' };
  config?: { time_zone: string };
  callService(domain: string, service: string, data?: Dict, target?: unknown): unknown;
  formatEntityState?: (stateObj: HassEntity, state?: string) => string;
}

/* -------------------------------------------------------------------------- */
/* Configuration after normalizeConfig                                         */
/* -------------------------------------------------------------------------- */

export interface LayoutConfig {
  mode: string;
  columns: number | string;
  gap: number | string;
  min_button_size: number | string;
  max_button_size: number | string;
  column_width: number | string;
  max_columns: number;
}

export interface AppearanceConfig {
  background: string | null;
  radius: number | string | null;
  padding: number | string;
  shadow: boolean | null;
}

export interface AnimationConfig {
  enabled: boolean;
  type: string;
  duration: string;
  intensity: number;
  /** A state, a list of states, a keyword or `{ above, below }`. */
  when: unknown;
}

/**
 * Home Assistant's own action config, with the spellings folded onto one:
 * `perform-action` is stored as `call-service`, `perform_action` as `service`.
 */
export interface ActionConfig {
  action: string;
  entity?: string;
  entity_id?: string;
  service?: string;
  perform_action?: string;
  data?: Dict;
  service_data?: Dict;
  target?: unknown;
  navigation_path?: string;
  url_path?: string;
  url?: string;
  new_tab?: boolean;
  pipeline_id?: string;
  start_listening?: boolean;
  confirmation?: unknown;
  [key: string]: unknown;
}

export type Gesture = 'tap' | 'hold' | 'double_tap';

/** `null` = no confirmation; `text: null` = use the built-in prompt. */
export type Confirmation = { text: string | null } | null;

/**
 * What every item has, whatever its type: the cell it lives in, how it is
 * placed, when it is shown and what touching it does. Everything else belongs
 * to the type.
 *
 * Values typed `unknown` may hold a `[[[ template ]]]` and are only resolved
 * at render time.
 */
export interface ItemBase {
  index: number;
  type: string;
  /** Set when the item cannot be rendered as configured. */
  error: string | null;
  entity: string | null;

  /* The cell. Inherited from the type's defaults block, then from `item:`. */
  radius: unknown;
  background: unknown;
  active_background: unknown;
  color: unknown;
  active_color: unknown;
  label_size: unknown;
  icon_size: unknown;
  icon_color: unknown;
  press_effect: string;
  style: unknown;
  /**
   * `[[[ template ]]]` deciding when the item counts as active, instead of
   * the type's own rule. null = the type decides.
   */
  active_when: unknown;
  /**
   * Whether a type that draws something - a ring, a bar, a graph - draws it:
   * `always`, `active`, or a template.
   */
  show_drawing: unknown;

  visibility: Dict[];
  weight: number;
  tap_action: ActionConfig;
  hold_action: ActionConfig;
  double_tap_action: ActionConfig;
  confirmation: Record<Gesture, Confirmation>;
  /**
   * Scanned once: the sync path then only builds a template context for the
   * items that actually need one.
   */
  hasTemplates: boolean;
}

export interface CardConfig<I extends ItemBase = ItemBase> {
  title: string | null;
  layout: LayoutConfig;
  appearance: AppearanceConfig;
  /** Cell defaults for every item. */
  item: Dict;
  /** Defaults blocks keyed by item type, e.g. `button:`. */
  defaults: Record<string, Dict>;
  animation: AnimationConfig;
  /** Values every template can read as `variables`. */
  variables: Dict;
  items: I[];
}
