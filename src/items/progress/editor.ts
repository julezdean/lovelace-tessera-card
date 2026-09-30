import { VALID_ANIMATIONS } from '../../core/animation';
import {
  ACTIONS_SECTION,
  ACTIVE_WHEN_FIELD,
  ICON_COLOR_FIELD,
  SHOW_DRAWING_FIELD,
  SHOW_ICON_FIELD,
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
import type { ProgressItem } from '../../progress/types';
import type { Dict } from '../../types';
import { isDict } from '../../utils';
import type { EditorContext, ItemEditor } from '../item-type';

const SOURCE_OPTIONS = [
  { value: 'auto', label: 'Automatic' },
  { value: 'timer', label: 'Timer' },
  { value: 'timestamp', label: 'Point in time' },
  { value: 'remaining', label: 'Time left (a number)' },
  { value: 'percentage', label: 'Percentage' },
  { value: 'numeric', label: 'Number on a scale' },
  { value: 'attribute', label: 'An attribute' },
  { value: 'template', label: 'Template' },
];

const FORMAT_OPTIONS = ['auto', 'MM:SS', 'HH:MM:SS', 'DD:HH:MM:SS', 'SS', 'short', 'long'].map(
  (value) => ({ value, label: value === 'auto' ? 'Automatic' : value }),
);

/** The drawing's own options - the only part of the page that differs between the types. */
function drawingSchema(type: ProgressItem['type']): unknown[] {
  const thickness = (max: number, unit: string) => ({
    name: 'thickness',
    selector: { number: { min: 1, max, mode: 'slider', unit_of_measurement: unit } },
  });
  const shape = [
    { name: 'rounded', selector: { boolean: {} } },
    { name: 'track', selector: { boolean: {} } },
    { name: 'gradient', selector: { boolean: {} } },
  ];
  switch (type) {
    case 'ring':
      return [
        select('inner', [
          { value: 'auto', label: 'Automatic' },
          { value: 'value', label: 'The value' },
          { value: 'percentage', label: 'The percentage' },
          { value: 'icon', label: 'The icon' },
          { value: 'none', label: 'Nothing' },
        ]),
        thickness(40, '%'),
        {
          name: 'arc',
          selector: {
            number: { min: 90, max: 360, step: 10, mode: 'slider', unit_of_measurement: '°' },
          },
        },
        ...shape,
      ];
    case 'segments':
      return [
        { name: 'segments', selector: { number: { min: 2, max: 40, mode: 'box' } } },
        thickness(6, 'px'),
        ...shape,
      ];
    case 'bar':
      return [thickness(6, 'px'), ...shape];
    default:
      return [{ name: 'tiles', selector: { boolean: {} } }];
  }
}

function schema(type: ProgressItem['type']): unknown[] {
  return [
    { name: 'entity', selector: { entity: {} } },
    { name: 'name', selector: { text: {} } },
    { name: 'icon', selector: { icon: {} } },
    { name: 'colspan', selector: { number: { min: 1, max: 6, mode: 'box' } } },
    ACTIVE_WHEN_FIELD,
    {
      type: 'expandable',
      name: 'source',
      title: 'Source',
      icon: 'mdi:database-arrow-right-outline',
      schema: [
        select('type', SOURCE_OPTIONS),
        { name: 'attribute', selector: { text: {} } },
        { name: 'template', selector: { text: { multiline: true } } },
      ],
    },
    {
      type: 'expandable',
      name: 'progress',
      title: 'Range',
      icon: 'mdi:arrow-expand-horizontal',
      schema: [
        select('direction', [
          { value: 'remaining', label: 'Empties as time runs out' },
          { value: 'elapsed', label: 'Fills as time passes' },
        ]),
        { name: 'window', selector: { text: {} } },
        { name: 'start', selector: { text: {} } },
        { name: 'end', selector: { text: {} } },
        { name: 'min', selector: { number: { mode: 'box' } } },
        { name: 'max', selector: { number: { mode: 'box' } } },
      ],
    },
    {
      type: 'expandable',
      name: '',
      title: 'Display',
      icon: 'mdi:text-short',
      schema: [
        ...drawingSchema(type),
        SHOW_DRAWING_FIELD,
        ...SIZE_FIELDS,
        { name: 'show_name', selector: { boolean: {} } },
        SHOW_ICON_FIELD,
        { name: 'label', selector: { text: {} } },
      ],
    },
    {
      // Flat rather than nested under `format`: `style` there would take the
      // label of the item's own `style` (Extra CSS), since labels go by name.
      type: 'expandable',
      name: '',
      title: 'Time format',
      icon: 'mdi:timer-outline',
      schema: [
        select('format_style', FORMAT_OPTIONS),
        select('show_seconds', [
          { value: 'auto', label: 'Automatic' },
          { value: 'true', label: 'Always' },
          { value: 'false', label: 'Never' },
        ]),
        { name: 'decimals', selector: { number: { min: 0, max: 3, mode: 'box' } } },
      ],
    },
    {
      type: 'expandable',
      name: 'on_complete',
      title: 'When it is over',
      icon: 'mdi:flag-checkered',
      schema: [
        select('action', [
          { value: 'show_zero', label: 'Show zero' },
          { value: 'show_text', label: 'Show a text' },
          { value: 'count_up', label: 'Count the time since' },
        ]),
        { name: 'text', selector: { text: {} } },
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
        { name: 'active_background', selector: { text: {} } },
        { name: 'style', selector: { text: { multiline: true } } },
      ],
    },
    {
      type: 'expandable',
      name: 'animation',
      title: 'Animation',
      icon: 'mdi:motion-outline',
      schema: [
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
                { value: 'active', label: 'While it runs' },
                { value: 'finishing', label: 'In the last minute' },
                { value: 'finished', label: 'Once it is over' },
                { value: 'always', label: 'Always' },
              ],
            },
          },
        },
        { name: 'duration', selector: { text: {} } },
        { name: 'intensity', selector: { number: { min: 0, max: 3, step: 0.1, mode: 'slider' } } },
      ],
    },
  ];
}

const FORM_KEYS = [
  'entity',
  'name',
  'icon',
  'colspan',
  'source',
  'progress',
  'inner',
  'thickness',
  'arc',
  'segments',
  'tiles',
  'rounded',
  'track',
  'gradient',
  'show_name',
  'show_icon',
  'name_size',
  'name_weight',
  'label_weight',
  'label',
  'format',
  'on_complete',
  'tap_action',
  'hold_action',
  'double_tap_action',
  'active_color',
  'background',
  'active_background',
  'style',
  'icon_size',
  'label_size',
  'icon_color',
  'active_when',
  'show_drawing',
  'animation',
] as const;

/** A shorthand (`source: timer`) as the mapping the form edits. */
function expand(value: unknown, key: string): Dict {
  if (value === undefined || value === null) return {};
  if (isDict(value)) return { ...value };
  return { [key]: value };
}

/** A time written as text shows in its field; one read from an entity stays YAML-only. */
const asText = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';

function withDefaults(item: Dict, config: Dict, type: string): Dict {
  return { ...((config.item as Dict) || {}), ...((config[type] as Dict) || {}), ...item };
}

export function progressEditor(type: ProgressItem['type'], label: string): ItemEditor {
  const DRAW_DEFAULTS: Dict = {
    inner: 'auto',
    thickness: type === 'ring' ? 10 : 4,
    arc: 360,
    segments: 10,
    tiles: true,
    rounded: true,
    track: true,
    gradient: false,
  };

  return {
    schema: () => schema(type),
    formKeys: FORM_KEYS,

    toForm(item: Dict, { config }: EditorContext): Dict {
      const effective = withDefaults(item, config, type);
      const progress = expand(item.progress, 'direction');
      const format = expand(item.format, 'style');
      return {
        entity: item.entity ?? '',
        name: item.name ?? '',
        icon: typeof item.icon === 'string' ? item.icon : '',
        colspan: item.colspan ?? 1,
        source: { type: 'auto', ...expand(item.source, 'type') },
        progress: {
          direction: 'remaining',
          ...progress,
          window: asText(progress.window),
          start: asText(progress.start),
          end: asText(progress.end),
        },
        inner: effective.inner ?? DRAW_DEFAULTS.inner,
        thickness: effective.thickness ?? DRAW_DEFAULTS.thickness,
        arc: effective.arc ?? DRAW_DEFAULTS.arc,
        segments: effective.segments ?? DRAW_DEFAULTS.segments,
        tiles: effective.tiles ?? DRAW_DEFAULTS.tiles,
        rounded: effective.rounded ?? DRAW_DEFAULTS.rounded,
        track: effective.track ?? DRAW_DEFAULTS.track,
        gradient: effective.gradient ?? DRAW_DEFAULTS.gradient,
        show_name: item.show_name ?? true,
        label: item.label ?? '',
        format_style: format.style ?? 'auto',
        show_seconds:
          format.show_seconds === true ? 'true' : format.show_seconds === false ? 'false' : 'auto',
        decimals: format.decimals ?? 0,
        on_complete: { action: 'show_zero', ...expand(item.on_complete, 'action') },
        tap_action: actionToForm(item.tap_action),
        hold_action: actionToForm(item.hold_action),
        double_tap_action: actionToForm(item.double_tap_action),
        confirm_tap: Boolean(confirmationFromConfig(item, 'tap')),
        confirm_hold: Boolean(confirmationFromConfig(item, 'hold')),
        confirm_double_tap: Boolean(confirmationFromConfig(item, 'double_tap')),
        active_color: item.active_color ?? '',
        background: item.background ?? '',
        active_background: item.active_background ?? '',
        style: item.style ?? '',
        ...cellToForm(item, withDefaults({}, config, type)),
        active_when: item.active_when ?? '',
        show_drawing: item.show_drawing ?? 'always',
        animation: {
          type: 'none',
          when: 'active',
          duration: '2s',
          intensity: 1,
          ...expand(item.animation, 'type'),
        },
      };
    },

    fromForm(value: Dict, previous: Dict, { config }: EditorContext): Dict {
      const inherited = withDefaults({}, config, type);
      const progress = { ...((value.progress as Dict) || {}) };
      const before = expand(previous.progress, 'direction');
      // A time read from an entity is not editable in a text field; an empty
      // field keeps it rather than dropping it.
      for (const key of ['window', 'start', 'end']) {
        if (!progress[key] && isDict(before[key])) progress[key] = before[key];
      }
      // Keys of `format` the form does not show (largest_units, show_days ...) stay.
      const format: Dict = {
        ...expand(previous.format, 'style'),
        style: value.format_style,
        show_seconds:
          value.show_seconds === 'true' ? true : value.show_seconds === 'false' ? false : 'auto',
        decimals: value.decimals,
      };

      const next = pruneDefaults(
        {
          entity: value.entity,
          name: value.name,
          icon: value.icon,
          colspan: value.colspan,
          source: value.source,
          progress,
          inner: value.inner,
          thickness: value.thickness,
          arc: value.arc,
          segments: value.segments,
          tiles: value.tiles,
          rounded: value.rounded,
          track: value.track,
          gradient: value.gradient,
          show_name: value.show_name,
          label: value.label,
          format,
          on_complete: value.on_complete,
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
          active_background: value.active_background,
          style: value.style,
          ...cellFromForm(value),
          active_when: value.active_when,
          show_drawing: value.show_drawing,
          animation: value.animation,
        },
        {
          colspan: 1,
          show_name: true,
          show_drawing: 'always',
          ...cellDefaults(inherited),
          source: { type: 'auto' },
          progress: { direction: 'remaining' },
          format: { style: 'auto', show_seconds: 'auto', decimals: 0 },
          on_complete: { action: 'show_zero' },
          animation: { type: 'none', when: 'active', duration: '2s', intensity: 1 },
          ...DRAW_DEFAULTS,
          // What the card or a type block already sets is not repeated.
          ...Object.fromEntries(
            Object.keys(DRAW_DEFAULTS)
              .filter((key) => inherited[key] !== undefined)
              .map((key) => [key, inherited[key]]),
          ),
        },
      );
      // Options only this type's form hides - another type's, kept by the
      // editor while it is open - never reach here; a state map for the icon
      // does, and is kept.
      if (previous.icon && typeof previous.icon === 'object' && !value.icon)
        next.icon = previous.icon;
      return next;
    },

    create: () => ({}),
    fallbackName: (index) => `${label} ${index + 1}`,
  };
}
