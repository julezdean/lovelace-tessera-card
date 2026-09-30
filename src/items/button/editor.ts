import { DEFAULT_ANIMATION } from '../../core/animation';
import {
  ACTIONS_SECTION,
  ACTIVE_WHEN_FIELD,
  ANIMATION_SCHEMA,
  LAYOUT_SELECT,
  SIZE_FIELDS,
} from '../../editor/schema';
import {
  actionFromForm,
  actionToForm,
  confirmationFromConfig,
  pruneDefaults,
  triStateFromForm,
  triStateToForm,
} from '../../editor/transform';
import type { Dict } from '../../types';
import { toNumber } from '../../utils';
import type { EditorContext, ItemEditor } from '../item-type';

/** One button's options, shown on its own page. */
const BUTTON_SCHEMA = [
  { name: 'entity', selector: { entity: {} } },
  { name: 'name', selector: { text: {} } },
  { name: 'icon', selector: { icon: {} } },
  { name: 'colspan', selector: { number: { min: 1, max: 6, mode: 'box' } } },
  ACTIVE_WHEN_FIELD,
  ACTIONS_SECTION,
  {
    type: 'expandable',
    name: '',
    title: 'Display',
    icon: 'mdi:text-short',
    schema: [
      LAYOUT_SELECT,
      { name: 'show_name', selector: { boolean: {} } },
      {
        name: 'show_state',
        selector: {
          select: {
            mode: 'dropdown',
            options: [
              { value: 'auto', label: 'Automatic' },
              { value: 'true', label: 'Always' },
              { value: 'false', label: 'Never' },
            ],
          },
        },
      },
      { name: 'label', selector: { text: {} } },
      { name: 'state_display', selector: { text: {} } },
      ...SIZE_FIELDS,
    ],
  },
  {
    type: 'expandable',
    name: '',
    title: 'Colours',
    icon: 'mdi:palette-outline',
    schema: [
      // Per button, overriding the card-wide defaults. All of these accept a
      // template, which the form passes through as text.
      { name: 'active_color', selector: { text: {} } },
      { name: 'icon_color', selector: { text: {} } },
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
    schema: ANIMATION_SCHEMA,
  },
];

/** The per-button keys the button form is responsible for. */
export const BUTTON_FORM_KEYS = [
  'entity',
  'name',
  'icon',
  'colspan',
  'label',
  'state_display',
  'icon_size',
  'label_size',
  'icon_color',
  'active_color',
  'background',
  'active_background',
  'show_name',
  'show_state',
  'tap_action',
  'hold_action',
  'double_tap_action',
  'animation',
  'layout',
  'active_when',
] as const;

/**
 * What a button inherits from the card: its own defaults block, over the cell
 * defaults in `item:`. Only a genuine deviation from these is written out.
 */
function inherited(config: Dict): Dict {
  return { ...((config.item as Dict) || {}), ...((config.button as Dict) || {}) };
}

export const buttonEditor: ItemEditor = {
  schema: () => BUTTON_SCHEMA,
  formKeys: BUTTON_FORM_KEYS,

  toForm(button: Dict, { config }: EditorContext): Dict {
    const defaults = inherited(config);
    return {
      entity: button.entity ?? '',
      name: button.name ?? '',
      icon: typeof button.icon === 'string' ? button.icon : '',
      colspan: button.colspan ?? 1,
      label: button.label ?? '',
      state_display: button.state_display ?? '',
      icon_size: toNumber(button.icon_size ?? defaults.icon_size, undefined),
      label_size: toNumber(button.label_size ?? defaults.label_size, undefined),
      icon_color: button.icon_color ?? '',
      active_color: button.active_color ?? '',
      background: button.background ?? '',
      active_background: button.active_background ?? '',
      style: button.style ?? '',
      active_when: button.active_when ?? '',
      layout: button.layout ?? defaults.layout ?? 'vertical',
      show_name: button.show_name ?? true,
      show_state: triStateToForm(button.show_state),
      tap_action: actionToForm(button.tap_action),
      hold_action: actionToForm(button.hold_action),
      double_tap_action: actionToForm(button.double_tap_action),
      confirm_tap: Boolean(confirmationFromConfig(button, 'tap')),
      confirm_hold: Boolean(confirmationFromConfig(button, 'hold')),
      confirm_double_tap: Boolean(confirmationFromConfig(button, 'double_tap')),
      animation: {
        ...DEFAULT_ANIMATION,
        ...((config.animation as Dict) || {}),
        ...((button.animation as Dict) || {}),
      },
    };
  },

  fromForm(value: Dict, previous: Dict, { config }: EditorContext): Dict {
    const defaults = inherited(config);
    const next = pruneDefaults(
      {
        entity: value.entity,
        name: value.name,
        icon: value.icon,
        colspan: value.colspan,
        label: value.label,
        state_display: value.state_display,
        icon_size: value.icon_size,
        label_size: value.label_size,
        icon_color: value.icon_color,
        active_color: value.active_color,
        background: value.background,
        active_background: value.active_background,
        style: value.style,
        active_when: value.active_when,
        layout: value.layout,
        show_name: value.show_name,
        show_state: triStateFromForm(value.show_state),
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
        animation: value.animation,
      },
      {
        colspan: 1,
        show_name: true,
        show_state: 'auto',
        layout: defaults.layout ?? 'vertical',
        icon_size: toNumber(defaults.icon_size, undefined),
        label_size: toNumber(defaults.label_size, undefined),
        icon_color: defaults.icon_color,
        active_color: defaults.active_color,
        // Inherited from the card, so only a genuine deviation is written out.
        animation: { ...DEFAULT_ANIMATION, ...((config.animation as Dict) || {}) },
      },
    );

    // An icon given as a state map is not editable in the form; keep it rather
    // than letting the text field overwrite it with a blank.
    if (previous.icon && typeof previous.icon === 'object' && !value.icon) {
      next.icon = previous.icon;
    }
    return next;
  },

  create: (index) => ({ name: `Button ${index + 1}` }),
  fallbackName: (index) => `Button ${index + 1}`,
};
