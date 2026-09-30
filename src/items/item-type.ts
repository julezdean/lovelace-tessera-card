import type { Resolve } from '../core/templates';
import type { AnimationConfig, Dict, HassEntity, HomeAssistant, ItemBase } from '../types';

/**
 * The DOM of one cell. `root` is the shell the card owns - surface, outline,
 * gestures - and `state` is the secondary line under the name, which every
 * type has: the card writes confirmation prompts into it and lines rows up by
 * it.
 */
export interface CellParts {
  root: HTMLElement;
  state: HTMLElement;
  /** Properties set by the item's `style`, removed again before the next pass. */
  styleProps?: string[];
}

/** What the card knows about an item's entity at the moment of a sync. */
export interface SyncContext {
  hass: HomeAssistant;
  stateObj: HassEntity | undefined;
  active: boolean;
  unavailable: boolean;
  missing: boolean;
  resolve: Resolve;
  /** The last layout pass's measurements. */
  geometry: CellGeometry;
  /** The moment this sync is for. */
  now: number;
  /** What the type's own subscription last delivered, if it has one. */
  data: unknown;
  /** `active_when`, if the item sets it: it overrides the type's own rule. */
  activeWhen: boolean | null;
}

/** The measured geometry a layout pass hands to every cell. */
export interface CellGeometry {
  /** innerWidth / columns: a slot plus its share of the gaps. */
  columnWidth: number;
  /** The width of one slot's track, without gaps. */
  trackWidth: number;
  cellHeight: number;
  /** The height a tall drawing gets in place of the icon. */
  visualSize: number;
  columns: number;
  gap: number;
  iconSize: number;
  labelSize: number;
}

export interface NormalizeContext {
  /** The type's own defaults block, e.g. `button:`, merged over built-ins. */
  defaults: Dict;
  animation: AnimationConfig;
}

export interface EditorContext {
  config: Dict;
}

/**
 * One kind of item. The card owns the cell - its surface, placement,
 * visibility and gestures - and a type owns what is inside it.
 *
 * `view` and `paint` are split so the card can compare what a type WOULD draw
 * with what it drew last time, and write nothing to the DOM when nothing
 * changed. A view must therefore be a plain value that JSON can serialise.
 */
export interface ItemType<
  I extends ItemBase = ItemBase,
  P extends CellParts = CellParts,
  V = unknown,
> {
  /** The `type:` value. */
  type: string;
  /** Shown in the editor. */
  label: string;
  icon: string;

  /** Built-in defaults of the type's own options, before its defaults block. */
  defaults: Dict;
  /** What tap and hold do when the item names an entity but no action. */
  defaultActions: { tap: string; hold: string };
  /** Fields a template may fill, beyond the cell's own. */
  templatedFields: readonly string[];
  /** CSS for what the type puts inside the cell. The cell itself is styled by the card. */
  styles: string;

  /** Adds the type's own options onto the already normalised base. */
  normalize(src: Dict, base: ItemBase, context: NormalizeContext): I;

  /** Fills the shell, once per config. */
  build(item: I, root: HTMLElement): P;

  /**
   * Whether the item counts as "on", for a type that knows better than the
   * entity's state - a countdown is on while it runs. Without it, Home
   * Assistant's active semantics apply.
   */
  activeOf?(view: V): boolean;
  /** ms within the second at which the view next changes, or null if it does not by itself. */
  tickOf?(view: V): number | null;
  /** Draws something taller than an icon, for which its row reserves room. */
  tallVisual?: boolean;
  /** When (epoch ms) the view changes by itself next, for changes slower than a tick. */
  refreshOf?(view: V): number | null;
  /**
   * Data from outside the state machine - a graph's history. Called once per
   * config while the card is connected; `onData` hands over what arrived, and
   * the returned function stops it.
   */
  subscribe?(item: I, hass: HomeAssistant, onData: (data: unknown) => void): () => void;

  view(item: I, context: SyncContext): V;
  paint(parts: P, item: I, view: V, context: SyncContext): void;

  /** Adapts the inner arrangement to the cell it was given. */
  arrange?(parts: P, item: I, geometry: CellGeometry): void;

  editor: ItemEditor;
}

export interface ItemEditor {
  /** ha-form schema of the item's page. */
  schema(context: EditorContext): unknown[];
  /** The keys the form owns; everything else in the item is carried through. */
  formKeys: readonly string[];
  toForm(item: Dict, context: EditorContext): Dict;
  fromForm(value: Dict, previous: Dict, context: EditorContext): Dict;
  /** A new item as "+ Add item" creates it. */
  create(index: number): Dict;
  /** The title of the item in the list, when it has no name of its own. */
  fallbackName(index: number): string;
}
