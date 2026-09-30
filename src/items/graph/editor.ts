import { AGGREGATE_FUNCS } from '../../graph/aggregate';
import {
  ACTIONS_SECTION,
  ACTIVE_WHEN_FIELD,
  ICON_COLOR_FIELD,
  SHOW_DRAWING_FIELD,
  SIZE_FIELDS,
  select,
} from '../../editor/schema';
import {
  actionFromForm,
  actionToForm,
  cellDefaults,
  cellFromForm,
  cellToForm,
  confirmationFromConfig,
  pruneDefaults,
} from '../../editor/transform';
import type { Dict } from '../../types';
import type { EditorContext, ItemEditor } from '../item-type';

const SCHEMA = [
  { name: 'entity', selector: { entity: {} } },
  { name: 'name', selector: { text: {} } },
  { name: 'icon', selector: { icon: {} } },
  { name: 'colspan', selector: { number: { min: 1, max: 6, mode: 'box' } } },
  ACTIVE_WHEN_FIELD,
  {
    type: 'expandable',
    name: '',
    title: 'Graph',
    icon: 'mdi:chart-line',
    schema: [
      select('graph_layout', [
        { value: 'split', label: 'Text on top, graph below' },
        { value: 'background', label: 'Graph behind the text' },
      ]),
      { name: 'graph_height', selector: { text: {} } },
      select('graph', [
        { value: 'line', label: 'Line' },
        { value: 'bar', label: 'Bars' },
      ]),
      select('fill', [
        { value: 'fade', label: 'Fading' },
        { value: 'true', label: 'Solid' },
        { value: 'false', label: 'None' },
      ]),
      { name: 'smoothing', selector: { boolean: {} } },
      {
        name: 'line_width',
        selector: { number: { min: 1, max: 12, mode: 'slider', unit_of_measurement: 'px' } },
      },
    ],
  },
  {
    type: 'expandable',
    name: '',
    title: 'Data',
    icon: 'mdi:database-clock-outline',
    schema: [
      {
        name: 'hours_to_show',
        selector: { number: { min: 1, max: 240, mode: 'box', unit_of_measurement: 'h' } },
      },
      {
        name: 'points_per_hour',
        selector: { number: { min: 0.1, max: 60, step: 0.1, mode: 'box' } },
      },
      select(
        'aggregate_func',
        AGGREGATE_FUNCS.map((value) => ({ value, label: value })),
      ),
      { name: 'attribute', selector: { text: {} } },
      { name: 'lower_bound', selector: { text: {} } },
      { name: 'upper_bound', selector: { text: {} } },
      { name: 'min_bound_range', selector: { number: { min: 0, mode: 'box' } } },
    ],
  },
  {
    type: 'expandable',
    name: '',
    title: 'Display',
    icon: 'mdi:text-short',
    schema: [
      SHOW_DRAWING_FIELD,
      ...SIZE_FIELDS,
      { name: 'show_name', selector: { boolean: {} } },
      { name: 'label', selector: { text: {} } },
      { name: 'unit', selector: { text: {} } },
      { name: 'decimals', selector: { number: { min: 0, max: 4, mode: 'box' } } },
    ],
  },
  ACTIONS_SECTION,
  {
    type: 'expandable',
    name: '',
    title: 'Colours',
    icon: 'mdi:palette-outline',
    schema: [
      { name: 'active_color', selector: { text: {} } },
      ICON_COLOR_FIELD,
      { name: 'background', selector: { text: {} } },
      { name: 'style', selector: { text: { multiline: true } } },
    ],
  },
];

const FORM_KEYS = [
  'entity',
  'name',
  'icon',
  'colspan',
  'graph_layout',
  'graph_height',
  'graph',
  'fill',
  'smoothing',
  'line_width',
  'hours_to_show',
  'points_per_hour',
  'aggregate_func',
  'attribute',
  'lower_bound',
  'upper_bound',
  'min_bound_range',
  'show_name',
  'label',
  'unit',
  'decimals',
  'tap_action',
  'hold_action',
  'double_tap_action',
  'active_color',
  'background',
  'style',
  'icon_size',
  'label_size',
  'icon_color',
  'active_when',
  'show_drawing',
] as const;

/** What a graph inherits for its cell: `item:`, then the `graph:` block. */
const cellInherited = (config: Dict): Dict => ({
  ...((config.item as Dict) || {}),
  ...((config.graph as Dict) || {}),
});

const FORM_DEFAULTS: Dict = {
  graph_layout: 'split',
  graph_height: '50%',
  graph: 'line',
  fill: 'fade',
  smoothing: true,
  line_width: 2,
  hours_to_show: 24,
  points_per_hour: 1,
  aggregate_func: 'avg',
  show_name: true,
  colspan: 1,
  show_drawing: 'always',
};

/** fill is true, false or 'fade'; a select only carries strings. */
const fillToForm = (value: unknown) =>
  value === true ? 'true' : value === false ? 'false' : 'fade';
const fillFromForm = (value: unknown) =>
  value === 'true' ? true : value === 'false' ? false : 'fade';

/**
 * `lines:`, `state_map` and the thresholds are YAML-only: each is a list or
 * a mapping a form would make worse. The form keeps them as they are.
 */
export const graphEditor: ItemEditor = {
  schema: () => SCHEMA,
  formKeys: FORM_KEYS,

  toForm(item: Dict, { config }: EditorContext): Dict {
    const defaults = { ...FORM_DEFAULTS, ...((config.graph as Dict) || {}) };
    const own = (key: string) => item[key] ?? defaults[key];
    return {
      entity: item.entity ?? '',
      name: item.name ?? '',
      icon: typeof item.icon === 'string' ? item.icon : '',
      colspan: item.colspan ?? 1,
      graph_layout: own('graph_layout'),
      graph_height: String(own('graph_height')),
      graph: own('graph'),
      fill: fillToForm(own('fill')),
      smoothing: own('smoothing') !== false,
      line_width: own('line_width'),
      hours_to_show: own('hours_to_show'),
      points_per_hour: own('points_per_hour'),
      aggregate_func: own('aggregate_func'),
      attribute: item.attribute ?? '',
      lower_bound: item.lower_bound === undefined ? '' : String(item.lower_bound),
      upper_bound: item.upper_bound === undefined ? '' : String(item.upper_bound),
      min_bound_range: item.min_bound_range,
      show_name: item.show_name ?? true,
      label: item.label ?? '',
      unit: item.unit ?? '',
      decimals: item.decimals,
      tap_action: actionToForm(item.tap_action),
      hold_action: actionToForm(item.hold_action),
      double_tap_action: actionToForm(item.double_tap_action),
      confirm_tap: Boolean(confirmationFromConfig(item, 'tap')),
      confirm_hold: Boolean(confirmationFromConfig(item, 'hold')),
      confirm_double_tap: Boolean(confirmationFromConfig(item, 'double_tap')),
      active_color: item.active_color ?? '',
      background: item.background ?? '',
      style: item.style ?? '',
      ...cellToForm(item, cellInherited(config)),
      active_when: item.active_when ?? '',
      show_drawing: item.show_drawing ?? 'always',
    };
  },

  fromForm(value: Dict, previous: Dict, { config }: EditorContext): Dict {
    const defaults = { ...FORM_DEFAULTS, ...((config.graph as Dict) || {}) };
    // A bound of 15 stays a number; ~15 is a soft bound and stays text.
    const bound = (raw: unknown) => {
      const text = raw === undefined || raw === null ? '' : String(raw).trim();
      if (!text) return undefined;
      return /^-?[\d.]+$/.test(text) ? Number(text) : text;
    };
    const next = pruneDefaults(
      {
        entity: value.entity,
        name: value.name,
        icon: value.icon,
        colspan: value.colspan,
        graph_layout: value.graph_layout,
        graph_height: value.graph_height,
        graph: value.graph,
        fill: fillFromForm(value.fill),
        smoothing: value.smoothing,
        line_width: value.line_width,
        hours_to_show: value.hours_to_show,
        points_per_hour: value.points_per_hour,
        aggregate_func: value.aggregate_func,
        attribute: value.attribute,
        lower_bound: bound(value.lower_bound),
        upper_bound: bound(value.upper_bound),
        min_bound_range: value.min_bound_range,
        show_name: value.show_name,
        label: value.label,
        unit: value.unit,
        decimals: value.decimals,
        tap_action: actionFromForm(
          value.tap_action,
          value.confirm_tap,
          confirmationFromConfig(previous, 'tap'),
        ),
        hold_action: actionFromForm(
          value.hold_action,
          value.confirm_hold,
          confirmationFromConfig(previous, 'hold'),
        ),
        double_tap_action: actionFromForm(
          value.double_tap_action,
          value.confirm_double_tap,
          confirmationFromConfig(previous, 'double_tap'),
        ),
        active_color: value.active_color,
        background: value.background,
        style: value.style,
        ...cellFromForm(value),
        active_when: value.active_when,
        show_drawing: value.show_drawing,
      },
      { ...defaults, ...cellDefaults(cellInherited(config)) },
    );
    if (previous.icon && typeof previous.icon === 'object' && !value.icon)
      next.icon = previous.icon;
    return next;
  },

  create: () => ({}),
  fallbackName: (index) => `Graph ${index + 1}`,
};
