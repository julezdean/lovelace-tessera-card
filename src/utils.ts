export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function toNumber(value: unknown, fallback: number): number;
export function toNumber(value: unknown, fallback: undefined): number | undefined;
export function toNumber(value: unknown, fallback: number | undefined): number | undefined {
  const number = parseFloat(value as string);
  return Number.isFinite(number) ? number : fallback;
}

/** Accepts 12, "12", "12px", "1.5rem". */
export function cssLength(value: unknown, fallback: string): string {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'number') return `${value}px`;
  const text = String(value).trim();
  return /^[\d.]+$/.test(text) ? `${text}px` : text;
}

export function escapeHtml(text: unknown): string {
  const entities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return String(text).replace(/[&<>"']/g, (char) => entities[char]);
}

export function asList<T = unknown>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function domainOf(entityId: unknown): string {
  return typeof entityId === 'string' ? entityId.split('.')[0] : '';
}

export function isDict(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function fireEvent(node: EventTarget, type: string, detail: unknown = {}): Event {
  const event = new Event(type, { bubbles: true, cancelable: false, composed: true });
  (event as Event & { detail: unknown }).detail = detail;
  node.dispatchEvent(event);
  return event;
}
