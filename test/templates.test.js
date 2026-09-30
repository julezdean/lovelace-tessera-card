/**
 * Templates are evaluated JavaScript from the config. These cover the contract
 * around that: what a template can see, what happens when one throws, and that
 * a field without one is left completely alone.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { renderTemplate, hasTemplate, templateContext, normalizeConfig } from '../src/main.ts';

const hass = {
  states: {
    'light.a': { entity_id: 'light.a', state: 'on', attributes: { count: 3 } },
    'sensor.b': { entity_id: 'sensor.b', state: '21.5', attributes: {} },
  },
  user: { id: 'u1', name: 'Ich' },
};
const ctx = (entityId = 'light.a', variables) =>
  templateContext(hass, hass.states[entityId], variables);
const run = (value, context = ctx()) => renderTemplate(value, context);

test('a plain string is returned untouched', () => {
  assert.equal(run('just text'), 'just text');
  assert.equal(hasTemplate('just text'), false);
});

test('non-strings pass straight through', () => {
  assert.equal(run(42), 42);
  assert.equal(run(true), true);
  assert.equal(run(null), null);
  assert.deepEqual(run({ on: 'mdi:a' }), { on: 'mdi:a' });
});

test('a whole-string template keeps its return type', () => {
  assert.equal(run('[[[ return 42 ]]]'), 42);
  assert.equal(run('[[[ return true ]]]'), true);
  assert.equal(run('[[[ return entity.attributes.count ]]]'), 3);
});

test('an embedded template is substituted into the text', () => {
  assert.equal(run('Status: [[[ return entity.state ]]] now'), 'Status: on now');
});

test('several embedded templates all resolve', () => {
  assert.equal(
    run('[[[ return entity.state ]]] / [[[ return entity.attributes.count ]]]'),
    'on / 3',
  );
});

test('an embedded template returning nothing yields an empty string', () => {
  assert.equal(run('a[[[ return undefined ]]]b'), 'ab');
  assert.equal(run('a[[[ return null ]]]b'), 'ab');
});

test('states, user, hass and variables are reachable', () => {
  assert.equal(run('[[[ return Object.keys(states).length ]]]'), 2);
  assert.equal(run('[[[ return user.name ]]]'), 'Ich');
  assert.equal(run('[[[ return hass.user.id ]]]'), 'u1');
  assert.equal(run('[[[ return variables.x ]]]', ctx('light.a', { x: 7 })), 7);
});

test('a template that throws yields undefined rather than propagating', () => {
  assert.equal(run('[[[ return entity.nope.nope ]]]'), undefined);
  assert.equal(run('[[[ throw new Error("boom") ]]]'), undefined);
});

test('a template that does not compile yields undefined', () => {
  assert.equal(run('[[[ this is ( not javascript ]]]'), undefined);
});

test('a template without a return yields undefined, not a crash', () => {
  assert.equal(run('[[[ const x = 1; ]]]'), undefined);
});

test('a button is flagged as templated only when it actually is', () => {
  const plain = normalizeConfig({ items: [{ name: 'a', label: 'b' }] });
  assert.equal(plain.items[0].hasTemplates, false);

  const templated = normalizeConfig({ items: [{ name: '[[[ return 1 ]]]' }] });
  assert.equal(templated.items[0].hasTemplates, true);
});

test('a template inside a state-keyed icon map is detected', () => {
  const config = normalizeConfig({
    items: [{ icon: { on: '[[[ return "mdi:a" ]]]', off: 'mdi:b' } }],
  });
  assert.equal(config.items[0].hasTemplates, true);
});

test('a template in style counts as templated', () => {
  const config = normalizeConfig({ items: [{ style: '[[[ return "opacity: 0.5" ]]]' }] });
  assert.equal(config.items[0].hasTemplates, true);
});

test('entity and colspan are not template fields', () => {
  // They are listed as non-templated on purpose; a template there would be
  // taken literally rather than evaluated.
  const config = normalizeConfig({
    items: [{ entity: '[[[ return "light.a" ]]]', colspan: 1 }],
  });
  assert.equal(config.items[0].hasTemplates, false);
});

test('the card keeps its variables block for the templates', () => {
  // normalizeConfig used to drop it, so `variables` was always {} in a
  // template although the README promised the card's block.
  assert.deepEqual(normalizeConfig({ variables: { x: 7 }, items: [{}] }).variables, { x: 7 });
  assert.deepEqual(normalizeConfig({ items: [{}] }).variables, {});
});

test('an entity-less button gets an undefined entity, not an error', () => {
  const context = templateContext(hass, undefined);
  assert.equal(renderTemplate('[[[ return entity === undefined ]]]', context), true);
});
