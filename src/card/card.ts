import { normalizeConfig } from '../config';
import {
  CARD_TAG,
  CONFIRM_TEXT,
  CONFIRM_TIMEOUT_MS,
  DOUBLE_TAP_WINDOW_MS,
  EDITOR_TAG,
  HA_SECTION_WIDTH,
  HOLD_DELAY_MS,
  PRESS_FLASH_MS,
} from '../const';
import { haptic, performAction } from '../core/actions';
import { activeWhen } from '../core/active';
import { actionFor, confirmStep } from '../core/confirm';
import {
  computeCellHeight,
  computeColumns,
  computeContentHeight,
  computeGridOptions,
  DEFAULT_LAYOUT,
  isStrictGrid,
  partitionRows,
} from '../core/layout';
import { isActiveState, isStateless, isUnavailable } from '../core/state';
import { identity, renderTemplate, templateContext } from '../core/templates';
import { collectMediaQueries, isVisible } from '../core/visibility';
import { sharedTicker } from '../progress/ticker';
import type { CellGeometry, CellParts, ItemType, SyncContext } from '../items/item-type';
import { getItemType, itemTypes } from '../items/registry';
import type { CardConfig, Dict, Gesture, HassEntity, HomeAssistant, ItemBase } from '../types';
import { clamp, cssLength, domainOf, escapeHtml, toNumber } from '../utils';
import { CARD_STYLES, CARD_STYLES_TAIL } from './styles';

/** Importable outside a browser (for tests) without dragging in a DOM shim. */
const BaseElement = (
  typeof HTMLElement !== 'undefined' ? HTMLElement : class {}
) as typeof HTMLElement;

/** One stylesheet for the card, with every type's rules between cell and tail. */
const STYLES =
  CARD_STYLES +
  itemTypes()
    .map((itemType) => itemType.styles)
    .join('\n') +
  CARD_STYLES_TAIL;

/**
 * The room a tall drawing - a ring, digits - gets in place of the icon: what
 * the cell has left once its padding, the gap and one line each of name and
 * state are taken. Never smaller than the icon it replaces, and never so large
 * that a cell becomes all ring.
 */
export function computeVisualSize(cellHeight: number, iconSize: number, labelSize: number): number {
  const padding = 20; // .btn padding, top and bottom
  const gap = 8; // .btn gap between icon and labels
  const name = labelSize * 1.2;
  const state = (labelSize - 2) * 1.2 + 2; // line plus the labels' gap
  const room = cellHeight - padding - gap - name - state;
  return Math.round(clamp(room, iconSize, cellHeight * 0.62));
}

interface Cell {
  parts: CellParts;
  /** Absent for an item of an unknown type, which renders as an empty cell. */
  itemType: ItemType | undefined;
}

interface GestureState {
  index: number;
  holdTimer: number | null;
  tapTimer: number | null;
  held: boolean;
  pointerId: number | null;
  startX: number;
  startY: number;
  lastPointerUp: number;
}

interface MediaQueryEntry {
  matches: boolean;
  list: MediaQueryList;
  onChange: () => void;
}

export class TesseraCard extends BaseElement {
  private _hass: HomeAssistant | null = null;
  private _config: CardConfig | null = null;
  private _configError: string | null = null;

  private _cells: Cell[] = [];
  /** Per-item render signature; a hass update that changes nothing writes nothing. */
  private _signatures: Array<string | null> = [];

  private _gridEl: HTMLElement | null = null;
  private _rowEls: HTMLElement[] | null = null;
  private _rowGroups: number[][] | null = null;

  private _lastWidth = 0;
  private _lastColumns = 0;
  private _lastCellHeight = 0;
  private _lastVisibleKey: string | undefined;
  private _resizeObserver: ResizeObserver | null = null;

  /** Indices of the items currently visible, in order. */
  private _visible: number[] | null = null;
  /** media query string -> MediaQueryList, watched while connected. */
  private _mediaQueries = new Map<string, MediaQueryEntry>();
  private _matchMedia = (query: string): boolean => {
    const entry = this._mediaQueries.get(query);
    return entry ? entry.matches : false;
  };

  private _gestures = new Map<HTMLElement, GestureState>();
  private _armedIndex = -1;
  private _armedKind: Gesture | null = null;
  private _armedTimer: number | null = null;

  /** Per item: last seen state of a stateless entity, and its flash. */
  private _lastStateless: Array<string | undefined> = [];
  private _flashUntil: number[] = [];
  private _flashTimers: Array<number | null> = [];

  /** Per item, what its type's subscription delivered, and how to stop it. */
  private _data: unknown[] = [];
  private _subscriptions: Array<() => void> = [];
  /** Per item, a timer for a view that changes by itself, slower than a tick. */
  private _refreshTimers = new Map<number, { at: number; timer: number }>();

  /** Items subscribed to the shared clock, by index. */
  private _ticks = new Map<number, { phase: number; stop: () => void }>();
  /** The last layout pass's measurements, which some types draw with. */
  private _geometry: CellGeometry = {
    columnWidth: 0,
    trackWidth: 0,
    cellHeight: 0,
    visualSize: 0,
    columns: 1,
    gap: 0,
    iconSize: 30,
    labelSize: 14,
  };

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  /* --- Lovelace contract ------------------------------------------------ */

  /** Lovelace asks for this; without it the UI says "no visual editor". */
  static getConfigElement(): HTMLElement {
    return document.createElement(EDITOR_TAG);
  }

  static getStubConfig(): Dict {
    return {
      type: `custom:${CARD_TAG}`,
      items: [
        { name: 'Button 1', icon: 'mdi:lightbulb', tap_action: { action: 'none' } },
        { name: 'Button 2', icon: 'mdi:power', tap_action: { action: 'none' } },
      ],
    };
  }

  setConfig(config: unknown): void {
    try {
      this._config = normalizeConfig(config);
      this._configError = null;
    } catch (err) {
      this._config = null;
      this._configError = (err as Error).message || String(err);
    }

    this._signatures = [];
    this._clearFlashes();
    this._clearTicks();
    this._unsubscribe();
    this._lastWidth = 0;
    this._lastColumns = 0;
    this._build();
  }

  set hass(hass: HomeAssistant) {
    this._hass = hass;
    this._subscribe();
    this._sync();
  }

  get hass(): HomeAssistant | null {
    return this._hass;
  }

  /** Height in Lovelace's 50px units - used by the masonry view. */
  getCardSize(): number {
    if (!this._config) return 1;
    const width = this._lastWidth || HA_SECTION_WIDTH;
    return Math.max(1, Math.ceil(computeContentHeight(this._config, width) / 50));
  }

  /**
   * Sections view: how much of the grid the card asks for. HA calls
   * getGridOptions on recent versions and getLayoutOptions before that, so
   * both are provided from the same calculation.
   */
  getGridOptions(): { columns: number; rows: number; min_rows: number } {
    if (!this._config) return { columns: 12, rows: 3, min_rows: 2 };
    return computeGridOptions(this._config);
  }

  getLayoutOptions(): { grid_columns: number; grid_rows: number; grid_min_rows: number } {
    const { columns, rows, min_rows: minRows } = this.getGridOptions();
    return { grid_columns: columns, grid_rows: rows, grid_min_rows: minRows };
  }

  /* --- Lifecycle -------------------------------------------------------- */

  /**
   * A `screen` condition has to react to the viewport changing, or it would
   * only ever be evaluated once. One listener per distinct query, not one per
   * item, so a card repeating the same breakpoint costs nothing extra.
   */
  private _watchMediaQueries(): void {
    this._unwatchMediaQueries();
    if (!this._config || typeof window === 'undefined' || !window.matchMedia) return;

    const queries = new Set<string>();
    this._config.items.forEach((item) => collectMediaQueries(item.visibility, queries));

    queries.forEach((query) => {
      try {
        const list = window.matchMedia(query);
        const onChange = () => this._sync();
        if (list.addEventListener) list.addEventListener('change', onChange);
        else list.addListener(onChange); // older webviews
        this._mediaQueries.set(query, { matches: list.matches, list, onChange });
        // Keep the cached value fresh without re-querying on every sync.
        const refresh = () => {
          const entry = this._mediaQueries.get(query);
          if (entry) entry.matches = list.matches;
        };
        if (list.addEventListener) list.addEventListener('change', refresh);
        else list.addListener(refresh);
      } catch (err) {
        console.warn(`${CARD_TAG}: invalid media_query "${query}"`, err);
      }
    });
  }

  private _unwatchMediaQueries(): void {
    this._mediaQueries.forEach(({ list, onChange }) => {
      if (list.removeEventListener) list.removeEventListener('change', onChange);
      else if (list.removeListener) list.removeListener(onChange);
    });
    this._mediaQueries.clear();
  }

  connectedCallback(): void {
    this._watchMediaQueries();
    if (!this._resizeObserver && typeof ResizeObserver !== 'undefined') {
      // Width only. Observing height would feed the layout back into itself.
      this._resizeObserver = new ResizeObserver((entries) => {
        const width = entries[0] ? entries[0].contentRect.width : 0;
        this._onWidth(width);
      });
    }
    if (this._resizeObserver) this._resizeObserver.observe(this);
    // First measurement before the observer's initial callback arrives.
    this._onWidth(this.clientWidth);
    // Ticks and subscriptions stop while disconnected; a card moved in the
    // DOM starts them again.
    this._subscribe();
    if (this._hass) this._sync(true);
  }

  disconnectedCallback(): void {
    this._unwatchMediaQueries();
    if (this._resizeObserver) this._resizeObserver.disconnect();
    this._clearArmed();
    this._clearFlashes();
    this._clearTicks();
    this._unsubscribe();
    this._gestures.forEach((gesture) => this._cancelGesture(gesture));
    this._gestures.clear();
  }

  /* --- Build ------------------------------------------------------------ */

  private _build(): void {
    const root = this.shadowRoot as ShadowRoot;
    root.textContent = '';
    this._cells = [];
    this._gridEl = null;

    const style = document.createElement('style');
    style.textContent = STYLES;
    root.appendChild(style);

    if (this._configError) {
      const error = document.createElement('div');
      error.className = 'error';
      error.innerHTML = `<b>Tessera Card</b><br>${escapeHtml(this._configError)}`;
      root.appendChild(error);
      return;
    }
    if (!this._config) return;

    const { appearance, layout } = this._config;

    // A real ha-card: themes and card_mod address `ha-card`, so anything else
    // leaves this card out of whatever the dashboard has set up.
    const card = document.createElement('ha-card');
    card.className = 'card';
    // Only override what the configuration actually asked for; everything else
    // is left to the theme.
    if (appearance.background)
      card.style.setProperty('--ha-card-background', appearance.background);
    if (appearance.radius !== null && appearance.radius !== undefined) {
      card.style.setProperty('--ha-card-border-radius', cssLength(appearance.radius, '12px'));
    }
    if (appearance.shadow === false) card.style.setProperty('--ha-card-box-shadow', 'none');
    card.style.setProperty('--tsr-pad', cssLength(appearance.padding, '14px'));
    card.style.setProperty('--tsr-gap', cssLength(layout.gap, '12px'));

    if (this._config.title) {
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = this._config.title;
      card.appendChild(title);
    }

    const grid = document.createElement('div');
    grid.className = 'grid';
    this._gridEl = grid;
    card.appendChild(grid);
    root.appendChild(card);

    this._config.items.forEach((item, index) => {
      this._cells.push(this._buildCell(item, index));
    });

    this._lastColumns = 0; // force a layout pass
    this._applyLayout(this._lastWidth || this.clientWidth);
    this._subscribe();
    this._sync(true);
  }

  /**
   * The shell every item sits in. It is a <button> for every type: each item
   * is a touch target with the same gestures, and a stylesheet that addresses
   * `.btn` keeps working whatever the item shows.
   */
  private _buildCell(item: ItemBase, index: number): Cell {
    const el = document.createElement('button');
    el.className = 'btn';
    el.type = 'button';
    el.dataset.index = String(index);
    el.dataset.type = item.type;
    // Attributes that make a single item addressable from outside. card-mod
    // injects its styles into this shadow root (it targets the card element,
    // not an ha-card), so a selector like
    //   .btn[data-entity="binary_sensor.alle_fenster"] { ... }
    // reaches exactly one item. data-state and data-active are kept current
    // by the sync, so a rule can depend on them.
    if (item.entity) {
      el.dataset.entity = item.entity;
      el.dataset.domain = domainOf(item.entity);
    }
    el.setAttribute('role', 'button');

    if (item.press_effect && item.press_effect !== 'none') {
      el.classList.add(`effect-${item.press_effect}`);
    }
    el.style.setProperty('--tsr-btn-radius', cssLength(item.radius, '18px'));
    // Templated colours are applied per sync instead, since their value
    // depends on state that only exists at that point.
    if (!item.hasTemplates) this._applyColours(el, item);
    if (item.label_size)
      el.style.setProperty('--tsr-label-size', cssLength(item.label_size, '14px'));
    if (item.icon_size) el.style.setProperty('--tsr-icon-size', cssLength(item.icon_size, '30px'));

    const itemType = getItemType(item.type);
    let parts: CellParts;
    if (itemType) {
      parts = itemType.build(item, el);
    } else {
      // An unknown type costs its own cell, not the card: it shows as an
      // invalid cell, and says why in its state line.
      const state = document.createElement('div');
      state.className = 'state';
      el.appendChild(state);
      parts = { root: el, state };
    }

    this._gridEl?.appendChild(el); // the layout pass moves it into a row
    this._bindGestures(el, index);

    return { parts, itemType };
  }

  /**
   * An item's own CSS declarations. Not a full rule - there is no selector -
   * just what would go inside one: "border: 2px solid red; opacity: 0.5".
   *
   * Properties set on a previous pass are removed first, otherwise a template
   * that stops returning a border would leave the old one behind.
   */
  private _applyStyle(el: HTMLElement, css: unknown, parts: CellParts): void {
    (parts.styleProps || []).forEach((property) => el.style.removeProperty(property));
    parts.styleProps = [];
    if (!css || typeof css !== 'string') return;

    css.split(';').forEach((declaration) => {
      const colon = declaration.indexOf(':');
      if (colon < 0) return;
      const property = declaration.slice(0, colon).trim();
      const value = declaration.slice(colon + 1).trim();
      if (!property || !value) return;
      el.style.setProperty(property, value);
      parts.styleProps?.push(property);
    });
  }

  /** Colour overrides, from config or from a template's result. */
  private _applyColours(el: HTMLElement, colours: Dict | ItemBase): void {
    const set = (property: string, value: unknown) => {
      if (value === undefined || value === null || value === '') el.style.removeProperty(property);
      else el.style.setProperty(property, String(value));
    };
    // Written as the custom property the base rule reads, not as an inline
    // background. Inline wins over every rule, so setting it directly made a
    // configured background beat .btn.active - the button kept its resting
    // colour while switched on. As a property, the cascade decides, and the
    // more specific .btn.active rule takes precedence as it should.
    set('--tsr-btn-custom-bg', colours.background);
    set('--tsr-btn-active-bg', colours.active_background);
    set('--tsr-accent', colours.active_color);
    set('--tsr-icon-color', colours.icon_color);
  }

  /* --- Layout ----------------------------------------------------------- */

  private _onWidth(width: number): void {
    if (!this._config || !this._gridEl) return;
    // Sub-pixel churn must not trigger work.
    if (Math.abs(width - this._lastWidth) < 1) return;
    this._lastWidth = width;
    this._applyLayout(width);
  }

  private _applyLayout(outerWidth: number): void {
    if (!this._config || !this._gridEl) return;

    const { layout, appearance } = this._config;
    const padding = toNumber(appearance.padding, 14);
    const innerWidth = Math.max(0, (outerWidth || 0) - padding * 2 - 2);

    const items = this._config.items;
    const visible = this._visible || items.map((_, index) => index);
    const weights = visible.map((index) => items[index].weight);
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const columns = computeColumns(this._config, totalWeight, innerWidth);
    const cellHeight = computeCellHeight(this._config, columns, innerWidth);

    // Every item hidden: the card hides itself, the way a conditional card
    // does, rather than leaving an empty surface on the dashboard.
    this.classList.toggle('tsr-hidden', visible.length === 0);
    if (visible.length === 0) {
      this._gridEl.replaceChildren();
      this._rowEls = [];
      this._rowGroups = [];
      return;
    }

    // Nothing changed -> no DOM writes at all.
    if (columns === this._lastColumns && cellHeight === this._lastCellHeight) return;
    this._lastColumns = columns;
    this._lastCellHeight = cellHeight;

    const strict = isStrictGrid(layout);
    const rows = partitionRows(weights, columns, strict);

    this._gridEl.style.setProperty('--tsr-gap', cssLength(layout.gap, '12px'));
    this._gridEl.style.setProperty('--tsr-cell-h', `${cellHeight}px`);
    this._gridEl.style.setProperty(
      '--tsr-row-min',
      `${toNumber(layout.min_button_size, DEFAULT_LAYOUT.min_button_size as number)}px`,
    );
    // Icon and label scale with the cell, within sane bounds.
    const iconSize = clamp(Math.round(cellHeight * 0.3), 24, 44);
    const labelSize = clamp(Math.round(cellHeight * 0.115), 12, 17);
    this._gridEl.style.setProperty('--tsr-icon-size', `${iconSize}px`);
    this._gridEl.style.setProperty('--tsr-label-size', `${labelSize}px`);
    const visualSize = computeVisualSize(cellHeight, iconSize, labelSize);
    this._gridEl.style.setProperty('--tsr-visual-size', `${visualSize}px`);

    // Rebuild the row containers and re-home the (already existing) cells.
    const rowElements: HTMLElement[] = [];
    this._rowGroups = rows.map((row) => row.map((slot) => visible[slot]));
    rows.forEach((row) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'row';
      row.forEach((slot) => {
        const cell = this._cells[visible[slot]];
        if (!cell) return;
        const weight = Math.min(weights[slot], columns);
        cell.parts.root.style.gridColumn = `span ${weight}`;
        rowEl.appendChild(cell.parts.root);
      });
      // Equal tracks: one per slot the row holds, or the full stated column
      // count in a strict grid - there the last row stays left-aligned in the
      // same raster rather than stretching to fill the width. minmax(0, 1fr)
      // rather than 1fr so a long label cannot push a track past its share.
      // A ring is taller than an icon. Every cell of its row gives its icon
      // the same room, so the names still line up across the row.
      rowEl.classList.toggle(
        'reserve-visual',
        row.some((slot) => !!this._cells[visible[slot]]?.itemType?.tallVisual),
      );
      const rowWeight = row.reduce((sum, slot) => sum + Math.min(weights[slot], columns), 0);
      const tracks = strict ? columns : rowWeight;
      rowEl.style.gridTemplateColumns = `repeat(${tracks}, minmax(0, 1fr))`;
      rowElements.push(rowEl);
    });
    this._gridEl.replaceChildren(...rowElements);
    this._rowEls = rowElements;
    this._updateStateReservation();

    // Cell geometry decides the inner arrangement - deterministic, so no jitter.
    const columnWidth = columns > 0 ? innerWidth / columns : innerWidth;
    // columnWidth includes a share of the gaps - the icon-only threshold has
    // always been measured that way; trackWidth is what one slot really is.
    const gap = toNumber(layout.gap, 12);
    this._geometry = {
      columnWidth,
      trackWidth: columns > 0 ? (innerWidth - gap * (columns - 1)) / columns : innerWidth,
      cellHeight,
      visualSize,
      columns,
      gap,
      iconSize,
      labelSize,
    };
    this._cells.forEach((cell, index) => {
      const item = items[index];
      if (item && cell.itemType && cell.itemType.arrange) {
        cell.itemType.arrange(cell.parts, item, this._geometry);
      }
    });
    this._lastVisibleKey = visible.join(',');
    // Some types decide what to draw by the size they get - whether a value
    // still fits inside a ring. Their views changed with the geometry.
    if (this._hass && this._cells.some((cell) => cell.itemType?.tallVisual)) {
      visible.forEach((index) => {
        if (this._cells[index]?.itemType?.tallVisual) this._syncItem(index);
      });
      this._updateStateReservation();
    }
  }

  /* --- State sync ------------------------------------------------------- */

  private _sync(force = false): void {
    if (!this._config || !this._hass || this._cells.length === 0) return;
    const hass = this._hass;

    // Visibility first: it decides which items the layout has to place, so a
    // change here has to re-run the layout before anything is painted.
    const visible: number[] = [];
    this._config.items.forEach((item, index) => {
      if (isVisible(item.visibility, hass, this._matchMedia)) visible.push(index);
    });
    const visibleKey = visible.join(',');
    if (visibleKey !== this._lastVisibleKey) {
      this._visible = visible;
      this._cells.forEach((cell, index) => {
        cell.parts.root.hidden = !visible.includes(index);
      });
      this._lastColumns = 0; // force the layout to recompute
      this._applyLayout(this._lastWidth || this.clientWidth);
    }

    visible.forEach((index) => this._syncItem(index, force));
    // A hidden item does not tick.
    this._ticks.forEach((_, index) => {
      if (!visible.includes(index)) this._setTick(index, null);
    });

    this._updateStateReservation();
  }

  /** Brings one item up to date - on a hass update, or on its own tick. */
  private _syncItem(index: number, force = false): void {
    const config = this._config;
    const hass = this._hass;
    const item = config && config.items[index];
    const cell = this._cells[index];
    if (!config || !hass || !item || !cell) return;

    const stateObj = item.entity ? hass.states[item.entity] : undefined;
    const missing = !!item.entity && !stateObj;
    const unavailable = !!item.entity && isUnavailable(stateObj);
    const itemType = cell.itemType;
    const flashing = this._flashing(index, stateObj);
    // A type that knows its own "on" (a countdown that runs) says so from
    // its view; everything else follows Home Assistant's active semantics.
    const ownActive = !!(itemType && itemType.activeOf);

    // One context per templated item per update; items without templates
    // never build one.
    const context = item.hasTemplates ? templateContext(hass, stateObj, config.variables) : null;
    const resolve = context ? (value: unknown) => renderTemplate(value, context) : identity;

    const colours = context
      ? {
          background: resolve(item.background),
          active_background: resolve(item.active_background),
          active_color: resolve(item.active_color),
          icon_color: resolve(item.icon_color),
        }
      : null;
    const style = item.style ? resolve(item.style) : null;

    // active_when, when set, decides alone - over Home Assistant's active
    // semantics and over whatever the type would say.
    const forced = activeWhen(item, resolve);

    const sync: SyncContext = {
      hass,
      stateObj,
      active: forced ?? ((!ownActive && isActiveState(stateObj)) || flashing),
      unavailable,
      missing,
      resolve,
      geometry: this._geometry,
      now: Date.now(),
      data: this._data[index],
      activeWhen: forced,
    };
    const view = itemType ? itemType.view(item, sync) : null;
    if (forced === null && itemType && itemType.activeOf) {
      sync.active = itemType.activeOf(view) || flashing;
    }
    this._setTick(index, itemType && itemType.tickOf ? itemType.tickOf(view) : null);
    this._setRefresh(index, itemType && itemType.refreshOf ? itemType.refreshOf(view) : null);

    const signature = [
      sync.active ? 1 : 0,
      unavailable ? 1 : 0,
      missing ? 1 : 0,
      style || '',
      // Template results belong in the signature, so a card whose templates
      // keep returning the same thing still writes nothing to the DOM.
      colours ? JSON.stringify(colours) : '',
      JSON.stringify(view),
    ].join('\u001f');

    if (!force && this._signatures[index] === signature) return;
    this._signatures[index] = signature;

    this._renderCell(cell, item, sync, colours, style);
    if (itemType) itemType.paint(cell.parts, item, view, sync);
    else this._renderUnknown(cell, item);
  }

  /**
   * An item whose view changes with time - a running countdown - has its own
   * subscription to the shared clock, at the millisecond within the second
   * where its digits flip. Only that item is brought up to date on a tick.
   */
  private _setTick(index: number, phase: number | null): void {
    const current = this._ticks.get(index);
    if (current && current.phase === phase) return;
    if (current) {
      current.stop();
      this._ticks.delete(index);
    }
    if (phase === null || !this.isConnected) return;
    const stop = sharedTicker.subscribe(() => {
      this._syncItem(index);
      this._updateStateReservation();
    }, phase);
    this._ticks.set(index, { phase, stop });
  }

  private _clearTicks(): void {
    this._ticks.forEach(({ stop }) => stop());
    this._ticks.clear();
    this._refreshTimers.forEach(({ timer }) => window.clearTimeout(timer));
    this._refreshTimers.clear();
  }

  private _setRefresh(index: number, at: number | null): void {
    const current = this._refreshTimers.get(index);
    if (current && current.at === at) return;
    if (current) {
      window.clearTimeout(current.timer);
      this._refreshTimers.delete(index);
    }
    if (at === null || !this.isConnected) return;
    const timer = window.setTimeout(
      () => {
        this._refreshTimers.delete(index);
        this._syncItem(index);
      },
      Math.max(1000, at - Date.now()),
    );
    this._refreshTimers.set(index, { at, timer });
  }

  /**
   * Starts the subscriptions of the types that have one, once per config and
   * connection. hass is reassigned on every state change; the subscriptions
   * are not renewed with it.
   */
  private _subscribe(): void {
    const config = this._config;
    const hass = this._hass;
    if (!config || !hass || !this.isConnected || this._subscriptions.length) return;
    this._subscriptions = config.items.map((item, index) => {
      const itemType = this._cells[index]?.itemType;
      if (!itemType || !itemType.subscribe || item.error) return () => undefined;
      return itemType.subscribe(item, hass, (data) => {
        this._data[index] = data;
        this._syncItem(index);
      });
    });
  }

  private _unsubscribe(): void {
    this._subscriptions.forEach((stop) => stop());
    this._subscriptions = [];
    this._data = [];
  }

  /**
   * A stateless entity is active for PRESS_FLASH_MS after its timestamp
   * changes. Measured on this device's clock from when the change arrives,
   * not from the timestamp itself: a wall tablet's clock drifts, and a second
   * of drift would swallow the whole flash.
   */
  private _flashing(index: number, stateObj: HassEntity | undefined): boolean {
    if (!stateObj || !isStateless(stateObj)) {
      this._lastStateless[index] = undefined;
      return false;
    }
    const state = String(stateObj.state);
    const previous = this._lastStateless[index];
    this._lastStateless[index] = state;

    // The first state seen is history, not a press. Coming back from
    // unavailable (an HA restart) restores the old timestamp - not a press
    // either.
    const pressed =
      previous !== undefined &&
      previous !== state &&
      previous !== 'unavailable' &&
      state !== 'unavailable';
    if (pressed) {
      this._flashUntil[index] = Date.now() + PRESS_FLASH_MS;
      window.clearTimeout(this._flashTimers[index] ?? undefined);
      this._flashTimers[index] = window.setTimeout(() => {
        this._flashTimers[index] = null;
        this._sync();
      }, PRESS_FLASH_MS);
    }
    return (this._flashUntil[index] || 0) > Date.now();
  }

  private _clearFlashes(): void {
    this._flashTimers.forEach((timer) => timer && window.clearTimeout(timer));
    this._lastStateless = [];
    this._flashUntil = [];
    this._flashTimers = [];
  }

  /** A row reserves room for the state line as soon as one of its items uses it. */
  private _updateStateReservation(): void {
    if (!this._rowEls || !this._rowGroups) return;
    this._rowGroups.forEach((group, rowIndex) => {
      const rowEl = this._rowEls && this._rowEls[rowIndex];
      if (!rowEl) return;
      const needed = group.some((itemIndex) => {
        const cell = this._cells[itemIndex];
        return cell && cell.parts.state.textContent;
      });
      rowEl.classList.toggle('reserve-state', needed);
    });
  }

  /** The shell's share of a render: state classes, colours, style. */
  private _renderCell(
    cell: Cell,
    item: ItemBase,
    sync: SyncContext,
    colours: Dict | null,
    style: unknown,
  ): void {
    const { root } = cell.parts;

    root.classList.toggle('active', sync.active);
    root.classList.toggle('unavailable', sync.unavailable && !sync.missing);
    root.classList.toggle('invalid', sync.missing || !!item.error);

    // Mirrored onto the element so a stylesheet can react to them.
    root.dataset.state = sync.stateObj ? String(sync.stateObj.state) : '';
    root.dataset.active = sync.active ? 'true' : 'false';

    if (colours) this._applyColours(root, colours);
    if (style || cell.parts.styleProps) this._applyStyle(root, style, cell.parts);

    root.title = sync.missing ? `Unknown entity: ${item.entity}` : '';
  }

  private _renderUnknown(cell: Cell, item: ItemBase): void {
    cell.parts.state.textContent = item.error || '';
    cell.parts.root.setAttribute('aria-label', item.error || 'Item');
  }

  /* --- Gestures --------------------------------------------------------- */

  /**
   * Pointer-first gesture handling.
   *
   * A plain tap fires on pointerup with no delay. The 250 ms double-tap window
   * is only opened when a double_tap_action actually exists - responsiveness on
   * a wall tablet matters more than universal double-tap support.
   */
  private _bindGestures(el: HTMLElement, index: number): void {
    const gesture: GestureState = {
      index,
      holdTimer: null,
      tapTimer: null,
      held: false,
      pointerId: null,
      startX: 0,
      startY: 0,
      lastPointerUp: 0,
    };
    this._gestures.set(el, gesture);
    const item = () => (this._config as CardConfig).items[index];

    el.addEventListener('pointerdown', (event) => {
      if (event.button !== undefined && event.button > 0) return;
      gesture.pointerId = event.pointerId;
      gesture.held = false;
      gesture.startX = event.clientX;
      gesture.startY = event.clientY;
      el.classList.add('pressed');

      if (item().hold_action.action !== 'none') {
        gesture.holdTimer = window.setTimeout(() => {
          gesture.held = true;
          gesture.holdTimer = null;
          el.classList.remove('pressed');
          haptic(el, 'medium');
          this._dispatch(index, 'hold', el);
        }, HOLD_DELAY_MS);
      }
    });

    el.addEventListener('pointermove', (event) => {
      if (gesture.pointerId !== event.pointerId) return;
      // A scroll gesture is not a tap.
      if (
        Math.abs(event.clientX - gesture.startX) > 12 ||
        Math.abs(event.clientY - gesture.startY) > 12
      ) {
        this._cancelGesture(gesture);
        el.classList.remove('pressed');
      }
    });

    el.addEventListener('pointerup', (event) => {
      if (gesture.pointerId !== event.pointerId) return;
      el.classList.remove('pressed');
      gesture.pointerId = null;
      gesture.lastPointerUp = Date.now();

      if (gesture.holdTimer) {
        window.clearTimeout(gesture.holdTimer);
        gesture.holdTimer = null;
      }
      if (gesture.held) {
        gesture.held = false;
        this._releaseArmed(index);
        return;
      }

      if (item().double_tap_action.action === 'none') {
        this._dispatch(index, 'tap', el);
        return;
      }

      if (gesture.tapTimer) {
        window.clearTimeout(gesture.tapTimer);
        gesture.tapTimer = null;
        this._dispatch(index, 'double_tap', el);
        return;
      }
      gesture.tapTimer = window.setTimeout(() => {
        gesture.tapTimer = null;
        this._dispatch(index, 'tap', el);
      }, DOUBLE_TAP_WINDOW_MS);
    });

    el.addEventListener('pointercancel', () => {
      el.classList.remove('pressed');
      // A touch screen may end a long press this way rather than with a
      // pointerup - the finger moved a little. What it armed stays armed.
      if (gesture.held) this._releaseArmed(index);
      this._cancelGesture(gesture);
    });
    el.addEventListener('pointerleave', () => {
      el.classList.remove('pressed');
      if (gesture.holdTimer) {
        window.clearTimeout(gesture.holdTimer);
        gesture.holdTimer = null;
      }
    });

    // Keyboard and assistive technology produce a click without pointer events.
    el.addEventListener('click', (event) => {
      event.preventDefault();
      if (Date.now() - gesture.lastPointerUp < 700) return; // already handled
      this._dispatch(index, 'tap', el);
    });
    el.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  private _cancelGesture(gesture: GestureState): void {
    if (gesture.holdTimer) {
      window.clearTimeout(gesture.holdTimer);
      gesture.holdTimer = null;
    }
    if (gesture.tapTimer) {
      window.clearTimeout(gesture.tapTimer);
      gesture.tapTimer = null;
    }
    gesture.pointerId = null;
    gesture.held = false;
  }

  /* --- Dispatch --------------------------------------------------------- */

  private _dispatch(index: number, kind: Gesture, el: HTMLElement): void {
    const item = this._config && this._config.items[index];
    if (!item) return;

    // See core/confirm.ts: a gesture arms, a tap confirms whatever is armed.
    const armed = this._armedIndex === index ? this._armedKind : null;
    const step = confirmStep(item, armed, kind);
    if (!step) return;
    if ('arm' in step) {
      this._arm(index, step.arm, el);
      return;
    }
    this._clearArmed();

    haptic(el, step.run === 'hold' ? 'medium' : 'light');
    performAction(this._hass, actionFor(item, step.run), el);
  }

  private _arm(index: number, kind: Gesture, el: HTMLElement): void {
    this._clearArmed();
    this._armedIndex = index;
    this._armedKind = kind;
    el.classList.add('armed');

    const item = (this._config as CardConfig).items[index];
    const cell = this._cells[index];
    const confirmation = item.confirmation[kind];
    const text = (confirmation && confirmation.text) || CONFIRM_TEXT[kind];
    if (cell) {
      const { state } = cell.parts;
      state.dataset.previous = state.textContent || '';
      state.textContent = text;
      state.style.display = '';
    }
    haptic(el, 'warning');

    // The time to confirm runs from when the finger comes off: a hold arms
    // while the finger is still down, and holding on must not use it up.
    const gesture = this._gestures.get(el);
    if (!(kind === 'hold' && gesture && gesture.pointerId !== null)) this._startArmedTimer();
  }

  private _startArmedTimer(): void {
    if (this._armedTimer) window.clearTimeout(this._armedTimer);
    this._armedTimer = window.setTimeout(() => this._clearArmed(), CONFIRM_TIMEOUT_MS);
  }

  /** The hold that armed this item has ended; now the time to confirm starts. */
  private _releaseArmed(index: number): void {
    if (this._armedIndex === index && this._armedKind === 'hold' && !this._armedTimer) {
      this._startArmedTimer();
    }
  }

  private _clearArmed(): void {
    if (this._armedTimer) {
      window.clearTimeout(this._armedTimer);
      this._armedTimer = null;
    }
    if (this._armedIndex < 0) return;

    const cell = this._cells[this._armedIndex];
    if (cell) {
      const { root, state } = cell.parts;
      root.classList.remove('armed');
      const previous = state.dataset.previous || '';
      state.textContent = previous;
      state.style.display = previous ? '' : 'none';
      delete state.dataset.previous;
    }
    // The next sync must repaint this item, so drop its signature first.
    this._signatures[this._armedIndex] = null;
    this._armedIndex = -1;
    this._armedKind = null;
  }
}
