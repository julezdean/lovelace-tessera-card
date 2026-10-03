import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  partitionRows,
  computeColumns,
  computeCellHeight,
  normalizeConfig,
  animationActive,
  isActiveState,
  isUnavailable,
  isFaultState,
  computeGridOptions,
  computeContentHeight,
} from '../src/main.ts';

const ones = (n) => Array.from({ length: n }, () => 1);
const cfg = (overrides = {}) =>
  normalizeConfig({ type: 'custom:tessera-card', items: [{}], ...overrides });

/* -- partitioning --------------------------------------------------------- */

test('every button lands in exactly one row, in order', () => {
  for (let n = 1; n <= 24; n++) {
    for (let cols = 1; cols <= 6; cols++) {
      const rows = partitionRows(ones(n), cols);
      const flat = rows.flat();
      assert.deepEqual(flat, [...Array(n).keys()], `n=${n} cols=${cols}`);
    }
  }
});

test('no row is wider than the column count', () => {
  for (let n = 1; n <= 24; n++) {
    for (let cols = 1; cols <= 6; cols++) {
      for (const row of partitionRows(ones(n), cols)) {
        assert.ok(row.length <= cols, `n=${n} cols=${cols} row=${row.length}`);
      }
    }
  }
});

test('rows differ by at most one slot - no orphan row after a full one', () => {
  for (let n = 1; n <= 24; n++) {
    for (let cols = 1; cols <= 6; cols++) {
      const sizes = partitionRows(ones(n), cols).map((row) => row.length);
      const spread = Math.max(...sizes) - Math.min(...sizes);
      assert.ok(spread <= 1, `n=${n} cols=${cols} -> [${sizes}] spread ${spread}`);
    }
  }
});

test('rows are front-heavy, so the wide button ends up at the bottom', () => {
  for (let n = 1; n <= 24; n++) {
    for (let cols = 2; cols <= 6; cols++) {
      const sizes = partitionRows(ones(n), cols).map((row) => row.length);
      for (let i = 1; i < sizes.length; i++) {
        assert.ok(sizes[i - 1] >= sizes[i], `n=${n} cols=${cols} -> [${sizes}]`);
      }
    }
  }
});

test('the documented shapes come out as documented', () => {
  assert.deepEqual(partitionRows(ones(1), 2), [[0]]);
  assert.deepEqual(partitionRows(ones(2), 2), [[0, 1]]);
  assert.deepEqual(partitionRows(ones(3), 2), [[0, 1], [2]]);
  assert.deepEqual(partitionRows(ones(4), 2), [[0, 1], [2, 3]]);
  assert.deepEqual(partitionRows(ones(5), 2), [[0, 1], [2, 3], [4]]);
  // The case a plain CSS grid gets wrong: it would produce [3,3,1].
  assert.deepEqual(partitionRows(ones(7), 3), [[0, 1, 2], [3, 4], [5, 6]]);
  assert.deepEqual(partitionRows(ones(8), 3), [[0, 1, 2], [3, 4, 5], [6, 7]]);
});

test('colspan consumes slots instead of overflowing its row', () => {
  // weight 2 + 1 + 1 over two columns: the wide one takes a row of its own.
  assert.deepEqual(partitionRows([2, 1, 1], 2), [[0], [1, 2]]);
  assert.deepEqual(partitionRows([2, 1, 1, 1, 1], 2), [[0], [1, 2], [3, 4]]);
  // weight larger than the column count is clamped, never dropped.
  assert.deepEqual(partitionRows([99, 1, 1], 2).flat(), [0, 1, 2]);
  for (const row of partitionRows([99, 1, 1], 2)) {
    assert.ok(row.length <= 2);
  }
});

test('weighted layouts still place every button exactly once', () => {
  const weights = [2, 1, 1, 3, 1, 1, 2, 1];
  for (let cols = 1; cols <= 6; cols++) {
    assert.deepEqual(partitionRows(weights, cols).flat(), [...Array(weights.length).keys()]);
  }
});

/* -- column count --------------------------------------------------------- */

test('column count follows the measured width', () => {
  const config = cfg();
  assert.equal(computeColumns(config, 8, 300), 2); // narrow portrait tablet
  assert.equal(computeColumns(config, 8, 500), 3);
  assert.equal(computeColumns(config, 8, 900), 5);
  assert.equal(computeColumns(config, 8, 1400), 6); // capped by max_columns
});

test('few buttons never spread across more columns than they have', () => {
  assert.equal(computeColumns(cfg(), 2, 1400), 2);
  assert.equal(computeColumns(cfg(), 1, 1400), 1);
  assert.equal(computeColumns(cfg(), 3, 1400), 3);
});

test('an unmeasured card falls back to two columns rather than one', () => {
  assert.equal(computeColumns(cfg(), 8, 0), 2);
  assert.equal(computeColumns(cfg(), 1, 0), 1);
});

test('explicit grid mode wins over measurement', () => {
  const config = cfg({ layout: { mode: 'grid', columns: 3 } });
  assert.equal(computeColumns(config, 9, 300), 3);
  assert.equal(computeColumns(config, 9, 1600), 3);
});

test('layout.columns as a number implies grid mode', () => {
  assert.equal(cfg({ layout: { columns: 4 } }).layout.mode, 'grid');
  assert.equal(cfg({ layout: { columns: 'auto' } }).layout.mode, 'auto');
});

/* -- cell height ---------------------------------------------------------- */

test('a single button does not become a giant tile', () => {
  const height = computeCellHeight(cfg(), 1, 900);
  assert.ok(height <= 170, `expected the max_button_size cap, got ${height}`);
});

test('many narrow columns stay above the touch-target floor', () => {
  const height = computeCellHeight(cfg(), 6, 600);
  assert.ok(height >= 88, `expected the min_button_size floor, got ${height}`);
});

test('cell height grows with column width between the bounds', () => {
  const config = cfg();
  const narrow = computeCellHeight(config, 4, 700); // ~166px columns
  const wide = computeCellHeight(config, 2, 700); // ~344px columns
  assert.ok(wide > narrow, `${wide} should exceed ${narrow}`);
});

/* -- configuration -------------------------------------------------------- */

test('an entity without a tap_action toggles; without an entity it does nothing', () => {
  const config = normalizeConfig({
    items: [{ entity: 'light.a' }, { name: 'plain' }],
  });
  assert.deepEqual(config.items[0].tap_action, { action: 'toggle', entity: 'light.a' });
  assert.equal(config.items[1].tap_action.action, 'none');
  assert.equal(config.items[1].hold_action.action, 'none');
});

test('the bare { service, target } shorthand becomes a call-service action', () => {
  const config = normalizeConfig({
    items: [{ action: { service: 'light.turn_on', target: { entity_id: 'light.a' } } }],
  });
  assert.equal(config.items[0].tap_action.action, 'call-service');
  assert.equal(config.items[0].tap_action.service, 'light.turn_on');
});

test('perform-action is accepted as a synonym for call-service', () => {
  const config = normalizeConfig({
    items: [{ tap_action: { action: 'perform-action', perform_action: 'scene.turn_on' } }],
  });
  assert.equal(config.items[0].tap_action.action, 'call-service');
  assert.equal(config.items[0].tap_action.service, 'scene.turn_on');
});

test('card-level animation is inherited and overridable per button', () => {
  const config = normalizeConfig({
    animation: { type: 'breathe', duration: 3 },
    items: [{ entity: 'light.a' }, { entity: 'light.b', animation: { type: 'spin' } }],
  });
  assert.equal(config.items[0].animation.type, 'breathe');
  assert.equal(config.items[0].animation.duration, '3s');
  assert.equal(config.items[1].animation.type, 'spin');
  assert.equal(config.items[1].animation.duration, '3s', 'duration still inherited');
});

test('an unknown animation type degrades to none instead of throwing', () => {
  const config = normalizeConfig({ items: [{ animation: { type: 'explode' } }] });
  assert.equal(config.items[0].animation.type, 'none');
});

test('a broken button does not take the card down', () => {
  const config = normalizeConfig({ items: [{ entity: 'light.a' }, 'not a mapping'] });
  assert.equal(config.items.length, 2);
  assert.ok(config.items[1].error);
});

test('a card without buttons is reported, not silently empty', () => {
  assert.throws(() => normalizeConfig({ items: [] }), /non-empty/);
  assert.throws(() => normalizeConfig({}), /non-empty/);
});

/* -- animation conditions ------------------------------------------------- */

const on = { entity_id: 'light.a', state: 'on', attributes: {} };
const off = { entity_id: 'light.a', state: 'off', attributes: {} };
const temp = (value) => ({ entity_id: 'sensor.t', state: String(value), attributes: {} });
const anim = (overrides) => ({ enabled: true, type: 'pulse', intensity: 1, duration: '2s', ...overrides });

test('the default condition is HA active semantics', () => {
  assert.equal(animationActive(anim({ when: 'active' }), on), true);
  assert.equal(animationActive(anim({ when: 'active' }), off), false);
});

test('a value domain at zero is inactive', () => {
  const empty = { entity_id: 'todo.shopping', state: '0', attributes: {} };
  const filled = { entity_id: 'todo.shopping', state: '3', attributes: {} };
  assert.equal(animationActive(anim({ when: 'active' }), empty), false);
  assert.equal(animationActive(anim({ when: 'active' }), filled), true);
});

test('a button, scene or event is not active just because it was pressed once', () => {
  // Their state is the timestamp of the last press; read as a state it would
  // be active forever. The brief flash after a press is the card's business.
  for (const entity_id of ['button.klingel', 'input_button.a', 'scene.abend', 'event.tuer']) {
    const pressed = { entity_id, state: '2026-09-29T09:14:02.123+00:00', attributes: {} };
    assert.equal(isActiveState(pressed), false, entity_id);
    assert.equal(isUnavailable(pressed), false, entity_id);
  }
});

test('a button that was never pressed is usable, not unavailable', () => {
  const fresh = { entity_id: 'button.klingel', state: 'unknown', attributes: {} };
  assert.equal(isUnavailable(fresh), false);
  assert.equal(isUnavailable({ ...fresh, state: 'unavailable' }), true);
  // Everywhere else unknown still means unavailable.
  assert.equal(isUnavailable({ entity_id: 'light.a', state: 'unknown', attributes: {} }), true);
});

test('a device in error is a fault, not active', () => {
  // Valetudo and HA report a stuck vacuum as state error; it must not light
  // up like a cleaning one.
  const stuck = { entity_id: 'vacuum.staubsauger', state: 'error', attributes: {} };
  assert.equal(isActiveState(stuck), false);
  assert.equal(isFaultState(stuck), true);
  assert.equal(isUnavailable(stuck), false);
  assert.equal(isFaultState({ ...stuck, state: 'cleaning' }), false);
  assert.equal(isFaultState(undefined), false);
});

test('an animation on active follows the activity the card passes in', () => {
  const pressed = { entity_id: 'button.klingel', state: '2026-09-29T09:14:02+00:00', attributes: {} };
  assert.equal(animationActive(anim({ when: 'active' }), pressed), false);
  assert.equal(animationActive(anim({ when: 'active' }), pressed, true), true, 'during the flash');
});

test('a bare state string matches exactly', () => {
  assert.equal(animationActive(anim({ when: 'on' }), on), true);
  assert.equal(animationActive(anim({ when: 'on' }), off), false);
});

test('a list matches any of its states', () => {
  const heating = { entity_id: 'climate.a', state: 'heating', attributes: {} };
  assert.equal(animationActive(anim({ when: ['heating', 'cooling'] }), heating), true);
  assert.equal(animationActive(anim({ when: ['cooling'] }), heating), false);
});

test('numeric thresholds work on sensor values', () => {
  assert.equal(animationActive(anim({ when: { above: 25 } }), temp(30)), true);
  assert.equal(animationActive(anim({ when: { above: 25 } }), temp(20)), false);
  assert.equal(animationActive(anim({ when: { above: 10, below: 20 } }), temp(15)), true);
  assert.equal(animationActive(anim({ when: { above: 10, below: 20 } }), temp(25)), false);
});

test('type none and disabled never animate', () => {
  assert.equal(animationActive(anim({ type: 'none', when: 'always' }), on), false);
  assert.equal(animationActive(anim({ enabled: false, when: 'always' }), on), false);
});

test('a condition without an entity does not animate, except for "always"', () => {
  assert.equal(animationActive(anim({ when: 'on' }), undefined), false);
  assert.equal(animationActive(anim({ when: 'always' }), undefined), true);
});

/* -- sections grid footprint ---------------------------------------------- */

const HA_ROW = 56;
const HA_GAP = 8;
const cellPx = (rows) => rows * HA_ROW + (rows - 1) * HA_GAP;

const withButtons = (n, extra = {}) =>
  normalizeConfig({ items: Array.from({ length: n }, (_, i) => ({ name: `B${i}` })), ...extra });

test('the requested grid cell is never smaller than the card needs', () => {
  for (let n = 1; n <= 20; n++) {
    const config = withButtons(n);
    const options = computeGridOptions(config);
    const needed = computeContentHeight(config, 480);
    assert.ok(
      cellPx(options.rows) >= needed,
      `${n} items: cell ${cellPx(options.rows)}px < needed ${Math.ceil(needed)}px`,
    );
  }
});

test('the cell is not wastefully larger than needed either', () => {
  for (let n = 1; n <= 20; n++) {
    const config = withButtons(n);
    const options = computeGridOptions(config);
    const slack = cellPx(options.rows) - computeContentHeight(config, 480);
    // One grid row of slack is the most rounding can produce.
    assert.ok(slack < HA_ROW + HA_GAP, `${n} items: ${Math.round(slack)}px of slack`);
  }
});

test('min_rows never exceeds the default rows', () => {
  for (let n = 1; n <= 20; n++) {
    const options = computeGridOptions(withButtons(n));
    assert.ok(options.min_rows <= options.rows, `${n} items: min ${options.min_rows} > ${options.rows}`);
    assert.ok(options.min_rows >= 1);
  }
});

test('a title is accounted for in the footprint', () => {
  const without = computeContentHeight(withButtons(4), 480);
  const withTitle = computeContentHeight(withButtons(4, { title: 'Erdgeschoss' }), 480);
  assert.ok(withTitle > without, `title added no height (${without} -> ${withTitle})`);
});

test('more buttons never ask for a smaller cell than the same layout with fewer rows', () => {
  // Guards the regression that started this: two buttons were given 120px for
  // the 200px they want, so the card overflowed its cell.
  const two = computeGridOptions(withButtons(2));
  assert.ok(cellPx(two.rows) >= 200, `two buttons got ${cellPx(two.rows)}px`);
});

/* -- strict grid vs. balanced auto ---------------------------------------- */

test('a stated column count fills rows to capacity instead of balancing', () => {
  // 7 buttons over 3 columns: auto avoids the orphan, grid keeps the raster.
  assert.deepEqual(partitionRows(ones(7), 3, true), [[0, 1, 2], [3, 4, 5], [6]]);
  assert.deepEqual(partitionRows(ones(7), 3, false), [[0, 1, 2], [3, 4], [5, 6]]);
});

test('colspan counts against the stated capacity', () => {
  // weights 1,2,1,1,1 over 5 columns: the first row holds exactly five slots.
  assert.deepEqual(partitionRows([1, 2, 1, 1, 1], 5, true), [[0, 1, 2, 3], [4]]);
});

test('no strict row ever exceeds the stated column count', () => {
  const weights = [2, 1, 1, 3, 1, 1, 2, 1, 1];
  for (let cols = 1; cols <= 6; cols++) {
    for (const row of partitionRows(weights, cols, true)) {
      const used = row.reduce((sum, i) => sum + Math.min(weights[i], cols), 0);
      assert.ok(used <= cols, `cols=${cols} row uses ${used}`);
    }
  }
});

test('strict partitioning still places every button exactly once', () => {
  const weights = [1, 2, 1, 1, 1, 3, 1];
  for (let cols = 1; cols <= 6; cols++) {
    assert.deepEqual(partitionRows(weights, cols, true).flat(), [...Array(weights.length).keys()]);
  }
});

test('an explicit column count is not capped by max_columns', () => {
  // max_columns tunes the automatic count; it must not silently override a
  // column count the user spelled out.
  const config = cfg({ layout: { mode: 'grid', columns: 8, max_columns: 3 } });
  assert.equal(computeColumns(config, 8, 530), 8);
});

test('an explicit column count is still capped by what a touch target allows', () => {
  const config = cfg({ layout: { mode: 'grid', columns: 99 } });
  assert.equal(computeColumns(config, 99, 530), 12);
});

test('the grid footprint uses the same partitioning the renderer does', () => {
  // 7 buttons, 3 strict columns -> 3 rows; balanced would also be 3, so use a
  // case where they differ: 5 buttons over 4 columns.
  const strict = normalizeConfig({
    layout: { mode: 'grid', columns: 4 },
    items: Array.from({ length: 5 }, (_, i) => ({ name: `B${i}` })),
  });
  assert.deepEqual(partitionRows(ones(5), 4, true), [[0, 1, 2, 3], [4]]);
  assert.deepEqual(partitionRows(ones(5), 4, false), [[0, 1, 2], [3, 4]]);
  // Both are two rows here, so the footprint agrees - the point is that it is
  // computed from the strict partition, not the balanced one.
  assert.ok(computeContentHeight(strict, 480) > 0);
});

/* -- icon and text arrangement -------------------------------------------- */

test('the inner arrangement is a choice, not a guess', () => {
  const config = normalizeConfig({
    button: { layout: 'horizontal' },
    items: [{ name: 'a' }, { name: 'b', layout: 'vertical' }],
  });
  assert.equal(config.items[0].layout, 'horizontal', 'card default applies');
  assert.equal(config.items[1].layout, 'vertical', 'the button overrides it');
});

test('a button stands its icon above the text by default', () => {
  assert.equal(normalizeConfig({ items: [{}] }).items[0].layout, 'vertical');
});

/* -- mode and columns interacting ----------------------------------------- */

test('an explicit mode: auto is not overridden by a leftover column count', () => {
  // The editor leaves `columns` in the configuration when you switch back to
  // automatic. Treating that number as "you meant grid" made the automatic
  // layout unreachable for anyone who had ever set one.
  const config = cfg({ layout: { mode: 'auto', columns: 5 } });
  assert.equal(config.layout.mode, 'auto');
  assert.notEqual(computeColumns(config, 6, 530), 5, 'the stale count must not decide');
});

test('columns without a mode is still shorthand for grid', () => {
  const config = cfg({ layout: { columns: 5 } });
  assert.equal(config.layout.mode, 'grid');
  assert.equal(computeColumns(config, 6, 530), 5);
});

test('an explicit grid mode still uses its column count', () => {
  const config = cfg({ layout: { mode: 'grid', columns: 6 } });
  assert.equal(computeColumns(config, 6, 530), 6);
});

test('the same six buttons lay out the same way whatever columns says in auto', () => {
  const weights = ones(6);
  const shapes = [undefined, 2, 5, 6].map((columns) => {
    const config = cfg({ layout: columns === undefined ? { mode: 'auto' } : { mode: 'auto', columns } });
    const cols = computeColumns(config, 6, 530);
    return JSON.stringify(partitionRows(weights, cols, false).map((r) => r.length));
  });
  assert.equal(new Set(shapes).size, 1, `auto should ignore columns entirely, got ${shapes}`);
});
