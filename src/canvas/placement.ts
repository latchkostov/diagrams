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

/**
 * Where something added without a spot (a click in the stencil rail, the command palette) goes:
 * the free place nearest `center`, at least `margin` clear of every box in `others`, so it never
 * lands on a node or stacks on the last thing added. Candidates ring outward on a `step` grid;
 * when nothing is free within `maxRings`, the centre wins (the view is simply full).
 * Takes and returns the new element's centre.
 */
export function placeFree(
  center: { x: number; y: number },
  size: { width: number; height: number },
  others: readonly Box[],
  { margin = 32, step = 40, maxRings = 24 }: { margin?: number; step?: number; maxRings?: number } = {},
): { x: number; y: number } {
  const fits = (cx: number, cy: number) => {
    const b = {
      x: cx - size.width / 2 - margin,
      y: cy - size.height / 2 - margin,
      width: size.width + margin * 2,
      height: size.height + margin * 2,
    };
    return !others.some((o) => overlaps(b, o));
  };
  if (fits(center.x, center.y)) return center;
  for (let ring = 1; ring <= maxRings; ring++) {
    // Every grid point on this ring, nearest to the centre first (ties: above before below, left before right).
    const spots: { x: number; y: number; d: number }[] = [];
    for (let i = -ring; i <= ring; i++) {
      for (let j = -ring; j <= ring; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
        const x = center.x + i * step;
        const y = center.y + j * step;
        spots.push({ x, y, d: Math.hypot(i, j) });
      }
    }
    spots.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
    const hit = spots.find((s) => fits(s.x, s.y));
    if (hit) return { x: hit.x, y: hit.y };
  }
  return center;
}
