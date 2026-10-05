import { VALID_ANIMATIONS } from '../core/animation';

/**
 * Pieces of ha-form schema that more than one page uses. ha-form renders from
 * a declarative schema; these are plain objects in its format.
 */

export const ACTION_TYPES = [
  'more-info',
  'toggle',
  'perform-action',
  'navigate',
  'url',
  'assist',
  'none',
];

export const select = (
  name: string,
  options: Array<{ value: string; label: string }>,
  mode = 'dropdown',
) => ({
  name,
  selector: { select: { mode, options } },
});

export const ANIMATION_SCHEMA = [
  select(
    'type',
    [...VALID_ANIMATIONS].map((value) => ({ value, label: value })),
  ),
  {
    name: 'when',
    selector: {
      select: {
        custom_value: true,
        mode: 'dropdown',
        options: [
          { value: 'active', label: 'Entity is active' },
          { value: 'inactive', label: 'Entity is inactive' },
          { value: 'always', label: 'Always' },
          { value: 'never', label: 'Never' },
        ],
      },
    },
  },
  { name: 'duration', selector: { text: {} } },
  { name: 'intensity', selector: { number: { min: 0, max: 3, step: 0.1, mode: 'slider' } } },
];

/** Tap, hold and double tap, each with its confirmation switch. */
export const ACTIONS_SECTION = {
  type: 'expandable',
  name: '',
  title: 'Actions',
  icon: 'mdi:gesture-tap',
  schema: [
    { name: 'tap_action', selector: { ui_action: { actions: ACTION_TYPES } } },
    { name: 'confirm_tap', selector: { boolean: {} } },
    { name: 'hold_action', selector: { ui_action: { actions: ACTION_TYPES } } },
    { name: 'confirm_hold', selector: { boolean: {} } },
    { name: 'double_tap_action', selector: { ui_action: { actions: ACTION_TYPES } } },
    { name: 'confirm_double_tap', selector: { boolean: {} } },
  ],
};

export const LAYOUT_SELECT = select('layout', [
  { value: 'vertical', label: 'Icon above the text' },
  { value: 'horizontal', label: 'Icon beside the text' },
]);

export const PRESS_EFFECT_SELECT = select('press_effect', [
  { value: 'scale', label: 'Scale' },
  { value: 'fade', label: 'Brighten' },
  { value: 'none', label: 'None' },
]);

/**
 * When the item counts as active, as a template. Every type has it; a text
 * field, because it is a template or nothing.
 */
export const ACTIVE_WHEN_FIELD = { name: 'active_when', selector: { text: { multiline: true } } };

/** always, only while active, or a template: a select that takes a value of its own. */
export const SHOW_DRAWING_FIELD = {
  name: 'show_drawing',
  selector: {
    select: {
      mode: 'dropdown',
      custom_value: true,
      options: [
        { value: 'always', label: 'Always' },
        { value: 'active', label: 'While it is active' },
      ],
    },
  },
};

/** How large an item's icon and name are - every type has both. */
export const SIZE_FIELDS = [
  { name: 'icon_size', selector: { number: { min: 12, max: 96, mode: 'slider' } } },
  { name: 'name_size', selector: { number: { min: 8, max: 40, mode: 'slider' } } },
  { name: 'name_weight', selector: { number: { min: 100, max: 900, step: 100, mode: 'slider' } } },
  { name: 'label_size', selector: { number: { min: 8, max: 32, mode: 'slider' } } },
  { name: 'label_weight', selector: { number: { min: 100, max: 900, step: 100, mode: 'slider' } } },
];

/** Whether the icon is shown, next to show_name in every type's display section. */
export const SHOW_ICON_FIELD = { name: 'show_icon', selector: { boolean: {} } };

export const SHOW_ENTITY_PICTURE_FIELD = {
  name: 'show_entity_picture',
  selector: { boolean: {} },
};

/** The switch, and the picture an item brings itself instead of its entity's. */
export const PICTURE_FIELDS = [
  SHOW_ENTITY_PICTURE_FIELD,
  { name: 'entity_picture', selector: { text: {} } },
];

export const ICON_COLOR_FIELD = { name: 'icon_color', selector: { text: {} } };

/** Labels, so the form does not show raw config keys. */
export const LABELS: Record<string, string> = {
  title: 'Title',
  mode: 'Mode',
  columns: 'Columns',
  gap: 'Gap between items',
  column_width: 'Target column width',
  max_columns: 'Maximum columns (automatic mode)',
  min_button_size: 'Minimum item height',
  max_button_size: 'Maximum item height',
  appearance: 'Card appearance',
  background: 'Background',
  active_background: 'Background when active',
  style: 'Extra CSS',
  radius: 'Corner radius',
  padding: 'Padding',
  shadow: 'Shadow',
  item: 'Item defaults',
  button: 'Button defaults',
  active_color: 'Accent colour',
  icon_color: 'Icon colour',
  icon_size: 'Icon size (px)',
  name_size: 'Name size (px)',
  name_weight: 'Name weight',
  label_size: 'Second line size (px)',
  label_weight: 'Second line weight',
  show_icon: 'Show icon',
  show_entity_picture: 'Show picture instead of icon',
  entity_picture: "Picture (path or URL, else the entity's)",
  show_name: 'Show name',
  show_state: 'Show state',
  press_effect: 'Press effect',
  layout: 'Icon and text',
  animation: 'Animation',
  type: 'Type',
  duration: 'Duration',
  intensity: 'Intensity',
  when: 'Run when',
  entity: 'Entity',
  name: 'Name',
  icon: 'Icon',
  label: 'Label',
  colspan: 'Width in slots',
  confirm_tap: 'Confirm tap',
  confirm_hold: 'Confirm hold',
  confirm_double_tap: 'Confirm double tap',
  state_display: 'State text',
  tap_action: 'Tap',
  hold_action: 'Hold',
  double_tap_action: 'Double tap',
  attribute: 'Attribute',
  template: 'Template',
  direction: 'Direction',
  window: 'Whole span (e.g. 2h)',
  start: 'Start',
  end: 'End',
  min: 'Minimum',
  max: 'Maximum',
  inner: 'Inside the ring',
  thickness: 'Thickness',
  arc: 'Arc',
  segments: 'Segments',
  tiles: 'Digits on tiles',
  rounded: 'Rounded ends',
  track: 'Show the track',
  gradient: 'Gradient (needs colors.secondary)',
  format_style: 'Format',
  show_seconds: 'Seconds',
  decimals: 'Decimals',
  action: 'Then',
  text: 'Text',
  graph_layout: 'Arrangement',
  graph_height: 'Graph height (e.g. 50% or 60px)',
  graph: 'Draw as',
  fill: 'Fill',
  smoothing: 'Smooth line',
  line_width: 'Line width',
  hours_to_show: 'Hours to show',
  points_per_hour: 'Points per hour',
  aggregate_func: 'Per point',
  lower_bound: 'Lower bound (~ = soft)',
  upper_bound: 'Upper bound (~ = soft)',
  min_bound_range: 'Minimum range',
  unit: 'Unit',
  active_when: 'Active when (template)',
  button_layout: 'Icon and text (buttons)',
  show_drawing: 'Show the drawing',
};
