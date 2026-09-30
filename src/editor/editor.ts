import { CARD_TAG } from '../const';
import { DEFAULT_LAYOUT } from '../core/layout';
import { hasTemplate } from '../core/templates';
import { normalizeVisibility } from '../core/visibility';
import { resolveName } from '../items/button/button';
import type { ItemType } from '../items/item-type';
import { DEFAULT_TYPE, getItemType, itemTypes } from '../items/registry';
import type { Dict, HomeAssistant } from '../types';
import { CONDITIONS_TAG, ensureConditionsEditor, ensureYamlEditor, YAML_TAG } from './loaders';
import { ANIMATION_SCHEMA, LABELS, LAYOUT_SELECT, PRESS_EFFECT_SELECT, select } from './schema';
import { EDITOR_STYLES } from './styles';
import { cardFormData, cardFormToConfig } from './card-form';
import { mergeOwnedKeys } from './transform';

/**
 * The editor is built from ha-form, which Home Assistant renders from a
 * declarative schema. ha-form has no concept of a list, and this card's whole
 * point is a list of items - so the items get their own list UI, and each
 * item opens a sub-page with the form its type provides.
 *
 * Two rules keep this from fighting itself:
 *
 *   1. ha-form is created once per page and then only fed new `.data`.
 *      Rebuilding it on every keystroke would take the focus out of the field
 *      being typed into.
 *   2. What goes back into the config is pruned of anything equal to a default,
 *      so using the editor does not bloat the YAML with every option.
 */

const BaseElement = (
  typeof HTMLElement !== 'undefined' ? HTMLElement : class {}
) as typeof HTMLElement;

/**
 * Card-level options. The items are handled by the list below the form.
 *
 * The layout section depends on the mode, because `columns` does nothing in
 * `auto` and `max_columns` does nothing in `grid`. Showing a control that
 * cannot take effect is worse than showing none.
 */
const cardSchema = (mode: string) => [
  { name: 'title', selector: { text: {} } },
  {
    type: 'expandable',
    name: 'layout',
    title: 'Layout',
    icon: 'mdi:view-grid-outline',
    schema: [
      select('mode', [
        { value: 'auto', label: 'Automatic' },
        { value: 'grid', label: 'Fixed column count' },
      ]),
      ...(mode === 'grid'
        ? [{ name: 'columns', selector: { number: { min: 1, max: 12, mode: 'box' } } }]
        : [
            { name: 'column_width', selector: { number: { min: 80, max: 400, mode: 'box' } } },
            { name: 'max_columns', selector: { number: { min: 1, max: 12, mode: 'box' } } },
          ]),
      { name: 'gap', selector: { number: { min: 0, max: 48, mode: 'box' } } },
      { name: 'min_button_size', selector: { number: { min: 48, max: 200, mode: 'box' } } },
      { name: 'max_button_size', selector: { number: { min: 60, max: 400, mode: 'box' } } },
    ],
  },
  {
    type: 'expandable',
    name: 'appearance',
    title: 'Card appearance',
    icon: 'mdi:palette-outline',
    schema: [
      { name: 'background', selector: { text: {} } },
      { name: 'radius', selector: { number: { min: 0, max: 60, mode: 'box' } } },
      { name: 'padding', selector: { number: { min: 0, max: 48, mode: 'box' } } },
      { name: 'shadow', selector: { boolean: {} } },
    ],
  },
  {
    // The cell every item sits in, whatever its type.
    type: 'expandable',
    name: 'item',
    title: 'Item defaults',
    icon: 'mdi:view-dashboard-outline',
    schema: [
      { name: 'radius', selector: { number: { min: 0, max: 60, mode: 'box' } } },
      { name: 'label_size', selector: { number: { min: 8, max: 32, mode: 'slider' } } },
      { name: 'icon_size', selector: { number: { min: 12, max: 96, mode: 'slider' } } },
      { name: 'icon_color', selector: { text: {} } },
      { name: 'active_color', selector: { text: {} } },
      { name: 'show_name', selector: { boolean: {} } },
      PRESS_EFFECT_SELECT,
      // Only buttons arrange icon and text either way; it is stored under
      // `button:`, but belongs with the rest of how an item looks.
      { ...LAYOUT_SELECT, name: 'button_layout' },
    ],
  },
  {
    type: 'expandable',
    name: 'animation',
    title: 'Animation defaults',
    icon: 'mdi:motion-outline',
    schema: ANIMATION_SCHEMA,
  },
];

/**
 * What every type reads, whatever it is: the item itself and its cell. These
 * survive a type switch; a type's own options survive only if the new type
 * has them too.
 */
const SHARED_KEYS = [
  'entity',
  'name',
  'icon',
  'label',
  'show_name',
  'colspan',
  'size',
  'visibility',
  'conditions',
  'tap_action',
  'hold_action',
  'double_tap_action',
  'style',
  'radius',
  'background',
  'active_background',
  'color',
  'active_color',
  'label_size',
  'press_effect',
  'attribute',
  'active_when',
];

function typeOf(item: Dict): ItemType | undefined {
  return getItemType(item.type === undefined ? DEFAULT_TYPE : String(item.type));
}

type EditorConfig = Dict & { items: Dict[] };

export class TesseraCardEditor extends BaseElement {
  private _config: EditorConfig | null = null;
  private _hass: HomeAssistant | null = null;
  /** null = the card page, a number = that item's page. */
  private _openItem: number | null = null;
  /** Whether the open item page shows YAML instead of the form. */
  private _yamlMode = false;
  /** Whether the type chooser under "+ Add item" is open. */
  private _choosing = false;
  private _form: (HTMLElement & { data?: unknown; hass?: unknown }) | null = null;
  private _renderedPage: string | undefined;
  /**
   * Per item, the options a type switch set aside: switching a ring to a bar
   * and back must not lose what only the ring had. Kept while the editor is
   * open - the saved config carries only what the current type reads.
   */
  private _stash = new Map<number, Dict>();
  /** The mounted conditions editor, kept in step with the config. */
  private _conditionsEditor: (HTMLElement & { conditions?: unknown; hass?: unknown }) | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  setConfig(config: Dict): void {
    const items = config.items;
    this._config = { ...config, items: Array.isArray(items) ? (items as Dict[]) : [] };
    // An item that no longer exists must not keep a page open.
    if (this._openItem !== null && !this._config.items[this._openItem]) {
      this._openItem = null;
    }
    this._render();
  }

  /** Lovelace assigns hass after setConfig, so this has to trigger a render. */
  set hass(hass: HomeAssistant) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
    this._render();
  }

  get hass(): HomeAssistant | null {
    return this._hass;
  }

  /* --- rendering ------------------------------------------------------- */

  private _render(): void {
    if (!this._config || !this._hass) return;

    const page =
      this._openItem === null
        ? `card:${this._layoutMode()}:${this._choosing ? 'choose' : 'list'}`
        : `item:${this._openItem}:${this._openType()}:${this._yamlMode ? 'yaml' : 'form'}`;
    if (page !== this._renderedPage) {
      this._renderedPage = page;
      this._buildPage();
      return;
    }
    // Same page: only refresh the data, so typing keeps the focus.
    this._updateFormData();
  }

  private _buildPage(): void {
    const root = this.shadowRoot as ShadowRoot;
    root.textContent = '';
    this._form = null;
    this._conditionsEditor = null;

    const style = document.createElement('style');
    style.textContent = EDITOR_STYLES;
    root.appendChild(style);

    if (this._openItem === null) this._buildCardPage(root);
    else this._buildItemPage(root);
  }

  private _layoutMode(): string {
    const mode =
      ((this._config as EditorConfig).layout as Dict | undefined)?.mode || DEFAULT_LAYOUT.mode;
    return String(mode);
  }

  private _buildCardPage(root: ShadowRoot): void {
    this._form = this._createForm(cardSchema(this._layoutMode()), this._cardFormData(), (value) =>
      this._cardFormChanged(value),
    );
    root.appendChild(this._form);
    root.appendChild(this._buildItemList());
  }

  private _buildItemList(): HTMLElement {
    const config = this._config as EditorConfig;
    const wrap = document.createElement('div');
    wrap.className = 'list';

    const heading = document.createElement('div');
    heading.className = 'heading';
    heading.textContent = 'Items';
    wrap.appendChild(heading);

    config.items.forEach((item, index) => {
      wrap.appendChild(this._buildItemRow(item, index));
    });

    const add = document.createElement('button');
    add.className = 'add';
    add.type = 'button';
    add.textContent = '+ Add item';
    add.addEventListener('click', () => this._onAdd());
    wrap.appendChild(add);

    if (this._choosing) wrap.appendChild(this._buildTypeChooser());

    if (config.items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'This card needs at least one item.';
      wrap.insertBefore(empty, add);
    }

    return wrap;
  }

  /** One choice per item type, shown under "+ Add item". */
  private _buildTypeChooser(): HTMLElement {
    const chooser = document.createElement('div');
    chooser.className = 'chooser';
    itemTypes().forEach((itemType) => {
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.className = 'choice';
      const icon = document.createElement('ha-icon') as HTMLElement & { icon?: string };
      icon.icon = itemType.icon;
      const label = document.createElement('span');
      label.textContent = itemType.label;
      choice.append(icon, label);
      choice.addEventListener('click', () => this._addItem(itemType));
      chooser.appendChild(choice);
    });
    return chooser;
  }

  private _buildItemRow(item: Dict, index: number): HTMLElement {
    const config = this._config as EditorConfig;
    const itemType = typeOf(item);
    const row = document.createElement('div');
    row.className = 'row';

    const icon = document.createElement('ha-icon') as HTMLElement & { icon?: string };
    icon.className = 'row-icon';
    icon.icon =
      typeof item.icon === 'string'
        ? item.icon
        : itemType
          ? itemType.icon
          : 'mdi:help-circle-outline';

    const label = document.createElement('button');
    label.className = 'row-label';
    label.type = 'button';
    const entity = typeof item.entity === 'string' ? item.entity : null;
    const stateObj = entity && this._hass ? this._hass.states[entity] : undefined;
    const primary = document.createElement('span');
    primary.className = 'row-name';
    primary.textContent =
      (item.name as string) ||
      resolveName({ name: null, entity }, stateObj) ||
      (itemType ? itemType.editor.fallbackName(index) : `Item ${index + 1}`);
    const secondary = document.createElement('span');
    secondary.className = 'row-entity';
    secondary.textContent = [
      // With more than one kind of item, the list says which is which.
      itemTypes().length > 1 && itemType ? itemType.label : null,
      entity || 'no entity',
    ]
      .filter(Boolean)
      .join(' · ');
    label.append(primary, secondary);
    label.addEventListener('click', () => {
      this._openItem = index;
      this._render();
    });

    const actions = document.createElement('div');
    actions.className = 'row-actions';
    actions.append(
      this._iconButton('mdi:arrow-up', 'Move up', () => this._moveItem(index, -1), index === 0),
      this._iconButton(
        'mdi:arrow-down',
        'Move down',
        () => this._moveItem(index, 1),
        index === config.items.length - 1,
      ),
      this._iconButton('mdi:delete-outline', 'Delete', () => this._deleteItem(index)),
    );

    row.append(icon, label, actions);
    return row;
  }

  private _iconButton(
    icon: string,
    label: string,
    onClick: () => void,
    disabled = false,
  ): HTMLElement {
    const el = document.createElement('ha-icon-button');
    el.setAttribute('label', label);
    el.title = label;
    if (disabled) el.setAttribute('disabled', '');
    const inner = document.createElement('ha-icon') as HTMLElement & { icon?: string };
    inner.icon = icon;
    el.appendChild(inner);
    if (!disabled) el.addEventListener('click', onClick);
    return el;
  }

  private _buildItemPage(root: ShadowRoot): void {
    const config = this._config as EditorConfig;
    const index = this._openItem as number;
    const item = config.items[index] || {};
    const itemType = typeOf(item);

    const header = document.createElement('div');
    header.className = 'header';

    const back = this._iconButton('mdi:arrow-left', 'Back', () => {
      this._openItem = null;
      this._yamlMode = false;
      this._render();
    });
    const title = document.createElement('div');
    title.className = 'header-title';
    const label = typeof item.name === 'string' && !hasTemplate(item.name) ? item.name : null;
    title.textContent =
      label ||
      (item.entity as string) ||
      (itemType ? itemType.editor.fallbackName(index) : `Item ${index + 1}`);

    // Same affordance as everywhere else in Lovelace: {} swaps the form for
    // the raw YAML of this one item.
    const yamlToggle = this._iconButton(
      this._yamlMode ? 'mdi:format-list-bulleted' : 'mdi:code-braces',
      this._yamlMode ? 'Edit with the form' : 'Edit as YAML',
      () => {
        this._yamlMode = !this._yamlMode;
        this._render();
      },
    );
    yamlToggle.classList.add('yaml-toggle');

    header.append(back, title, yamlToggle);
    root.appendChild(header);

    // The type decides which options the page shows, so it comes first.
    if (itemTypes().length > 1 && !this._yamlMode) {
      const typeForm = this._createForm(
        [
          {
            name: 'type',
            selector: {
              select: {
                mode: 'dropdown',
                options: itemTypes().map((option) => ({ value: option.type, label: option.label })),
              },
            },
          },
        ],
        { type: itemType ? itemType.type : String(item.type) },
        (value) => {
          if (typeof value.type === 'string') this._switchType(index, value.type);
        },
      );
      typeForm.classList.add('type-form');
      root.appendChild(typeForm);
    }

    // An item of a type this version does not know has no form - only its
    // YAML, which is kept as written.
    if (this._yamlMode || !itemType) {
      if (!itemType && !this._yamlMode) {
        const note = document.createElement('div');
        note.className = 'note';
        note.textContent = `Unknown item type "${String(item.type)}". It can be edited as YAML.`;
        root.appendChild(note);
        return;
      }
      this._buildItemYaml(root, index, item);
      return;
    }

    this._form = this._createForm(
      itemType.editor.schema({ config }),
      itemType.editor.toForm(item, { config }),
      (value) => this._itemFormChanged(value),
    );
    root.appendChild(this._form);

    // Visibility uses Home Assistant's own conditions editor, which has to be
    // loaded first. Until it is there - or if it never arrives - the slot
    // carries a note saying the conditions are editable in YAML.
    const slot = document.createElement('div');
    slot.className = 'conditions';
    const heading = document.createElement('div');
    heading.className = 'heading';
    heading.textContent = 'Visibility';
    slot.append(heading, this._conditionsNote(item));
    root.appendChild(slot);

    this._mountConditionsEditor(slot, index);
  }

  /**
   * The whole item as YAML. Everything is editable here, including what the
   * form cannot express - and it is the only place to reach a state-keyed icon
   * map or a template without leaving the UI.
   */
  private _buildItemYaml(root: ShadowRoot, index: number, item: Dict): void {
    const slot = document.createElement('div');
    slot.className = 'yaml';
    const note = document.createElement('div');
    note.className = 'note';
    note.textContent = 'Loading the YAML editor…';
    slot.appendChild(note);
    root.appendChild(slot);

    ensureYamlEditor().then((available) => {
      if (!slot.isConnected || this._openItem !== index || !this._yamlMode) return;
      if (!available) {
        note.textContent =
          "The YAML editor could not be loaded. Use the card's own YAML editor instead.";
        return;
      }

      const editor = document.createElement(YAML_TAG) as HTMLElement & {
        hass?: unknown;
        defaultValue?: unknown;
      };
      editor.hass = this._hass;
      editor.defaultValue = item;
      editor.addEventListener('value-changed', (event) => {
        event.stopPropagation();
        const { value, isValid } = ((event as CustomEvent).detail || {}) as Dict;
        // Invalid YAML is reported by the editor itself; writing it back
        // would replace the item with nonsense mid-typing.
        if (isValid === false || !value || typeof value !== 'object') return;
        const items = [...(this._config as EditorConfig).items];
        items[index] = value as Dict;
        this._commit({ ...(this._config as EditorConfig), items });
      });
      slot.replaceChildren(editor);
    });
  }

  /** The fallback, and what is shown while the real editor loads. */
  private _conditionsNote(item: Dict): HTMLElement {
    const conditions = normalizeVisibility(item.visibility ?? item.conditions);
    const note = document.createElement('div');
    note.className = 'note';
    note.textContent =
      conditions.length > 0
        ? `${conditions.length} condition${conditions.length === 1 ? '' : 's'} set, kept as ` +
          'written. They can be edited in YAML.'
        : 'Always visible. Conditions can be added in YAML (visibility:).';
    return note;
  }

  private async _mountConditionsEditor(slot: HTMLElement, index: number): Promise<void> {
    const available = await ensureConditionsEditor();
    // The page may have changed while we waited.
    if (!available || !slot.isConnected || this._openItem !== index) return;

    const item = (this._config as EditorConfig).items[index];
    if (!item) return;

    const editor = document.createElement(CONDITIONS_TAG) as HTMLElement & {
      hass?: unknown;
      conditions?: unknown;
    };
    editor.hass = this._hass;
    editor.conditions = normalizeVisibility(item.visibility ?? item.conditions);
    editor.addEventListener('value-changed', (event) => {
      event.stopPropagation();
      // Accept either shape rather than betting on one.
      const detail = ((event as CustomEvent).detail || {}) as Dict;
      const next = Array.isArray(detail.value)
        ? detail.value
        : Array.isArray(detail.conditions)
          ? detail.conditions
          : null;
      if (!next) return;
      // Home Assistant's conditions editor is controlled: it announces the
      // new list and waits to be handed it back - only then does it show,
      // and open, a condition just added. Not handing it back is what made
      // "Entity state" appear to do nothing while it did reach the YAML.
      editor.conditions = next;
      this._conditionsChanged(index, next);
    });
    this._conditionsEditor = editor;

    slot.replaceChildren(
      Object.assign(document.createElement('div'), {
        className: 'heading',
        textContent: 'Visibility',
      }),
      editor,
    );
  }

  private _conditionsChanged(index: number, conditions: unknown[]): void {
    const items = [...(this._config as EditorConfig).items];
    const next = { ...items[index] };
    // An empty list is the absence of conditions, not a condition of its own.
    if (conditions.length > 0) next.visibility = conditions;
    else delete next.visibility;
    delete next.conditions; // never keep both spellings
    items[index] = next;
    this._commit({ ...(this._config as EditorConfig), items });
  }

  private _createForm(
    schema: unknown[],
    data: Dict,
    onChange: (value: Dict) => void,
  ): HTMLElement & { data?: unknown; hass?: unknown } {
    const form = document.createElement('ha-form') as HTMLElement & {
      computeLabel?: (item: Dict) => string;
      hass?: unknown;
      schema?: unknown;
      data?: unknown;
    };
    // computeLabel first: assigning data is what triggers the first render, and
    // a form rendered before it would show raw config keys as labels.
    form.computeLabel = (item) =>
      LABELS[item.name as string] || (item.title as string) || (item.name as string);
    form.hass = this._hass;
    form.schema = schema;
    form.data = data;
    form.addEventListener('value-changed', (event) => {
      event.stopPropagation();
      onChange((event as CustomEvent).detail.value as Dict);
    });
    return form;
  }

  private _updateFormData(): void {
    if (!this._form) return;
    const config = this._config as EditorConfig;
    if (this._openItem === null) {
      this._form.data = this._cardFormData();
      return;
    }
    const item = config.items[this._openItem] || {};
    const itemType = typeOf(item);
    if (itemType) this._form.data = itemType.editor.toForm(item, { config });
    // Conditions edited elsewhere - the card's own YAML - reach it too.
    const editor = this._conditionsEditor;
    if (editor && editor.isConnected) {
      const conditions = normalizeVisibility(item.visibility ?? item.conditions);
      if (JSON.stringify(conditions) !== JSON.stringify(editor.conditions)) {
        editor.conditions = conditions;
      }
    }
  }

  /* --- data in and out -------------------------------------------------- */

  private _cardFormData(): Dict {
    return cardFormData(this._config as EditorConfig);
  }

  private _cardFormChanged(value: Dict): void {
    this._commit(cardFormToConfig(this._config as EditorConfig, value) as EditorConfig);
  }

  private _itemFormChanged(value: Dict): void {
    const config = this._config as EditorConfig;
    const index = this._openItem as number;
    const previous = config.items[index] || {};
    const itemType = typeOf(previous);
    if (!itemType) return;

    const next = itemType.editor.fromForm(value, previous, { config });
    // Anything the form does not model - visibility conditions above all -
    // is carried through by mergeOwnedKeys rather than listed here.
    const items = [...config.items];
    items[index] = mergeOwnedKeys(previous, itemType.editor.formKeys, next);
    this._commit({ ...config, items });
  }

  /* --- list operations -------------------------------------------------- */

  /** With a single type there is nothing to choose, so the item is added straight away. */
  private _onAdd(): void {
    const types = itemTypes();
    if (types.length === 1) {
      this._addItem(types[0]);
      return;
    }
    this._choosing = !this._choosing;
    this._render();
  }

  private _openType(): string {
    const item = (this._config as EditorConfig).items[this._openItem as number] || {};
    return item.type === undefined ? DEFAULT_TYPE : String(item.type);
  }

  /**
   * Another type for an existing item. What both types read - the entity,
   * the name, the actions, the cell - carries over; what only the old one
   * reads is set aside, and comes back if the item is switched back.
   */
  private _switchType(index: number, typeName: string): void {
    const config = this._config as EditorConfig;
    const previous = config.items[index] || {};
    const target = getItemType(typeName);
    if (!target || this._openType() === typeName) return;

    const keep = new Set<string>([...SHARED_KEYS, ...target.editor.formKeys]);
    const stash = { ...(this._stash.get(index) || {}) };
    const next: Dict = typeName === DEFAULT_TYPE ? {} : { type: typeName };
    Object.entries(previous).forEach(([key, value]) => {
      if (key === 'type') return;
      if (keep.has(key)) next[key] = value;
      else stash[key] = value;
    });
    Object.entries(stash).forEach(([key, value]) => {
      if (keep.has(key) && next[key] === undefined) {
        next[key] = value;
        delete stash[key];
      }
    });
    this._stash.set(index, stash);

    const items = [...config.items];
    items[index] = next;
    this._commit({ ...config, items });
    this._render();
  }

  private _addItem(itemType: ItemType): void {
    const config = this._config as EditorConfig;
    const created = itemType.editor.create(config.items.length);
    // A button is what an item without `type:` is, so it is not spelled out.
    const item = itemType.type === DEFAULT_TYPE ? created : { type: itemType.type, ...created };
    const items = [...config.items, item];
    this._choosing = false;
    this._commit({ ...config, items });
    this._openItem = items.length - 1;
    this._render();
  }

  private _deleteItem(index: number): void {
    const config = this._config as EditorConfig;
    const items = config.items.filter((_, i) => i !== index);
    // Set-aside options belong to positions, and positions just moved.
    this._stash.clear();
    this._commit({ ...config, items });
    this._renderedPage = undefined; // the list changed, rebuild it
    this._render();
  }

  private _moveItem(index: number, delta: number): void {
    const config = this._config as EditorConfig;
    const target = index + delta;
    if (target < 0 || target >= config.items.length) return;
    const items = [...config.items];
    [items[index], items[target]] = [items[target], items[index]];
    this._stash.clear();
    this._commit({ ...config, items });
    this._renderedPage = undefined;
    this._render();
  }

  /* --- output ----------------------------------------------------------- */

  private _commit(config: EditorConfig): void {
    const next = { type: `custom:${CARD_TAG}`, ...config };
    this._config = next;
    this.dispatchEvent(
      new CustomEvent('config-changed', {
        bubbles: true,
        composed: true,
        detail: { config: next },
      }),
    );
  }
}
