import type { ProgressStatus } from './types';

/**
 * The progress types' own strings, in the languages the sibling countdown card
 * speaks. Everything Home Assistant already translates - entity states, unit
 * names through Intl - comes from there instead.
 */

export type ErrorReason =
  | 'no_entity'
  | 'entity_missing'
  | 'unavailable'
  | 'unknown_state'
  | 'invalid_timestamp'
  | 'invalid_number'
  | 'undetectable'
  | 'template_error';

type Key = ProgressStatus | `error_${ErrorReason}` | 'ends' | 'ended';

const EN: Record<Key, string> = {
  active: 'Running',
  paused: 'Paused',
  idle: 'Idle',
  finished: 'Finished',
  unknown: 'Unknown',
  ends: 'Ends {time}',
  ended: 'Ended {time}',
  error_no_entity: 'No entity configured',
  error_entity_missing: 'Entity not found',
  error_unavailable: 'Unavailable',
  error_unknown_state: 'No value yet',
  error_invalid_timestamp: 'Invalid timestamp',
  error_invalid_number: 'Not a number',
  error_undetectable: 'Cannot tell what this holds',
  error_template_error: 'Template error',
};

const DE: Record<Key, string> = {
  active: 'Läuft',
  paused: 'Pausiert',
  idle: 'Bereit',
  finished: 'Fertig',
  unknown: 'Unbekannt',
  ends: 'Endet {time}',
  ended: 'Beendet {time}',
  error_no_entity: 'Keine Entity konfiguriert',
  error_entity_missing: 'Entity nicht gefunden',
  error_unavailable: 'Nicht verfügbar',
  error_unknown_state: 'Noch kein Wert',
  error_invalid_timestamp: 'Ungültiger Zeitstempel',
  error_invalid_number: 'Keine Zahl',
  error_undetectable: 'Datentyp nicht erkennbar',
  error_template_error: 'Template-Fehler',
};

const TABLES: Record<string, Record<Key, string>> = { en: EN, de: DE };

export type Translate = (key: Key, vars?: Record<string, string>) => string;

export function translator(language: string | undefined): Translate {
  const base = (language ?? 'en').toLowerCase().split(/[-_]/)[0];
  const table = TABLES[base] ?? EN;
  return (key, vars) => {
    let text = table[key] ?? EN[key] ?? key;
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        text = text.replace(`{${name}}`, value);
      }
    }
    return text;
  };
}
