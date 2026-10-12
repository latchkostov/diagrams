// Where the "+" on a selected node sits (D3): pure geometry in screen pixels.

import type { Side } from "../../model/types";

/** Downstream first (right for left-to-right, bottom for top-to-bottom), then across, then upstream. */
export const CHIP_ORDER: Record<"LR" | "TB", Side[]> = {
  LR: ["right", "bottom", "top", "left"],
  TB: ["bottom", "right", "left", "top"],
};
/** On screen, at any zoom (the CSS scales by 1/zoom): the chip's size and its gap from the card. */
const CHIP = 20;
const GAP = 16;

export type Rect = { left: number; top: number; right: number; bottom: number };
const hits = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** Where the chip would sit on each side of `r` (screen px), padded a little so it never touches anything. */
export function chipRect(r: Rect, side: Side, pad = 4): Rect {
  const cx = (r.left + r.right) / 2;
  const cy = (r.top + r.bottom) / 2;
  const at = (x: number, y: number) => ({ left: x - pad, top: y - pad, right: x + CHIP + pad, bottom: y + CHIP + pad });
  if (side === "right") return at(r.right + GAP, cy - CHIP / 2);
  if (side === "left") return at(r.left - GAP - CHIP, cy - CHIP / 2);
  if (side === "bottom") return at(cx - CHIP / 2, r.bottom + GAP);
  return at(cx - CHIP / 2, r.top - GAP - CHIP);
}

/**
 * Where the chip goes: the first side, in `order`, whose chip touches none of `taken`. In a dense diagram every
 * side can be taken (a neighbour above and below, labels on both sides): then "corner", on the card's own
 * top-right corner, where nothing else ever is (edge labels sit above the nodes and would hide a chip off the
 * card).
 */
export function freeSide(card: Rect, taken: readonly Rect[], order: readonly Side[]): Side | "corner" {
  return order.find((s) => !taken.some((t) => hits(chipRect(card, s), t))) ?? "corner";
}
