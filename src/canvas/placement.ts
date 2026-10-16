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
 * The gap along the flow for nodes added by hand (Alt+arrow, the "+", Ctrl+K and the rail after a selected
 * node): room for a named edge's label between the cards, as in the examples.
 */
export const FLOW_GAP = 160;

/** A side of a node, as the arrow keys name it: Alt+→ adds the next node to the right, and so on. */
export type Toward = "right" | "left" | "down" | "up";

/** → and ↓ add downstream (the new node is fed by the selected one); ← and ↑ add upstream (it feeds it). */
export const isDownstream = (t: Toward) => t === "right" || t === "down";

/** The side downstream (or upstream) lies on in a diagram of this direction. */
export const towardOf = (direction: "LR" | "TB" = "LR", side: "downstream" | "upstream" = "downstream"): Toward =>
  direction === "TB" ? (side === "upstream" ? "up" : "down") : side === "upstream" ? "left" : "right";

/**
 * One gap from `from` on its `toward` side (`gap` to the left or right, 80 above or below), centred on it
 * across that axis. When the spot is taken (it overlaps one of `others`, grown by `margin`) it steps across:
 * down for a left or right spot, right for one above or below, so a fan-out reads as a column (or a row).
 * Returns the new box's centre.
 */
export function placeToward(
  from: Box,
  size: { width: number; height: number },
  others: readonly Box[],
  toward: Toward,
  margin = 0,
  gap = GAP_X,
): { x: number; y: number } {
  const across = toward === "right" || toward === "left";
  let x = across
    ? toward === "left"
      ? from.x - gap - size.width
      : from.x + from.width + gap
    : from.x + from.width / 2 - size.width / 2;
  let y = across
    ? from.y + from.height / 2 - size.height / 2
    : toward === "up"
      ? from.y - GAP_Y * 2 - size.height
      : from.y + from.height + GAP_Y * 2;
  for (let i = 0; i < MAX_TRIES; i++) {
    if (isClear({ x, y, ...size }, others, margin)) break;
    if (across) y += size.height + GAP_Y;
    else x += size.width + GAP_X / 2;
  }
  return { x: x + size.width / 2, y: y + size.height / 2 };
}

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
  return placeToward(from, size, others, towardOf(direction, side));
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
  const box = { x: center.x - size.width / 2, y: center.y - size.height / 2, ...size };
  const d = findClearTranslation([box], others, { margin, step, maxRings });
  return d && { x: center.x + d.x, y: center.y + d.y };
}

/**
 * The obstacles of one search, indexed once on a grid of `cell`-sized buckets (by index into flat
 * coordinate arrays), so a test looks only at the obstacles near a box and allocates nothing. An obstacle
 * spanning too many cells goes in a short list that's always checked.
 */
class ObstacleIndex {
  private readonly x1: Float64Array;
  private readonly y1: Float64Array;
  private readonly x2: Float64Array;
  private readonly y2: Float64Array;
  private readonly cells = new Map<number, number[]>();
  private readonly wide: number[] = [];
  /** Box-against-obstacle tests made so far (the search's work). */
  tests = 0;
  constructor(
    others: readonly Box[],
    private readonly cell: number,
  ) {
    const n = others.length;
    this.x1 = new Float64Array(n);
    this.y1 = new Float64Array(n);
    this.x2 = new Float64Array(n);
    this.y2 = new Float64Array(n);
    others.forEach((o, i) => {
      this.x1[i] = o.x;
      this.y1[i] = o.y;
      this.x2[i] = o.x + o.width;
      this.y2[i] = o.y + o.height;
      const cx1 = Math.floor(o.x / cell);
      const cy1 = Math.floor(o.y / cell);
      const cx2 = Math.floor((o.x + o.width) / cell);
      const cy2 = Math.floor((o.y + o.height) / cell);
      if (![cx1, cy1, cx2, cy2].every(Number.isSafeInteger) || (cx2 - cx1 + 1) * (cy2 - cy1 + 1) > 64) {
        this.wide.push(i);
        return;
      }
      for (let cx = cx1; cx <= cx2; cx++)
        for (let cy = cy1; cy <= cy2; cy++) {
          const k = this.key(cx, cy);
          const list = this.cells.get(k);
          if (list) list.push(i);
          else this.cells.set(k, [i]);
        }
    });
  }
  private key(cx: number, cy: number) {
    return cx * 1_000_003 + cy;
  }
  private hitsOne(i: number, x1: number, y1: number, x2: number, y2: number, limit: number) {
    if (this.tests >= limit) return undefined;
    this.tests++;
    return x1 < this.x2[i] && this.x1[i] < x2 && y1 < this.y2[i] && this.y1[i] < y2;
  }
  /** True on overlap, false when clear, undefined when the obstacle-test budget runs out. */
  hits(x1: number, y1: number, x2: number, y2: number, limit: number): boolean | undefined {
    for (const i of this.wide) {
      const hit = this.hitsOne(i, x1, y1, x2, y2, limit);
      if (hit !== false) return hit;
    }
    const c = this.cell;
    const cx1 = Math.floor(x1 / c);
    const cy1 = Math.floor(y1 / c);
    const cx2 = Math.floor(x2 / c);
    const cy2 = Math.floor(y2 / c);
    // Candidate boundaries can cover arbitrarily much empty space. Query at most
    // 64 grid cells; larger/unsafe ranges scan the finite obstacle arrays instead.
    // These comparisons count toward the same search budget as indexed obstacles.
    if (![cx1, cy1, cx2, cy2].every(Number.isSafeInteger) || (cx2 - cx1 + 1) * (cy2 - cy1 + 1) > 64) {
      for (let i = 0; i < this.x1.length; i++) {
        const hit = this.hitsOne(i, x1, y1, x2, y2, limit);
        if (hit !== false) return hit;
      }
      return false;
    }
    for (let cx = cx1; cx <= cx2; cx++)
      for (let cy = cy1; cy <= cy2; cy++) {
        const list = this.cells.get(this.key(cx, cy));
        if (list)
          for (const i of list) {
            const hit = this.hitsOne(i, x1, y1, x2, y2, limit);
            if (hit !== false) return hit;
          }
      }
    return false;
  }
}

/** The work one translation search may do: box-against-obstacle tests, and `accept` calls. */
export const SEARCH_BUDGET = { tests: 400_000, accepts: 200 } as const;

/**
 * The one free-place search (copies, pastes, text, quick placement and Tidy up share it): the smallest move,
 * on a `step` grid in rings out to `maxRings` (nearest first; ties above before below, left before right), that
 * puts every one of `boxes`, grown by `margin`, clear of `others`, and that `accept` (if given) agrees to.
 * Obstacles are indexed once; only those within reach of the search count, and the work is bounded
 * (`SEARCH_BUDGET`), with at most 64 cell visits per box per candidate and (2 * maxRings + 1)^2 candidates.
 * Returns null when the search runs out: callers keep things where they were, or use their
 * own guaranteed fallback (`pastAll`), never an overlapping spot.
 */
export function findClearTranslation(
  boxes: readonly Box[],
  others: readonly Box[],
  {
    margin = COPY_MARGIN,
    step = 20,
    maxRings = 40,
    accept,
    budget = SEARCH_BUDGET,
  }: {
    margin?: number;
    step?: number;
    maxRings?: number;
    accept?: (d: { x: number; y: number }) => boolean;
    budget?: { tests: number; accepts: number };
  } = {},
): { x: number; y: number } | null {
  const all = boundsOf(boxes);
  if (!all) return null;
  // Only what the search can reach.
  const reach = maxRings * step + margin;
  const envelope = { x: all.x - reach, y: all.y - reach, width: all.width + reach * 2, height: all.height + reach * 2 };
  const near = others.filter((o) => overlaps(envelope, o));
  const size = Math.max(...boxes.map((b) => Math.max(b.width, b.height)));
  const index = new ObstacleIndex(near, Math.max(80, Math.min(640, size + margin * 2)));
  const n = boxes.length;
  const bx1 = boxes.map((b) => b.x - margin);
  const by1 = boxes.map((b) => b.y - margin);
  const bx2 = boxes.map((b) => b.x + b.width + margin);
  const by2 = boxes.map((b) => b.y + b.height + margin);
  let accepts = 0;
  /** Clear and accepted; undefined when the budget ran out. */
  const fits = (dx: number, dy: number): boolean | undefined => {
    for (let i = 0; i < n; i++) {
      const hit = index.hits(bx1[i] + dx, by1[i] + dy, bx2[i] + dx, by2[i] + dy, budget.tests);
      if (hit === undefined) return undefined;
      if (hit) return false;
    }
    if (!accept) return true;
    if (++accepts > budget.accepts) return undefined;
    return accept({ x: dx, y: dy });
  };
  const first = fits(0, 0);
  if (first) return { x: 0, y: 0 };
  if (first === undefined) return null;
  for (let ring = 1; ring <= maxRings; ring++) {
    const spots: { x: number; y: number; d: number }[] = [];
    for (let i = -ring; i <= ring; i++)
      for (let j = -ring; j <= ring; j++)
        if (Math.max(Math.abs(i), Math.abs(j)) === ring) spots.push({ x: i * step, y: j * step, d: Math.hypot(i, j) });
    spots.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
    for (const s of spots) {
      const ok = fits(s.x, s.y);
      if (ok) return { x: s.x, y: s.y };
      if (ok === undefined) return null;
    }
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
