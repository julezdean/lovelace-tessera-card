import { CARD_TAG } from '../const';

export const CONDITIONS_TAG = 'ha-card-conditions-editor';
export const YAML_TAG = 'ha-yaml-editor';

interface CardHelpers {
  createCardElement?: (config: unknown) => Promise<HTMLElement> | HTMLElement;
}

declare global {
  interface Window {
    loadCardHelpers?: () => Promise<CardHelpers>;
  }
}

/**
 * Home Assistant defines its conditions editor lazily: it only reaches the
 * element registry once something that uses it has been loaded. Creating a
 * conditional card and asking for its config element is the documented way to
 * pull that in - `loadCardHelpers` is the supported entry point for it.
 *
 * Everything here is best-effort. If any step fails the editor falls back to
 * telling the user to write the conditions in YAML, which still works.
 */
let conditionsEditorReady: Promise<boolean> | null = null;
let yamlEditorReady: Promise<boolean> | null = null;

/**
 * `ha-yaml-editor` is what the `{}` button opens elsewhere in Lovelace. It is
 * usually already defined by the time a card editor is open, but not
 * guaranteed, so it is loaded the same way as the conditions editor.
 */
export function ensureYamlEditor(): Promise<boolean> {
  if (customElements.get(YAML_TAG)) return Promise.resolve(true);
  if (!yamlEditorReady) {
    yamlEditorReady = (async () => {
      try {
        if (typeof window === 'undefined' || !window.loadCardHelpers) return false;
        await window.loadCardHelpers();
        await customElements.whenDefined(YAML_TAG);
        return true;
      } catch (err) {
        console.warn(`${CARD_TAG}: could not load ${YAML_TAG}`, err);
        return false;
      }
    })();
  }
  return yamlEditorReady;
}

export function ensureConditionsEditor(): Promise<boolean> {
  if (customElements.get(CONDITIONS_TAG)) return Promise.resolve(true);

  if (!conditionsEditorReady) {
    conditionsEditorReady = (async () => {
      try {
        if (typeof window === 'undefined' || !window.loadCardHelpers) return false;
        const helpers = await window.loadCardHelpers();
        if (!helpers || !helpers.createCardElement) return false;

        const probe = await helpers.createCardElement({
          type: 'conditional',
          conditions: [],
          card: { type: 'button' },
        });
        const ctor = probe && (probe.constructor as { getConfigElement?: () => unknown });
        if (ctor && typeof ctor.getConfigElement === 'function') {
          await ctor.getConfigElement();
        }
        await customElements.whenDefined(CONDITIONS_TAG);
        return true;
      } catch (err) {
        console.warn(
          `${CARD_TAG}: could not load ${CONDITIONS_TAG}; ` +
            'visibility conditions stay editable in YAML.',
          err,
        );
        return false;
      }
    })();
  }
  return conditionsEditorReady;
}
