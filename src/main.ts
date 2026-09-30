/**
 * Tessera Card
 * Buttons, countdowns, progress rings and graphs in one mosaic grid for Home
 * Assistant, tuned for wall-mounted dashboards.
 *
 * The card is a grid of items. It owns the grid and the cell each item sits
 * in - layout, surface, visibility, gestures - and an item type (see
 * src/items/) owns what is inside the cell.
 *
 *   config.ts          normalisation, inheritance, validation
 *   core/              state helpers, templates, visibility, layout, actions
 *   items/             the item types and their registry
 *   card/              the card element and its stylesheet
 *   editor/            the visual editor
 */
import { TesseraCard } from './card/card';
import { CARD_TAG, CARD_VERSION, EDITOR_TAG, REPO_URL } from './const';
import { TesseraCardEditor } from './editor/editor';

/**
 * Defines the element once, and says something useful when it cannot.
 *
 * A second Lovelace resource entry for the same card -- the usual cause is
 * adding `?v=2` as a NEW entry instead of editing the old one -- loads this
 * file twice. The second `customElements.define` throws NotSupportedError
 * partway through the module, so whichever copy loaded first wins and the
 * other silently does nothing. From the outside that looks exactly like
 * "I deployed the new file and nothing changed", which is why this warns
 * rather than returning quietly.
 *
 * @param announce Set on the card only. The editor would otherwise repeat the
 *   same message and bury it.
 */
function defineOnce(tag: string, element: CustomElementConstructor, announce = false): void {
  if (customElements.get(tag)) {
    if (announce) {
      console.warn(
        `[${tag}] is already registered, so this copy does nothing. You very ` +
          `likely have two Lovelace resource entries pointing at this card. ` +
          `Keep one under Settings > Dashboards > Resources and edit its ?v= ` +
          `instead of adding a second entry -- otherwise whichever copy loads ` +
          `first wins, and an update looks like it changed nothing.`,
      );
    }
    return;
  }
  customElements.define(tag, element);
}

interface CustomCardEntry {
  type: string;
  name: string;
  description: string;
  preview: boolean;
  documentationURL: string;
}

declare global {
  interface Window {
    customCards?: CustomCardEntry[];
  }
}

const inBrowser = typeof window !== 'undefined' && typeof customElements !== 'undefined';

if (inBrowser) {
  defineOnce(CARD_TAG, TesseraCard, true);
  defineOnce(EDITOR_TAG, TesseraCardEditor);

  window.customCards = window.customCards || [];
  if (!window.customCards.some((card) => card.type === CARD_TAG)) {
    window.customCards.push({
      type: CARD_TAG,
      name: 'Tessera Card',
      description:
        'Buttons, countdowns, progress rings and graphs in one mosaic grid with an automatic layout, tuned for wall-mounted dashboards.',
      preview: true,
      documentationURL: REPO_URL,
    });
  }

  console.info(
    `%c ${CARD_TAG} %c v${CARD_VERSION} `,
    'color:#fff;background:#4a9eff;font-weight:700;border-radius:3px 0 0 3px;padding:2px 6px',
    'color:#4a9eff;background:#2b2b2b;border-radius:0 3px 3px 0;padding:2px 6px',
  );
}

export { CARD_VERSION, CARD_TAG, REPO_URL, TesseraCard, TesseraCardEditor };
export { normalizeConfig } from './config';
export { renderTemplate, hasTemplate, templateContext } from './core/templates';
export { isVisible, conditionMet, collectMediaQueries } from './core/visibility';
export { animationActive } from './core/animation';
export { isActiveState, isUnavailable } from './core/state';
export {
  computeGridOptions,
  computeContentHeight,
  partitionRows,
  computeColumns,
  computeCellHeight,
} from './core/layout';
export {
  mergeOwnedKeys,
  pruneDefaults,
  actionToForm,
  actionFromForm,
  confirmationFromConfig,
} from './editor/transform';
export { CARD_FORM_KEYS, cardFormData, cardFormToConfig } from './editor/card-form';
export { BUTTON_FORM_KEYS } from './items/button/editor';
