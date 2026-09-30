import { COLUMN_LIMIT, HA_GRID_ROW_GAP, HA_GRID_ROW_HEIGHT, HA_SECTION_WIDTH } from '../const';
import type { CardConfig, LayoutConfig } from '../types';
import { toNumber } from '../utils';

/**
 * The three layout options answer three different questions:
 *
 *   colspan       how many slots one item occupies
 *   columns       how many slots a row holds
 *   max_columns   the ceiling for the count `auto` works out for itself
 *
 * max_columns belongs to the automatic mode only. In `grid` the column count
 * is stated outright, and a second ceiling on top of it would just be a way to
 * silently ignore what was asked for.
 */
export const DEFAULT_LAYOUT: LayoutConfig = {
  mode: 'auto', // auto | grid
  columns: 'auto',
  gap: 12,
  min_button_size: 88, // minimum cell height in px
  max_button_size: 170, // maximum cell height in px
  column_width: 172, // target column width the auto mode aims for
  max_columns: 6, // auto mode only
};

type LayoutInput = Pick<CardConfig, 'layout'>;

/** `grid`: the user stated the column count. */
export function isStrictGrid(layout: Pick<LayoutConfig, 'mode'>): boolean {
  return layout.mode === 'grid';
}

/**
 * How many columns fit, given the measured width.
 * The result is clamped by the total weight so three items never spread
 * across six columns just because the screen is wide.
 */
export function computeColumns(config: LayoutInput, totalWeight: number, width: number): number {
  const { layout } = config;
  const hardMax = Math.max(1, Math.min(layout.max_columns, totalWeight));

  if (isStrictGrid(layout)) {
    const requested = Number(layout.columns);
    if (Number.isFinite(requested) && requested > 0) {
      // Deliberately not clamped by max_columns: that option tunes the
      // automatic count, and applying it here would quietly override the
      // column count the user spelled out.
      return Math.max(1, Math.min(COLUMN_LIMIT, Math.round(requested)));
    }
  }

  if (!width || width <= 0) return Math.min(2, hardMax);

  const target = Math.max(
    80,
    Number(layout.column_width) || (DEFAULT_LAYOUT.column_width as number),
  );
  const gap = Number(layout.gap) || 0;
  // Solve width = cols * target + (cols - 1) * gap for cols.
  const raw = (width + gap) / (target + gap);
  return Math.max(1, Math.min(hardMax, Math.round(raw)));
}

/**
 * Split the items into rows so that every row is as full as the others.
 *
 * Weights (from colspan) participate directly: a weight-2 item occupies two
 * slots in its row and gets flex-grow 2, so one mechanism covers both the
 * balancing and the spanning.
 *
 * 3 items / 2 columns -> [[0,1],[2]]            (the last one spans the row)
 *
 * With `strict` the balancing is off and rows are simply filled to capacity.
 * 5 items / 2 columns -> [[0,1],[2,3],[4]]
 * 7 items / 3 columns -> [[0,1,2],[3,4],[5,6]]   (never [3,3,1])
 */
export function partitionRows(weights: number[], columns: number, strict = false): number[][] {
  // Stated column count: fill each row to capacity and start a new one. No
  // balancing - "5 columns" has to mean five columns, even if that leaves the
  // last row half empty.
  if (strict) {
    const rows: number[][] = [];
    let row: number[] = [];
    let used = 0;
    weights.forEach((rawWeight, index) => {
      const weight = Math.min(rawWeight, columns);
      if (row.length > 0 && used + weight > columns) {
        rows.push(row);
        row = [];
        used = 0;
      }
      row.push(index);
      used += weight;
    });
    if (row.length > 0) rows.push(row);
    return rows;
  }

  const total = weights.reduce((sum, weight) => sum + Math.min(weight, columns), 0);
  const rowCount = Math.max(1, Math.ceil(total / columns));

  const rows: number[][] = [];
  let index = 0;
  let remainingWeight = total;
  let remainingRows = rowCount;

  while (index < weights.length && remainingRows > 0) {
    // Front-heavy: ceil() puts the extra slot in the earlier rows.
    const capacity = Math.max(1, Math.min(columns, Math.ceil(remainingWeight / remainingRows)));
    const row: number[] = [];
    let used = 0;

    while (index < weights.length) {
      const weight = Math.min(weights[index], columns);
      if (row.length > 0 && used + weight > capacity) break;
      row.push(index);
      used += weight;
      index += 1;
      if (used >= capacity) break;
    }

    rows.push(row);
    remainingWeight -= used;
    remainingRows -= 1;
  }

  // Safety net: anything left over (possible only with odd weight mixes)
  // becomes its own rows rather than overflowing the last one.
  while (index < weights.length) {
    const row: number[] = [];
    let used = 0;
    while (index < weights.length) {
      const weight = Math.min(weights[index], columns);
      if (row.length > 0 && used + weight > columns) break;
      row.push(index);
      used += weight;
      index += 1;
    }
    rows.push(row);
  }

  return rows;
}

/**
 * Cell height from column width: square-ish, but clamped at both ends so a
 * single item does not become a giant tile and twelve items stay tappable.
 */
export function computeCellHeight(config: LayoutInput, columns: number, width: number): number {
  const { layout } = config;
  const gap = Number(layout.gap) || 0;
  const columnWidth = width > 0 ? (width - gap * (columns - 1)) / columns : 160;
  const min = Number(layout.min_button_size) || (DEFAULT_LAYOUT.min_button_size as number);
  const max = Number(layout.max_button_size) || (DEFAULT_LAYOUT.max_button_size as number);
  return Math.round(Math.max(min, Math.min(max, columnWidth / 1.25)));
}

type ContentInput = Pick<CardConfig, 'layout' | 'appearance' | 'title'> & {
  items: Array<{ weight: number }>;
};

/** Height in px that the card needs for its items at a given width. */
export function computeContentHeight(config: ContentInput, width: number): number {
  const padding = toNumber(config.appearance.padding, 14);
  const gap = toNumber(config.layout.gap, 12);
  const innerWidth = Math.max(0, width - padding * 2 - 2);

  const weights = config.items.map((item) => item.weight);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const columns = computeColumns(config, totalWeight, innerWidth);
  const rows = partitionRows(weights, columns, isStrictGrid(config.layout)).length;
  const cellHeight = computeCellHeight(config, columns, innerWidth);

  const title = config.title ? 33 : 0; // font-size 15 * 1.2 + margins
  return rows * cellHeight + (rows - 1) * gap + padding * 2 + 2 + title;
}

/** Translate a pixel height into whole sections-grid rows. */
function pixelsToGridRows(height: number): number {
  return Math.max(
    1,
    Math.ceil((height + HA_GRID_ROW_GAP) / (HA_GRID_ROW_HEIGHT + HA_GRID_ROW_GAP)),
  );
}

/**
 * The card wants room, so it asks for the full width of the section and for
 * as many rows as its items actually need. The previous version guessed
 * `rows * 2`, which gave two buttons 120px for the 200px they want - the card
 * then overflowed its cell.
 */
export function computeGridOptions(config: ContentInput): {
  columns: number;
  rows: number;
  min_rows: number;
} {
  const needed = computeContentHeight(config, HA_SECTION_WIDTH);
  // The floor uses min_button_size: below that the items stop being tappable,
  // so the user should not be able to drag the card smaller than that either.
  const floorConfig = {
    ...config,
    layout: { ...config.layout, max_button_size: config.layout.min_button_size },
  };
  const minimum = computeContentHeight(floorConfig, HA_SECTION_WIDTH);

  return {
    columns: 12,
    rows: pixelsToGridRows(needed),
    min_rows: pixelsToGridRows(minimum),
  };
}
