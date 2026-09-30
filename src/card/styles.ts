/**
 * The card and the cell every item sits in. What an item type puts inside its
 * cell is styled by the type (see ItemType.styles) and inserted between the
 * two parts, so a type can refine the cell rules and the tail still wins.
 */
export const CARD_STYLES = `:host {
  display: block;
}

/* Every button hidden by its conditions: the card removes itself from the
   dashboard rather than leaving an empty surface, the way a conditional card
   does. Set on the host, so it also collapses the sections grid cell. */
:host(.tsr-hidden) {
  display: none;
}

:host {
  /* The host must take the height it is given, or it silently falls back to
     its content height: in a sections grid cell that makes the card overflow
     a short cell and leave a gap in a tall one. With no constraint from the
     parent -- masonry, a panel -- 100% resolves to auto and nothing changes. */
  height: 100%;

  /* Button surfaces. The card surface itself is ha-card's business. */
  /* Each pair: a plain rgba fallback first, then the color-mix refinement.
     Wall tablets often run old webviews, where the second line is dropped. */
  --tsr-btn-bg: rgba(255, 255, 255, 0.06);
  --tsr-btn-bg: color-mix(in srgb, var(--primary-text-color, #fff) 6%, transparent);
  --tsr-btn-bg-hover: rgba(255, 255, 255, 0.1);
  --tsr-btn-bg-hover: color-mix(in srgb, var(--primary-text-color, #fff) 10%, transparent);
  --tsr-btn-border: rgba(255, 255, 255, 0.09);
  --tsr-btn-border: color-mix(in srgb, var(--primary-text-color, #fff) 9%, transparent);

  /* Accent - one colour, used sparingly. The tint stays low on purpose: with
     most buttons active the card must not turn into a block of colour. The
     icon carries the state; the surface only hints at it. */
  --tsr-accent: var(--state-active-color, var(--primary-color, #4a9eff));
  /* The active surface stays almost neutral - a tinted surface turns muddy
     once the accent is warm, and with many buttons on it dominates the card.
     Colour lives on the icon and the hairline, which is where it informs. */
  --tsr-accent-soft: rgba(255, 255, 255, 0.14);
  --tsr-accent-soft: color-mix(in srgb, var(--primary-text-color, #fff) 14%, transparent);
  /* Note: the accent hairline is NOT derived here. A custom property is
     substituted where it is declared, so mixing it on :host would freeze it to
     the card's accent - a button setting its own --tsr-accent would colour its
     icon but not its outline. The mix happens on .btn.active instead. */

  --tsr-text: var(--primary-text-color, #f5f5f7);
  --tsr-text-dim: var(--secondary-text-color, #a1a1a6);
  --tsr-warn: var(--error-color, #ff5f56);

  /* Written by the layout engine. */
  --tsr-gap: 12px;
  --tsr-cell-h: 120px;
  --tsr-btn-radius: 18px;
  --tsr-icon-size: 30px;
  --tsr-name-size: 14px;
  --tsr-anim-i: 1;
  --tsr-anim-d: 2s;
}

/* ha-card supplies background, radius, border and shadow from the theme.
   Only layout is set here. */
ha-card.card {
  box-sizing: border-box;
  padding: var(--tsr-pad, 14px);
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.title {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--tsr-text);
  margin: 2px 4px 12px;
  flex: 0 0 auto;
}

/* --- Layout ------------------------------------------------------------- */

.grid {
  display: flex;
  flex-direction: column;
  gap: var(--tsr-gap);
  height: 100%;          /* resolves to auto in an unconstrained parent */
  justify-content: center;
  min-height: 0;
}

.row {
  /* Grid, not flex: a weight-2 button has to be exactly as wide as two
     weight-1 buttons plus the gap between them, and flex cannot express that.
     Sharing out free space by flex-grow ignores that a row of two elements has
     one gap where a row of three has two, and the obvious correction --
     putting the swallowed gap into flex-basis -- does nothing, because with
     box-sizing: border-box a basis below padding + border is silently raised
     to it. A 'span 2' over equal 1fr tracks is the property we want. */
  display: grid;
  grid-auto-flow: column;
  gap: var(--tsr-gap);
  /* Basis is the height the width suggests; the row may grow into a taller
     cell and shrink into a shorter one, but never below the touch-target
     floor. Pinning min-height to the cell height instead made the card unable
     to render at the size its own min_rows advertises. */
  flex: 1 1 var(--tsr-cell-h);
  min-height: var(--tsr-row-min, 88px);
  /* Cap the growth so a very tall container does not stretch buttons into slabs. */
  max-height: calc(var(--tsr-cell-h) * 1.45);
}

/* --- Button ------------------------------------------------------------- */

.btn[hidden] { display: none; }

.btn {
  position: relative;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 12px;

  box-sizing: border-box;
  border: 1px solid var(--tsr-btn-border);
  border-radius: var(--tsr-btn-radius);
  /* --tsr-btn-custom-bg is set only when the config gives this button a
     colour of its own, so the active rule below can tell "configured" from
     "left at the default" and fall back accordingly. */
  background: var(--tsr-btn-custom-bg, var(--tsr-btn-bg));
  color: var(--tsr-text);

  font-family: inherit;
  text-align: center;
  cursor: pointer;
  overflow: hidden;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  user-select: none;

  transition:
    background-color 180ms cubic-bezier(0.2, 0, 0.2, 1),
    border-color 180ms cubic-bezier(0.2, 0, 0.2, 1),
    transform 120ms cubic-bezier(0.2, 0, 0.2, 1),
    box-shadow 220ms cubic-bezier(0.2, 0, 0.2, 1);
}

.btn:focus-visible {
  outline: 2px solid var(--tsr-accent);
  outline-offset: 2px;
}

/* Pointer devices only - the wall tablet must not depend on hover.
   An overlay rather than another background: a button with a configured
   colour would otherwise lose it on hover. */
@media (hover: hover) {
  .btn:hover::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: rgba(255, 255, 255, 0.045);
    pointer-events: none;
  }
}

/* Press feedback: fast in, slightly slower out. */
.btn.pressed { transition-duration: 70ms; }
.btn.pressed.effect-scale { transform: scale(0.968); }
.btn.pressed.effect-fade { filter: brightness(1.18); }

/* Active state: tinted surface, accent hairline, a whisper of glow. */
.btn.active {
  /* A button with its own colour keeps it while active - the active state is
     carried by the icon and the hairline. It only turns into the generic
     active tint when no colour was configured at all. */
  background: var(--tsr-btn-active-bg, var(--tsr-btn-custom-bg, var(--tsr-accent-soft)));
  /* Mixed here, so --tsr-accent resolves against this button - including one
     set per button or produced by a template. */
  border-color: rgba(255, 255, 255, 0.22);
  border-color: color-mix(in srgb, var(--tsr-accent) 30%, transparent);
}
.btn.active .name { color: var(--tsr-text); }

.btn.unavailable {
  opacity: 0.42;
  cursor: default;
}
.btn.invalid {
  border-style: dashed;
  border-color: color-mix(in srgb, var(--tsr-warn) 55%, transparent);
}

/* Two-step confirmation: the armed state must be unmistakable. */
.btn.armed {
  border-color: var(--tsr-warn);
  background: color-mix(in srgb, var(--tsr-warn) 14%, transparent);
}

/* --- Name and state line, shared by every item type -------------------- */

.labels {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 0;
  width: 100%;
}

.name {
  font-size: var(--tsr-name-size);
  font-weight: var(--tsr-name-weight, 550);
  line-height: 1.2;
  letter-spacing: 0.005em;
  color: var(--tsr-text);
  max-width: 100%;
  /* Up to two lines, then an ellipsis. A single clipped line turns a name into
     a fragment like "Ha..." that says less than nothing; wrapping keeps it
     readable in the narrow columns where this actually happens. */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  /* A word too long for the cell is split at a syllable, in the page's
     language - Home Assistant sets it - rather than anywhere: "Wohnzim-mer",
     not "Wohnzimm / er". Where the browser knows no hyphenation for the
     language, break-word still keeps the word inside the cell. */
  -webkit-hyphens: auto;
  hyphens: auto;
  overflow-wrap: break-word;
}

/* When any button in a row shows a state line, every button in THAT row
   reserves the space for it - otherwise icons and names of neighbouring
   buttons sit at different heights and the row reads as ragged. Rows without
   a state line stay vertically centred, so nothing is padded for nothing. */
.row.reserve-state .state {
  display: block !important;
  min-height: 1.2em;
}

.state {
  /* One line: a state is short, and a wrapped value reads worse than a
     shortened one. */
  /* Two px under the name unless label_size says otherwise. */
  font-size: var(--tsr-label-size, calc(var(--tsr-name-size) - 2px));
  font-weight: var(--tsr-label-weight, 400);
  line-height: 1.2;
  color: var(--tsr-text-dim);
  font-variant-numeric: tabular-nums;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
`;

export const CARD_STYLES_TAIL = `
/* --- Animation keyframes, shared by every type -------------------------- */
/* One set per animation; --tsr-anim-i scales the amplitude so a single
   definition covers every intensity without generating CSS at runtime.     */

@keyframes tsr-pulse {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(calc(1 + 0.11 * var(--tsr-anim-i))); }
}
@keyframes tsr-breathe {
  0%, 100% { transform: scale(1);                                   opacity: calc(1 - 0.28 * var(--tsr-anim-i)); }
  50%      { transform: scale(calc(1 + 0.06 * var(--tsr-anim-i)));  opacity: 1; }
}
@keyframes tsr-bounce {
  0%, 55%, 100% { transform: translateY(0); }
  25%           { transform: translateY(calc(-14% * var(--tsr-anim-i))); }
  40%           { transform: translateY(calc(-5% * var(--tsr-anim-i))); }
}
@keyframes tsr-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
@keyframes tsr-shake {
  0%, 100%      { transform: translateX(0); }
  20%, 60%      { transform: translateX(calc(-9% * var(--tsr-anim-i))); }
  40%, 80%      { transform: translateX(calc(9% * var(--tsr-anim-i))); }
}
@keyframes tsr-glow {
  0%, 100% { filter: drop-shadow(0 0 0 transparent); }
  50%      { filter: drop-shadow(0 0 calc(7px * var(--tsr-anim-i)) currentColor); }
}
@keyframes tsr-blink {
  0%, 49%   { opacity: 1; }
  50%, 100% { opacity: calc(1 - 0.75 * var(--tsr-anim-i)); }
}
@keyframes tsr-wobble {
  0%, 100% { transform: rotate(0deg); }
  25%      { transform: rotate(calc(-7deg * var(--tsr-anim-i))); }
  75%      { transform: rotate(calc(7deg * var(--tsr-anim-i))); }
}

/* --- show_icon: false ------------------------------------------------------ */
/* The icon and its room go; name and state line move to the middle. */
.btn.no-icon > .icon,
.btn.no-icon .visual.icon-slot,
.btn.no-icon .inner-icon,
.btn.no-icon .graph-head .icon { display: none !important; }
/* A ring without its drawing is only its icon - without that, nothing. */
.btn.no-icon.drawing-off .visual.ring,
.btn.no-icon.drawing-off .visual.digits { display: none; }

/* --- Reduced motion ----------------------------------------------------- */

@media (prefers-reduced-motion: reduce) {
  .btn { transition-duration: 1ms; }
  .btn.pressed.effect-scale { transform: none; filter: brightness(1.2); }
}

/* --- Error card --------------------------------------------------------- */

.error {
  box-sizing: border-box;
  background: var(--ha-card-background, var(--card-background-color, #1c1c1e));
  border: 1px solid var(--tsr-warn);
  border-radius: var(--ha-card-border-radius, 12px);
  padding: 16px;
  color: var(--tsr-text);
  font-size: 14px;
  line-height: 1.5;
}
.error code { color: var(--tsr-warn); }
`;
