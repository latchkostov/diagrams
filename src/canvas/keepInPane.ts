// Inline editors read at least at their CSS size at any zoom (scaled by 1/zoom below 100%), so zoomed out an
// editor is bigger than the thing it edits and can run past the canvas pane: under the inspector or the AI
// panel, or clipped by the pane's edge. This moves it back inside, by the least amount.

const MARGIN = 8;

/** The flow viewport's zoom (the scale React Flow applies to everything an editor sits in). */
function viewportZoom(el: Element): number {
  const vp = el.closest<HTMLElement>(".react-flow__viewport");
  const m = vp && /scale\(([\d.]+)\)/.exec(vp.style.transform);
  return m ? Number(m[1]) || 1 : 1;
}

/** The move (screen px, one axis) that brings [lo, hi] inside [min, max]; the start wins if it can't fit. */
export function clampShift(lo: number, hi: number, min: number, max: number): number {
  if (hi - lo > max - min || lo < min) return min - lo;
  if (hi > max) return max - hi;
  return 0;
}

/**
 * Moves an open editor (`el`, already scaled) inside the canvas pane with the `translate` property, which
 * applies outside the element's own transform and scale, in flow px. Returns the undo, for an element that stays
 * after editing (a zone's name chip).
 */
export function keepInPane(el: HTMLElement | null): () => void {
  const pane = el?.closest(".react-flow");
  if (!el || !pane) return () => {};
  const before = el.style.translate;
  // Frame title placement owns an existing translation in flow pixels. Add the
  // containment correction to that anchor rather than replacing it.
  const [x = 0, y = 0] = before ? before.split(/\s+/).map((value) => parseFloat(value) || 0) : [];
  let frame = 0;
  const update = () => {
    frame = 0;
    el.style.translate = before;
    const bounds = pane.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const dx = clampShift(r.left, r.right, bounds.left + MARGIN, bounds.right - MARGIN);
    const dy = clampShift(r.top, r.bottom, bounds.top + MARGIN, bounds.bottom - MARGIN);
    if (dx || dy) {
      const k = viewportZoom(el);
      el.style.translate = `${x + dx / k}px ${y + dy / k}px`;
    }
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  const viewport = el.closest(".react-flow__viewport");
  const moves = new MutationObserver(schedule);
  if (viewport) moves.observe(viewport, { attributes: true, attributeFilter: ["style"] });
  const sizes = new ResizeObserver(schedule);
  sizes.observe(pane);
  update();
  return () => {
    cancelAnimationFrame(frame);
    moves.disconnect();
    sizes.disconnect();
    el.style.translate = before;
  };
}
