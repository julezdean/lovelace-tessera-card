import { CARD_TAG } from '../const';
import type { Dict, HassEntity, HomeAssistant } from '../types';

/**
 * Fields can carry JavaScript, in the `[[[ ... ]]]` form that custom:button-card
 * established. Reusing that syntax rather than inventing one means a template
 * written for either card reads the same.
 *
 *   label: |
 *     [[[ return entity.state === 'on' ? entity.attributes.count : ''; ]]]
 *
 * A template that fills the whole string returns its value as-is, so it can
 * yield a boolean or a number. One embedded in surrounding text is substituted
 * into it.
 *
 * This is evaluated code from the dashboard's own configuration - the same
 * trade-off every templating card in this ecosystem makes.
 */
const TEMPLATE_PATTERN = /\[\[\[([\s\S]*?)\]\]\]/g;

export interface TemplateContext {
  entity: HassEntity | undefined;
  states: HomeAssistant['states'];
  user: HomeAssistant['user'];
  hass: HomeAssistant;
  variables: Dict;
}

type TemplateFn = (
  entity: TemplateContext['entity'],
  states: TemplateContext['states'],
  user: TemplateContext['user'],
  hass: TemplateContext['hass'],
  variables: TemplateContext['variables'],
) => unknown;

/** Compiled once per distinct template body; configs reuse the same strings. */
const templateCache = new Map<string, TemplateFn | null>();

export function hasTemplate(value: unknown): value is string {
  return typeof value === 'string' && value.includes('[[[');
}

function compileTemplate(body: string): TemplateFn | null {
  let fn = templateCache.get(body);
  if (fn === undefined) {
    try {
      fn = new Function('entity', 'states', 'user', 'hass', 'variables', body) as TemplateFn;
    } catch (err) {
      console.error(`${CARD_TAG}: template does not compile`, body, err);
      fn = null;
    }
    templateCache.set(body, fn);
  }
  return fn;
}

/**
 * Evaluate a value that may contain templates.
 *
 * A broken template yields undefined rather than taking the card down: one bad
 * expression should cost its own field, not the dashboard.
 */
export function renderTemplate(value: unknown, context: TemplateContext): unknown {
  if (!hasTemplate(value)) return value;

  // A single template filling the whole string returns its value as-is. The
  // match is greedy, so "[[[a]]] / [[[b]]]" would otherwise look like one
  // template whose body spans both - and that body is not valid JavaScript.
  const whole = value.trim().match(/^\[\[\[([\s\S]*)\]\]\]$/);
  if (whole && !whole[1].includes('[[[')) return runTemplate(whole[1], context);

  // Embedded: substitute each occurrence into the surrounding text.
  return value.replace(TEMPLATE_PATTERN, (_match, body: string) => {
    const result = runTemplate(body, context);
    return result === undefined || result === null ? '' : String(result);
  });
}

function runTemplate(body: string, context: TemplateContext): unknown {
  const fn = compileTemplate(body);
  if (!fn) return undefined;
  try {
    return fn(context.entity, context.states, context.user, context.hass, context.variables);
  } catch (err) {
    console.error(`${CARD_TAG}: template failed`, body.trim(), err);
    return undefined;
  }
}

/** The values a template can read. */
export function templateContext(
  hass: HomeAssistant,
  stateObj: HassEntity | undefined,
  variables?: Dict,
): TemplateContext {
  return {
    entity: stateObj,
    states: hass.states,
    user: hass.user,
    hass,
    variables: variables || {},
  };
}

/** Resolves one field; the identity when an item has no templates. */
export type Resolve = (value: unknown) => unknown;

export const identity: Resolve = (value) => value;
