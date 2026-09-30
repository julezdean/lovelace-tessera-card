/**
 * Ring, bar, segments and digits. They take the button's arrangement and its
 * colours: the fill is the accent while the item runs and the dimmed text
 * colour while it does not, exactly as a button's icon is.
 *
 * Strokes and clip-paths transition over one second, linearly - the length
 * of a tick - so a running countdown moves continuously instead of stepping,
 * without a single requestAnimationFrame.
 */
export const PROGRESS_STYLES = `
.btn.progress {
  /* The fill's colour: a threshold's or the gradient's, else the accent. */
  --tsr-fill: var(--tsr-progress, var(--tsr-accent));
  --tsr-track: rgba(255, 255, 255, 0.1);
  --tsr-track: color-mix(in srgb, var(--primary-text-color, #fff) 11%, transparent);
  --tsr-progress-transition: 1s linear;
}
.btn.progress:not(.active) { --tsr-fill: var(--tsr-text-dim); }
.btn.progress.active {
  border-color: rgba(255, 255, 255, 0.22);
  border-color: color-mix(in srgb, var(--tsr-fill) 30%, transparent);
}
.btn.progress.active .icon,
.btn.progress.active .inner-icon { color: var(--tsr-fill); }
.btn.progress.invalid .icon,
.btn.progress.invalid .inner-icon { color: var(--tsr-warn); }
.btn.progress.armed .icon,
.btn.progress.armed .inner-icon { color: var(--tsr-warn); }
.btn.progress.data-error .state { color: var(--tsr-warn); }

/* A progress item's name stays on one line: two would push the drawing
   off the height its row reserved for it. */
.btn.progress .name {
  -webkit-line-clamp: 1;
  line-clamp: 1;
}

/* Rows with a ring or digits give every icon the same room, so the names
   of the row line up wherever each cell's drawing ends. */
.row.reserve-visual .btn:not(.compact) > .icon,
.row.reserve-visual .btn.progress .visual.icon-slot {
  margin-block: calc((var(--tsr-visual-size) - var(--tsr-icon-size)) / 2);
}

.visual {
  position: relative;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  will-change: transform;
}
.visual.icon-slot {
  width: var(--tsr-icon-size);
  height: var(--tsr-icon-size);
}

/* --- show_drawing ------------------------------------------------------------ */

/* Without its drawing the item is a button: the icon in the drawing's place,
   at a button icon's size. The row keeps the room it reserved, so nothing
   in it moves when a timer starts or stops. */
.btn.progress.drawing-off .visual.ring svg,
.btn.progress.drawing-off .bar-track,
.btn.progress.drawing-off .segments-track { display: none; }
.btn.progress.drawing-off .visual.ring .inner-icon,
.btn.progress.drawing-off .visual.digits .icon {
  --mdc-icon-size: var(--tsr-icon-size);
  width: var(--tsr-icon-size);
  height: var(--tsr-icon-size);
}
.btn.progress.drawing-off .visual.digits .icon { display: flex; color: var(--tsr-icon-color, var(--tsr-text-dim)); }
.btn.progress.drawing-off.active .visual.digits .icon { color: var(--tsr-fill); }

/* --- ring ---------------------------------------------------------------- */

.visual.ring {
  width: var(--tsr-visual-size);
  height: var(--tsr-visual-size);
}
.visual.ring svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}
.visual.ring .track {
  fill: none;
  stroke: var(--tsr-track);
}
.visual.ring .fill {
  fill: none;
  stroke: var(--tsr-fill);
  transition:
    stroke-dashoffset var(--tsr-progress-transition),
    stroke 180ms ease,
    opacity 0.2s ease;
}
.btn.progress.indeterminate .visual.ring .fill { opacity: 0.45; }
.visual.ring .fill.empty { opacity: 0; }
.visual.ring .inner {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.visual.ring .inner-value {
  font-weight: 600;
  line-height: 1;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: var(--tsr-text);
}
.visual.ring .inner-icon {
  display: flex;
  color: var(--tsr-icon-color, var(--tsr-text-dim));
  /* Inside the ring's opening, whatever the thickness. */
  --mdc-icon-size: calc(var(--tsr-visual-size) * 0.42);
  width: calc(var(--tsr-visual-size) * 0.42);
  height: calc(var(--tsr-visual-size) * 0.42);
  transition: color 180ms ease;
}

/* --- bar and segments ------------------------------------------------------ */

/* Along the bottom of the cell, in its 10 px padding - out of the way of the
   icon and the text, which stay exactly where a button has them. In a row
   that reserves room for a ring the text reaches down to that padding, so
   the bar may not be thicker than the padding leaves, and is centred in it. */
.bar-track,
.segments-track {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: max(1px, calc((10px - var(--tsr-bar-size)) / 2 - 1px));
  height: var(--tsr-bar-size);
  display: flex;
  gap: 3px;
  pointer-events: none;
}
.segment {
  position: relative;
  flex: 1 1 0;
  border-radius: var(--tsr-bar-radius);
  background: var(--tsr-track);
  overflow: hidden;
}
.no-track .segment { background: transparent; }
.segment-fill {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: var(--tsr-fill);
  transition:
    clip-path var(--tsr-progress-transition),
    background 180ms ease;
}
.btn.progress.indeterminate .segment-fill { opacity: 0.45; }

/* --- digits ---------------------------------------------------------------- */

.visual.digits {
  height: var(--tsr-visual-size);
  max-width: 100%;
  font-weight: 600;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: var(--tsr-text);
}
.btn.progress:not(.active) .visual.digits { color: var(--tsr-text-dim); }
.digits-row {
  display: flex;
  align-items: center;
  gap: 0.08em;
  white-space: nowrap;
}
.digits-row.tiles .group {
  padding: 0.08em 0.12em;
  border-radius: 0.16em;
  background: rgba(255, 255, 255, 0.08);
  background: color-mix(in srgb, var(--tsr-fill) 16%, transparent);
  transition: background 180ms ease;
}
.digits-row .colon {
  color: var(--tsr-text-dim);
  font-weight: 400;
  transform: translateY(-0.06em);
}
.digits-row .sign,
.digits-row .unit {
  color: var(--tsr-text-dim);
  font-weight: 500;
  font-size: 0.45em;
  align-self: flex-end;
  margin-bottom: 0.2em;
}
.digits-row .unit:empty,
.digits-row .sign:empty { display: none; }
.digits-text {
  font-size: 0.5em;
  white-space: nowrap;
}

/* --- animations, on the drawing ------------------------------------------ */

.visual.anim { animation-duration: var(--tsr-anim-d); animation-iteration-count: infinite; }
.visual.anim-pulse   { animation-name: tsr-pulse;   animation-timing-function: cubic-bezier(0.4, 0, 0.6, 1); }
.visual.anim-breathe { animation-name: tsr-breathe; animation-timing-function: ease-in-out; }
.visual.anim-bounce  { animation-name: tsr-bounce;  animation-timing-function: cubic-bezier(0.3, 0, 0.4, 1); }
.visual.anim-spin    { animation-name: tsr-spin;    animation-timing-function: linear; }
.visual.anim-shake   { animation-name: tsr-shake;   animation-timing-function: ease-in-out; }
.visual.anim-glow    { animation-name: tsr-glow;    animation-timing-function: ease-in-out; color: var(--tsr-fill); }
.visual.anim-blink   { animation-name: tsr-blink;   animation-timing-function: steps(1, end); }
.visual.anim-wobble  { animation-name: tsr-wobble;  animation-timing-function: ease-in-out; }

@media (prefers-reduced-motion: reduce) {
  .visual.anim { animation: none !important; }
  .btn.progress { --tsr-progress-transition: 0s; }
}
`;
