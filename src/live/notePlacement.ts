// Where the narration card goes: next to the nodes it talks about, in the free space around them.
// Pure screen-space geometry (no DOM), so it's unit-tested directly.

export interface Box {
  l: number;
  t: number;
  r: number;
  b: number;
}

export type NotePlacement = "below" | "above" | "right" | "left";

export interface NotePosition {
  placement: NotePlacement;
  left: number;
  top: number;
  /** Where the pointer meets the card: x for below / above, y for left / right (card px). */
  arrow: number;
}

/** Clears the metric pill under the focused nodes. */
export const NOTE_GAP = 48;
const SIDE_GAP = 28;
const EDGE = 16;
/** The pointer stays this far from the card's corners. */
const ARROW_INSET = 24;
const ORDER: NotePlacement[] = ["below", "above", "right", "left"];
/** Slides along the focus, as fractions of the card size, nearest first. */
const SLIDES = [0, -0.25, 0.25, -0.5, 0.5];

const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * Picks the side of `focus` (below, above, right, left, in that order of preference) and the
 * slide along it where the card covers the least of the other nodes, never the focused ones if it
 * can help it. `pane` is the usable area (the control bar's reserve already taken off the bottom).
 * Null when the card fits nowhere beside the focus (the caller centres it instead).
 */
export function placeNote(
  focus: Box,
  card: { w: number; h: number },
  pane: { width: number; height: number },
  nodes: readonly Box[],
  focused: readonly Box[] = [],
): NotePosition | null {
  const { w, h } = card;
  const minX = EDGE;
  const maxX = pane.width - EDGE - w;
  const minY = EDGE;
  const maxY = pane.height - h;
  if (maxX < minX || maxY < minY) return null;
  const cx = (focus.l + focus.r) / 2;
  const cy = (focus.t + focus.b) / 2;
  let best: { pos: NotePosition; score: number } | null = null;
  for (const placement of ORDER) {
    const vertical = placement === "below" || placement === "above";
    for (const slide of SLIDES) {
      let left: number;
      let top: number;
      if (vertical) {
        top = placement === "below" ? focus.b + NOTE_GAP : focus.t - NOTE_GAP - h;
        if (top < minY || top > maxY) break;
        // The pointer must still reach the focus: keep its centre over the card.
        left = clamp(cx - w / 2 + slide * w, Math.max(minX, cx - w + ARROW_INSET), Math.min(maxX, cx - ARROW_INSET));
      } else {
        left = placement === "right" ? focus.r + SIDE_GAP : focus.l - SIDE_GAP - w;
        if (left < minX || left > maxX) break;
        top = clamp(cy - h / 2 + slide * h, Math.max(minY, cy - h + ARROW_INSET), Math.min(maxY, cy - ARROW_INSET));
      }
      if (left < minX - 0.5 || left > maxX + 0.5 || top < minY - 0.5 || top > maxY + 0.5) continue;
      const rect = { l: left - 8, t: top - 8, r: left + w + 8, b: top + h + 8 };
      let score = 0;
      for (const n of nodes) score += overlap(rect, n);
      for (const n of focused) score += 4 * overlap(rect, n);
      // Ties keep the earlier (preferred) candidate.
      if (!best || score < best.score - 1) {
        const arrow = vertical
          ? clamp(cx - left, ARROW_INSET, w - ARROW_INSET)
          : clamp(cy - top, ARROW_INSET, h - ARROW_INSET);
        best = { pos: { placement, left, top, arrow }, score };
      }
      // The first candidate that covers nothing is as good as it gets.
      if (best.score === 0) return best.pos;
    }
  }
  return best?.pos ?? null;
}
