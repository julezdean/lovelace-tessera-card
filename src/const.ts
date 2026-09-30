/**
 * The version comes from package.json through the build, so there is one place
 * to change it. test/version.test.js checks that the built bundle carries it.
 */
declare const __CARD_VERSION__: string;

export const CARD_VERSION = __CARD_VERSION__;

/**
 * The repository is prefixed, the card tag is not: the prefix groups the repo
 * among Lovelace cards, while `type: custom:...` is typed by every user and
 * stays as short as it can be. The CSS custom properties use a shorter prefix
 * again (--tsr-), which keeps the stylesheet readable.
 */
export const CARD_TAG = 'tessera-card';
export const EDITOR_TAG = `${CARD_TAG}-editor`;
export const REPO_URL = 'https://github.com/julezdean/lovelace-tessera-card';

export const HOLD_DELAY_MS = 500;
export const DOUBLE_TAP_WINDOW_MS = 250;
export const CONFIRM_TIMEOUT_MS = 4000;
/** How long a stateless entity reads as active after it was triggered. */
export const PRESS_FLASH_MS = 1000;

/** Built-in confirmation prompts, per gesture. A tap confirms, whatever armed it. */
export const CONFIRM_TEXT = {
  tap: 'Tap again to confirm',
  hold: 'Tap to confirm',
  double_tap: 'Tap to confirm',
} as const;

/** Above this a touch target cannot survive, whatever the config says. */
export const COLUMN_LIMIT = 12;

/**
 * Home Assistant's sections view lays cards out on a grid of fixed rows, so a
 * card has to say how many rows it needs. These two numbers come from HA's own
 * grid (2024.11+) and are the one place here that depends on HA internals -
 * if they ever change, the card is merely sized generously or tightly, never
 * broken.
 */
export const HA_GRID_ROW_HEIGHT = 56;
export const HA_GRID_ROW_GAP = 8;

/**
 * The width of a full-width section column, used only to guess a sensible row
 * count before the card has ever been measured. Being wrong here costs some
 * slack above or below, not a broken layout: the host takes whatever height
 * the cell gives it and the rows flex into it.
 */
export const HA_SECTION_WIDTH = 480;
