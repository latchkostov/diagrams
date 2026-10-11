// Where a new node connected to an existing one goes: one gap downstream (or upstream) of it,
// stepping across until the spot is free. Shared by the command palette (add a connected stencil)
// and the live view's "Traffic into X" (an entry point in front of a node). Pure geometry.

const GAP_X = 80;
const GAP_Y = 40;
const MAX_TRIES = 12;

export type Box = { x: number; y: number; width: number; height: number };

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * Downstream is right of `from` (LR) or below it (TB); upstream is left of it or above it. The spot
 * steps across the flow (down for LR, right for TB) past any of `others` it would overlap.
 * Returns the new node's centre (what `editor.addNode` takes).
 */
export function placeNextTo(
  from: Box,
  size: { width: number; height: number },
  others: readonly Box[],
  direction: "LR" | "TB" = "LR",
  side: "downstream" | "upstream" = "downstream",
): { x: number; y: number } {
  const down = direction === "TB";
  const before = side === "upstream";
  let x = down
    ? from.x + from.width / 2 - size.width / 2
    : before
      ? from.x - GAP_X - size.width
      : from.x + from.width + GAP_X;
  let y = down
    ? before
      ? from.y - GAP_Y * 2 - size.height
      : from.y + from.height + GAP_Y * 2
    : from.y + from.height / 2 - size.height / 2;
  for (let i = 0; i < MAX_TRIES; i++) {
    const box = { x, y, ...size };
    if (!others.some((o) => overlaps(box, o))) break;
    if (down) x += size.width + GAP_X / 2;
    else y += size.height + GAP_Y;
  }
  return { x: x + size.width / 2, y: y + size.height / 2 };
}
