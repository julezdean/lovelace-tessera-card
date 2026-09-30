/**
 * The version lives in package.json and reaches the card through the build.
 * What the browser console reports is how anyone diagnoses which copy is
 * loaded, so the chain package.json -> CARD_VERSION -> bundle must hold.
 *
 * A tag is spent once pushed, so this has to fail here rather than after
 * someone installs a card that lies about its version.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { CARD_VERSION, CARD_TAG, REPO_URL } from '../src/main.ts';
import { BUNDLE } from '../vite.config.ts';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const pkg = JSON.parse(read('../package.json'));

test('CARD_VERSION is the version in package.json', () => {
  assert.equal(CARD_VERSION, pkg.version, `card says ${CARD_VERSION}, package.json says ${pkg.version}`);
});

test('the bundle is named after the card tag, and hacs.json points at it', () => {
  assert.equal(BUNDLE, `${CARD_TAG}.js`);
  const hacs = JSON.parse(read('../hacs.json'));
  assert.equal(hacs.filename, BUNDLE);
});

// Only meaningful after a build. `npm run check` builds before it tests, so
// there it always runs - against the bundle just built, never a stale one.
test('a built bundle carries the version', { skip: !existsSync(new URL(`../dist/${BUNDLE}`, import.meta.url)) }, () => {
  const bundle = read(`../dist/${BUNDLE}`);
  assert.ok(bundle.includes(`"${pkg.version}"`), `dist/${BUNDLE} does not contain ${pkg.version}`);
});

test('the repository URL is consistent across the card and package.json', () => {
  assert.equal(pkg.homepage, `${REPO_URL}#readme`);
  assert.equal(pkg.repository.url, `git+${REPO_URL}.git`);
  assert.equal(pkg.bugs.url, `${REPO_URL}/issues`);
});

test('the README documents the version the card reports', () => {
  const readme = read('../README.md');
  assert.ok(
    readme.includes(`v${CARD_VERSION}`),
    `README does not mention v${CARD_VERSION} - the install check is stale`,
  );
});
