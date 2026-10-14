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
  const pane = el?.closest(".react-flow")?.getBoundingClientRect();
  if (!el || !pane) return () => {};
  const before = el.style.translate;
  const r = el.getBoundingClientRect();
  const dx = clampShift(r.left, r.right, pane.left + MARGIN, pane.right - MARGIN);
  const dy = clampShift(r.top, r.bottom, pane.top + MARGIN, pane.bottom - MARGIN);
  if (dx || dy) {
    const k = viewportZoom(el);
    el.style.translate = `${dx / k}px ${dy / k}px`;
  }
  return () => {
    el.style.translate = before;
  };
}
