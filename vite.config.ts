import { defineConfig } from 'vitest/config';
import pkg from './package.json' with { type: 'json' };

/**
 * One self-contained ESM file. Home Assistant loads it as a single Lovelace
 * resource and HACS ships exactly one file, so nothing may be left as a
 * separate chunk or an external import.
 *
 * The file name is the card tag, not the package name: the repository is
 * prefixed (lovelace-...), the card and its file are not, and hacs.json points
 * at this name. test/version.test.js keeps the three in step.
 */
export const BUNDLE = 'tessera-card.js';

export default defineConfig({
  build: {
    target: 'es2021',
    lib: {
      entry: 'src/main.ts',
      formats: ['es'],
      fileName: () => BUNDLE,
    },
    rollupOptions: {
      external: [],
      output: { inlineDynamicImports: true },
    },
    // Not minified: the card used to ship as readable source, and a stack
    // trace from a wall tablet is only useful if it can be read.
    minify: false,
    sourcemap: false,
    emptyOutDir: true,
  },
  define: {
    __CARD_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    include: ['test/**/*.test.js'],
  },
});
