// Where a new node connected to an existing one goes: one gap downstream (or upstream) of it,
// stepping across until the spot is free. Shared by the command palette (add a connected stencil)
// and the live view's "Traffic into X" (an entry point in front of a node). Pure geometry.

const GAP_X = 80;
const GAP_Y = 40;
const MAX_TRIES = 12;

export type Box = { x: number; y: number; width: number; height: number };

export const overlaps = (a: Box, b: Box) =>
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
  opts: { margin?: number; step?: number; maxRings?: number } = {},
): { x: number; y: number } {
  return findFree(center, size, others, opts) ?? center;
}

/**
 * The search behind `placeFree`, with failure made explicit: the free centre nearest `center` within
 * `maxRings` steps, or null when every candidate is taken.
 */
export function findFree(
  center: { x: number; y: number },
  size: { width: number; height: number },
  others: readonly Box[],
  { margin = 32, step = 40, maxRings = 24 }: { margin?: number; step?: number; maxRings?: number } = {},
): { x: number; y: number } | null {
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
  return null;
}

/** The box around all of `boxes`, or null when there are none. */
export function boundsOf(boxes: readonly Box[]): Box | null {
  if (!boxes.length) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const b of boxes) {
    x1 = Math.min(x1, b.x);
    y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.width);
    y2 = Math.max(y2, b.y + b.height);
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** True when `box`, grown by `margin` on every side, touches none of `others`. */
export function isClear(box: Box, others: readonly Box[], margin = 0): boolean {
  const grown = {
    x: box.x - margin,
    y: box.y - margin,
    width: box.width + margin * 2,
    height: box.height + margin * 2,
  };
  return !others.some((o) => overlaps(grown, o));
}

/** Room kept between a copy and anything else (flow px): the copy reads as its own thing. */
export const COPY_MARGIN = 16;

/**
 * Where a copy of `box` goes when it has no spot of its own (Ctrl+D): one gap beside it, in the flow
 * direction first, then across it, then the other two sides; if all four are taken, the free place
 * nearest the first. Returns how far to move the copy from `box`. `others` must include the
 * originals, so the copy never lands on them.
 */
export function placeCopy(box: Box, others: readonly Box[], direction: "LR" | "TB" = "LR"): { x: number; y: number } {
  // One gap away: downstream first, then across the flow (a sibling, the usual "another one like
  // this"), then the other side and upstream. The first spot that's clear wins.
  const gx = GAP_X / 2 + box.width;
  const gy = GAP_Y + box.height;
  const right = { x: gx, y: 0 };
  const below = { x: 0, y: gy };
  const order =
    direction === "TB"
      ? [below, right, { x: -gx, y: 0 }, { x: 0, y: -gy }]
      : [right, below, { x: 0, y: -gy }, { x: -gx, y: 0 }];
  for (const d of order) if (isClear({ ...box, x: box.x + d.x, y: box.y + d.y }, others, COPY_MARGIN)) return d;
  // All four taken: the free place nearest the downstream spot, else past everything (never on top).
  const first = order[0];
  return clearOffset({ ...box, x: box.x + first.x, y: box.y + first.y }, others, { ...first });
}

/** Search step for a box this size: finer for small boxes, coarser (so it reaches further) for big ones. */
const stepFor = (box: Box) => Math.max(20, Math.ceil(Math.max(box.width, box.height) / 200) * 10);

/**
 * The guaranteed fallback when the search finds nothing: the box moved right of everything in `others`
 * (by the copy margin), at the same height. Returns how far to move it.
 */
export function pastAll(box: Box, others: readonly Box[]): { x: number; y: number } {
  const all = boundsOf(others);
  if (!all) return { x: 0, y: 0 };
  return { x: Math.max(0, all.x + all.width + COPY_MARGIN * 2 - box.x), y: 0 };
}

/**
 * Keeps a copy that has a wanted spot (the pointer for Ctrl+V, the drop of an Alt-drag) off everything
 * else: `box` already at that spot stays when it's clear, otherwise it moves to the free place nearest
 * it, or past everything when the search runs out. Never returns an overlapping spot. Returns how far
 * to move it from where it is (`base` added, zero when it's clear).
 */
export function clearOffset(
  box: Box,
  others: readonly Box[],
  base: { x: number; y: number } = { x: 0, y: 0 },
): { x: number; y: number } {
  if (isClear(box, others, COPY_MARGIN)) return base;
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const spot = findFree(c, box, others, { margin: COPY_MARGIN, step: stepFor(box), maxRings: 40 });
  // The search ran out (a huge copy, a crowded view): past everything rather than on top of it.
  const d = spot ? { x: spot.x - c.x, y: spot.y - c.y } : pastAll(box, others);
  return { x: base.x + d.x, y: base.y + d.y };
}
