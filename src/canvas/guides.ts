// Smart guides (D6): while a node or a selection is dragged, its edges and centre line up with other
// nodes' edges and centres, and it snaps to equal gaps in its row or column. Pure geometry, in flow
// coordinates: the canvas indexes the candidates once per drag (`guideIndex`: sorted lines, linear), then
// each pointer move costs a binary search per line and a scan of the boxes for the neighbours (`snapMove`).

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A guide line: `axis` "x" is a vertical line at x = `at`, drawn from `from` to `to` along y. */
export interface GuideLine {
  axis: "x" | "y";
  at: number;
  from: number;
  to: number;
}

/** A gap of an equal-spacing hint: along `axis` from `from` to `to`, drawn at `at` on the other axis. */
export interface GuideGap {
  axis: "x" | "y";
  from: number;
  to: number;
  at: number;
}

export interface SnapResult {
  /** The move to add to the dragged box, so it lands snapped. */
  dx: number;
  dy: number;
  lines: GuideLine[];
  gaps: GuideGap[];
}

interface Line {
  v: number;
  box: number;
}

/**
 * Each box's nearest neighbour before and after it on one axis, among boxes overlapping it across: found
 * on first use (a drag asks about the one or two boxes beside it), so indexing stays linear.
 */
interface Neighbours {
  before: Int32Array;
  after: Int32Array;
}

export interface GuideIndex {
  boxes: readonly Box[];
  /** Left edges, centres and right edges, sorted. */
  xs: readonly Line[];
  /** Top edges, centres and bottom edges, sorted. */
  ys: readonly Line[];
  x: Neighbours;
  y: Neighbours;
}

type Axis = "x" | "y";
const start = (b: Box, a: Axis) => (a === "x" ? b.x : b.y);
const size = (b: Box, a: Axis) => (a === "x" ? b.width : b.height);
const end = (b: Box, a: Axis) => start(b, a) + size(b, a);
const other = (a: Axis): Axis => (a === "x" ? "y" : "x");
/** How much two boxes overlap across `a` (the other axis); positive when they share a row (or column). */
const across = (p: Box, q: Box, a: Axis) =>
  Math.min(end(p, other(a)), end(q, other(a))) - Math.max(start(p, other(a)), start(q, other(a)));

function lines(boxes: readonly Box[], a: Axis): Line[] {
  const out: Line[] = [];
  boxes.forEach((b, i) => {
    out.push({ v: start(b, a), box: i }, { v: start(b, a) + size(b, a) / 2, box: i }, { v: end(b, a), box: i });
  });
  return out.sort((p, q) => p.v - q.v);
}

const UNKNOWN = -2;

const unknown = (n: number): Neighbours => ({
  before: new Int32Array(n).fill(UNKNOWN),
  after: new Int32Array(n).fill(UNKNOWN),
});

/** Box `i`'s nearest neighbour on `a` (`before` or after it), or -1; cached in the index. */
function neighbour(index: GuideIndex, i: number, a: Axis, before: boolean): number {
  const nb = a === "x" ? index.x : index.y;
  const memo = before ? nb.before : nb.after;
  if (memo[i] !== UNKNOWN) return memo[i];
  const { boxes } = index;
  const b = boxes[i];
  let best = -1;
  let edge = before ? -Infinity : Infinity;
  for (let j = 0; j < boxes.length; j++) {
    if (i === j) continue;
    const c = boxes[j];
    if (across(b, c, a) <= 0) continue;
    if (before ? end(c, a) <= start(b, a) && end(c, a) > edge : start(c, a) >= end(b, a) && start(c, a) < edge) {
      edge = before ? end(c, a) : start(c, a);
      best = j;
    }
  }
  memo[i] = best;
  return best;
}

/** Indexes the boxes a drag can line up with: built once when the drag starts. */
export function guideIndex(boxes: readonly Box[]): GuideIndex {
  return { boxes, xs: lines(boxes, "x"), ys: lines(boxes, "y"), x: unknown(boxes.length), y: unknown(boxes.length) };
}

/** First index in sorted `ls` whose value is at least `v`. */
function lowerBound(ls: readonly Line[], v: number): number {
  let lo = 0;
  let hi = ls.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ls[mid].v < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Gap between two boxes across `a` (0 when they overlap there): how far apart a guide's ends are. */
const apart = (p: Box, q: Box, a: Axis) =>
  Math.max(0, start(q, other(a)) - end(p, other(a)), start(p, other(a)) - end(q, other(a)));

interface Candidate {
  /** The move along the axis that snaps. */
  d: number;
  apply: (moved: Box) => { lines: GuideLine[]; gaps: GuideGap[] };
}

/** The nearest alignment of the moving box's start, centre or end with an indexed line on `a`. */
function align(index: GuideIndex, m: Box, a: Axis, threshold: number, reach: number): Candidate | null {
  const ls = a === "x" ? index.xs : index.ys;
  const own = [start(m, a), start(m, a) + size(m, a) / 2, end(m, a)];
  let best: { d: number; v: number } | null = null;
  for (const v of own) {
    for (let i = lowerBound(ls, v - threshold); i < ls.length && ls[i].v <= v + threshold; i++) {
      const l = ls[i];
      if (apart(m, index.boxes[l.box], a) > reach) continue;
      const d = l.v - v;
      if (!best || Math.abs(d) < Math.abs(best.d) - 1e-6) best = { d, v: l.v };
    }
  }
  if (!best) return null;
  const d = best.d;
  return {
    d,
    // One line per axis, drawn across the boxes on it: the centre when it lines up (same-size cards share
    // all three), else the edge that does. Fewer lines read calmer.
    apply: (moved) => {
      for (const v of [start(moved, a) + size(moved, a) / 2, start(moved, a), end(moved, a)]) {
        let from = start(moved, other(a));
        let to = end(moved, other(a));
        let hit = false;
        for (let i = lowerBound(ls, v - 0.5); i < ls.length && ls[i].v <= v + 0.5; i++) {
          const b = index.boxes[ls[i].box];
          if (apart(moved, b, a) > reach) continue;
          hit = true;
          from = Math.min(from, start(b, other(a)));
          to = Math.max(to, end(b, other(a)));
        }
        if (hit) return { lines: [{ axis: a, at: v, from, to }], gaps: [] };
      }
      return { lines: [], gaps: [] };
    },
  };
}

/** Where a gap is drawn: the middle of the two boxes' overlap across `a`. */
const gapAt = (p: Box, q: Box, a: Axis) =>
  (Math.max(start(p, other(a)), start(q, other(a))) + Math.min(end(p, other(a)), end(q, other(a)))) / 2;

/**
 * The nearest equal-spacing spot on `a`: centred between its two neighbours, or one gap past a neighbour
 * whose own neighbour sits that same gap away. Neighbours share the moving box's row (or column).
 */
function spacing(index: GuideIndex, m: Box, a: Axis, threshold: number, reach: number): Candidate | null {
  const { boxes } = index;
  const mid = start(m, a) + size(m, a) / 2;
  let lo = -1;
  let hi = -1;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (across(m, b, a) <= 0) continue;
    const bMid = start(b, a) + size(b, a) / 2;
    if (bMid < mid && end(b, a) <= start(m, a) + threshold && start(m, a) - end(b, a) <= reach) {
      if (lo < 0 || end(b, a) > end(boxes[lo], a)) lo = i;
    } else if (bMid > mid && start(b, a) >= end(m, a) - threshold && start(b, a) - end(m, a) <= reach) {
      if (hi < 0 || start(b, a) < start(boxes[hi], a)) hi = i;
    }
  }
  const options: { to: number; gaps: (moved: Box) => GuideGap[] }[] = [];
  const gap = (p: Box, q: Box): GuideGap => ({ axis: a, from: end(p, a), to: start(q, a), at: gapAt(p, q, a) });
  if (lo >= 0 && hi >= 0) {
    const L = boxes[lo];
    const R = boxes[hi];
    const room = start(R, a) - end(L, a) - size(m, a);
    if (room >= 0) options.push({ to: end(L, a) + room / 2, gaps: (moved) => [gap(L, moved), gap(moved, R)] });
  }
  const ll = lo >= 0 ? neighbour(index, lo, a, true) : -1;
  if (ll >= 0) {
    const L = boxes[lo];
    const LL = boxes[ll];
    const g = start(L, a) - end(LL, a);
    if (g > 0) options.push({ to: end(L, a) + g, gaps: (moved) => [gap(LL, L), gap(L, moved)] });
  }
  const rr = hi >= 0 ? neighbour(index, hi, a, false) : -1;
  if (rr >= 0) {
    const R = boxes[hi];
    const RR = boxes[rr];
    const g = start(RR, a) - end(R, a);
    if (g > 0) options.push({ to: start(R, a) - g - size(m, a), gaps: (moved) => [gap(moved, R), gap(R, RR)] });
  }
  let best: (typeof options)[number] | null = null;
  for (const o of options)
    if (
      Math.abs(o.to - start(m, a)) <= threshold &&
      (!best || Math.abs(o.to - start(m, a)) < Math.abs(best.to - start(m, a)))
    )
      best = o;
  if (!best) return null;
  const chosen = best;
  return { d: chosen.to - start(m, a), apply: (moved) => ({ lines: [], gaps: chosen.gaps(moved) }) };
}

export interface SnapOptions {
  /** How close (flow px) a line or a gap must be to snap: 6 screen px at the current zoom. */
  threshold: number;
  /** How far away (flow px, across the axis) a box may be and still guide. */
  reach: number;
  /** Line up with other boxes (false while the pointer moves fast: only the grid). */
  guides: boolean;
  /** The grid to fall back on when no guide is near (0: none). */
  grid: number;
}

const snapGrid = (v: number, grid: number) => (grid > 0 ? Math.round(v / grid) * grid - v : 0);

/**
 * Snaps a dragged box (already moved by the pointer) on each axis: to the nearest guide or equal gap
 * within the threshold (an alignment wins a tie), else to the grid. Returns the extra move and what to draw.
 */
export function snapMove(index: GuideIndex, moving: Box, o: SnapOptions): SnapResult {
  const pick = (a: Axis) => {
    if (!o.guides || !index.boxes.length) return null;
    const al = align(index, moving, a, o.threshold, o.reach);
    const sp = spacing(index, moving, a, o.threshold, o.reach);
    if (al && sp) {
      // The same spot both ways: show the line and the gaps.
      if (Math.abs(sp.d - al.d) < 0.5)
        return {
          d: al.d,
          apply: (moved: Box) => ({ lines: al.apply(moved).lines, gaps: sp.apply(moved).gaps }),
        };
      return Math.abs(sp.d) < Math.abs(al.d) - 0.5 ? sp : al;
    }
    return al ?? sp;
  };
  const cx = pick("x");
  const cy = pick("y");
  const dx = cx ? cx.d : snapGrid(moving.x, o.grid);
  const dy = cy ? cy.d : snapGrid(moving.y, o.grid);
  const moved = { ...moving, x: moving.x + dx, y: moving.y + dy };
  const out: SnapResult = { dx, dy, lines: [], gaps: [] };
  for (const c of [cx, cy]) {
    if (!c) continue;
    const drawn = c.apply(moved);
    out.lines.push(...drawn.lines);
    out.gaps.push(...drawn.gaps);
  }
  return out;
}

/**
 * Grid-true nudging (Snapping on): the arrow keys move the selection's corner to the next grid line in
 * that direction (`grid`), and Shift moves it `far` and onto the grid. Returns the move for one axis.
 */
export function nudgeOnGrid(v: number, dir: -1 | 0 | 1, grid: number, far: number | null): number {
  if (!dir) return 0;
  if (far !== null) return Math.round((v + dir * far) / grid) * grid - v;
  const next = dir > 0 ? Math.floor(v / grid + 1e-9) * grid + grid : Math.ceil(v / grid - 1e-9) * grid - grid;
  return next - v;
}
