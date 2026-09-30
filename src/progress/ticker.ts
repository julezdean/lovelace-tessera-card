// Copied from lovelace-advanced-countdown-card (src/core/ticker.ts) and kept
// identical, so that both cards can later share it as one package.

/**
 * One clock for every card on the page.
 *
 * Ten running countdowns would otherwise mean ten intervals drifting against
 * each other, each waking the page on its own. Here there is one timeout, and
 * it only exists while at least one card is listening.
 *
 * Each listener has a PHASE: the millisecond within the second at which its
 * display changes. A timer's finishes_at is not on a whole second (Home
 * Assistant writes it with microseconds), so a countdown ending at x.600 must
 * flip its digits at .600 every second. Ticking on the wall-clock second
 * instead would show every value up to a second too long -- including 00:00
 * arriving late. Listeners with the same phase share a wake-up.
 *
 * setTimeout rather than setInterval: an interval drifts by the time each
 * callback takes and never re-aligns. Re-aligning each tick costs nothing.
 *
 * Hidden tabs: nothing there is visible and browsers throttle timers anyway.
 * The ticker stops while the document is hidden and fires once immediately
 * when it becomes visible, so a card never shows a stale value after
 * switching back.
 */

export type TickListener = (now: number) => void;

interface Entry {
  listener: TickListener;
  phase: number;
  due: number;
}

/** Fire this long after the boundary, never a hair before it. */
const LATE_MS = 5;

export class Ticker {
  private readonly entries = new Set<Entry>();
  private timer?: ReturnType<typeof setTimeout>;
  private timerDue = Infinity;
  private visibilityBound = false;

  constructor(
    private readonly clock: () => number = () => Date.now(),
    private readonly doc: Document | undefined = typeof document === 'undefined'
      ? undefined
      : document,
  ) {}

  /** @param phaseMs ms within the second at which this listener's view changes. */
  subscribe(listener: TickListener, phaseMs = 0): () => void {
    const phase = ((Math.round(phaseMs) % 1000) + 1000) % 1000;
    const entry: Entry = {
      listener,
      phase,
      due: this.nextBoundary(this.clock(), phase),
    };
    this.entries.add(entry);
    this.bindVisibility();
    this.schedule();
    return () => {
      this.entries.delete(entry);
      if (!this.entries.size) this.stop();
    };
  }

  get size(): number {
    return this.entries.size;
  }

  get running(): boolean {
    return this.timer !== undefined;
  }

  private nextBoundary(now: number, phase: number): number {
    const into = (((now - phase) % 1000) + 1000) % 1000;
    return now - into + 1000 + LATE_MS;
  }

  private hidden(): boolean {
    return this.doc?.visibilityState === 'hidden';
  }

  private schedule(): void {
    if (!this.entries.size || this.hidden()) return;
    let due = Infinity;
    for (const entry of this.entries) due = Math.min(due, entry.due);
    if (this.timer !== undefined && due >= this.timerDue) return;
    this.stop();
    this.timerDue = due;
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        this.timerDue = Infinity;
        this.fire(false);
        this.schedule();
      },
      Math.max(0, due - this.clock()),
    );
  }

  private stop(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.timerDue = Infinity;
  }

  private fire(all: boolean): void {
    const now = this.clock();
    for (const entry of [...this.entries]) {
      if (!all && entry.due > now) continue;
      entry.due = this.nextBoundary(now, entry.phase);
      try {
        entry.listener(now);
      } catch (error) {
        // One broken card must not stop the clock for the others.
        console.error(error);
      }
    }
  }

  private readonly onVisibility = () => {
    if (this.hidden()) {
      this.stop();
    } else if (this.entries.size) {
      this.fire(true);
      this.schedule();
    }
  };

  private bindVisibility(): void {
    if (this.visibilityBound || !this.doc) return;
    this.doc.addEventListener('visibilitychange', this.onVisibility);
    this.visibilityBound = true;
  }
}

export const sharedTicker = new Ticker();
