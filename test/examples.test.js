/**
 * The example configurations in examples/ are documentation, and documentation
 * that does not parse is worse than none. Every file here goes through the same
 * normalizeConfig() the card uses, so a broken example fails the build.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { normalizeConfig } from '../src/main.ts';

const DIR = new URL('../examples/', import.meta.url);
const FILES = readdirSync(DIR).filter((name) => name.endsWith('.yaml'));

test('there are examples to check', () => {
  assert.ok(FILES.length >= 3, `expected at least three examples, found ${FILES.length}`);
});

for (const file of FILES) {
  test(`examples/${file} is valid YAML and a valid card config`, () => {
    const raw = parse(readFileSync(new URL(file, DIR), 'utf8'));

    assert.equal(raw.type, 'custom:tessera-card', 'wrong card type');

    const config = normalizeConfig(raw);
    assert.ok(config.items.length > 0);

    config.items.forEach((button, index) => {
      const where = `${file} button ${index} (${button.name || button.entity || '?'})`;

      assert.equal(button.error, null, `${where}: ${button.error}`);

      // A call-service action without a real service silently does nothing in
      // production - catch it here instead.
      for (const kind of ['tap_action', 'hold_action', 'double_tap_action']) {
        const action = button[kind];
        if (action.action === 'call-service') {
          assert.match(action.service || '', /^[a-z_]+\.[a-z_]+$/, `${where} ${kind}: service`);
        }
        if (action.action === 'navigate') {
          assert.ok(action.navigation_path, `${where} ${kind}: navigation_path missing`);
        }
        if (action.action === 'url') {
          assert.ok(action.url_path || action.url, `${where} ${kind}: url_path missing`);
        }
        if (action.action === 'toggle' || action.action === 'more-info') {
          assert.ok(action.entity, `${where} ${kind}: no entity to act on`);
        }
      }

      // An animation type that fell back to 'none' means the example named a
      // type that does not exist. Not every item type animates.
      if (button.animation && button.animation.type === 'none') {
        const source = raw.items[index].animation ?? raw.animation;
        const requested = typeof source === 'object' ? source && source.type : source;
        assert.ok(
          requested === undefined || requested === 'none',
          `${where}: unknown animation type "${requested}"`,
        );
      }

      assert.ok(button.weight >= 1 && button.weight <= 6, `${where}: odd colspan`);
    });
  });
}
