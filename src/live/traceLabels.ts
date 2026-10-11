// Where the traced message's labels go: beside their particle, never on another label, a node card,
// its badges or the floating chrome. Pure screen geometry (no canvas), so it's unit-tested directly.
//
// Copies of one message bunch up (a fan-out leaves a topic together), so labels with the same words
// close together merge into one ("OrderPlaced ×3"). Each label tries the corners and sides around its
// particle, then the same spots further out with a leader line. A label with nowhere to go is left
// out: the trace card lists every hop anyway.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LabelRequest {
  /** Stable id (the particle's message id): a label keeps its spot from frame to frame. */
  id: number;
  text: string;
  /** The particle, in the same px as everything else. */
  x: number;
  y: number;
  /** Higher goes first (dead letters, then retries, then plain messages). */
  priority: number;
}

export interface PlacedLabel extends Box {
  id: number;
  text: string;
  /** Copies merged into this label (1 = just itself). */
  count: number;
  /** The particle it belongs to. */
  ax: number;
  ay: number;
  /** Placed away from the particle: draw a line to it. */
  leader: boolean;
  /** Which spot around the particle it took (pass back as `previous` next frame). */
  spot: number;
}

export interface LabelEnv {
  /** Label size for its text (the caller measures with the real font). */
  measure(text: string): { w: number; h: number };
  /** Gap between a particle and its label, in px. */
  offset: number;
  /** The drawable area. */
  bounds: Box;
  /** Never covered: node cards, their badges, floating chrome. */
  hard: readonly Box[];
  /** Avoided when there's a choice: edge labels, other traced particles. */
  soft?: readonly Box[];
  /** Last frame's spot per label id (see `PlacedLabel.spot`): kept while it's still free. */
  previous?: ReadonlyMap<number, number>;
}

/** Directions around the particle, in order of preference: corners first, then the sides. */
const DIRS: readonly (readonly [number, number])[] = [
  [1, -1],
  [1, 1],
  [-1, -1],
  [-1, 1],
  [1, 0],
  [-1, 0],
  [0, -1],
  [0, 1],
];
/** Rings of distance (× offset). Past the first, the label gets a leader line. */
const RINGS = [1, 2.4, 4, 6, 8];
const PAD = 2;

const hit = (a: Box, b: Box, pad = PAD) =>
  a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
const inside = (a: Box, b: Box) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

/** Merges same-text requests whose particles sit within `reach` px of each other. */
export function mergeLabels(reqs: readonly LabelRequest[], reach: number): (LabelRequest & { count: number })[] {
  const sorted = [...reqs].sort((a, b) => b.priority - a.priority || b.id - a.id);
  const out: (LabelRequest & { count: number })[] = [];
  for (const r of sorted) {
    const near = out.find((o) => o.text === r.text && Math.hypot(o.x - r.x, o.y - r.y) <= reach);
    if (near) near.count++;
    else out.push({ ...r, count: 1 });
  }
  return out;
}

export function placeTraceLabels(reqs: readonly LabelRequest[], env: LabelEnv): PlacedLabel[] {
  const { offset, bounds, hard, soft = [], previous } = env;
  const probe = env.measure("M");
  const merged = mergeLabels(reqs, probe.h * 2.5);
  const placed: PlacedLabel[] = [];
  const free = (b: Box, strict: boolean) =>
    inside(b, bounds) &&
    !placed.some((p) => hit(b, p)) &&
    !hard.some((o) => hit(b, o, 0)) &&
    (!strict || !soft.some((o) => hit(b, o, 0)));

  for (const r of merged) {
    const text = r.count > 1 ? `${r.text} ×${r.count}` : r.text;
    const { w, h } = env.measure(text);
    const at = (dx: number, dy: number): Box => ({ x: r.x + dx, y: r.y + dy, w, h });
    const candidates: { dx: number; dy: number; leader: boolean }[] = [];
    for (const ring of RINGS) {
      const d = offset * ring;
      for (const [ux, uy] of DIRS) {
        const dx = ux > 0 ? d : ux < 0 ? -d - w : -w / 2;
        const dy = uy < 0 ? -d - h : uy > 0 ? d : -h / 2;
        candidates.push({ dx, dy, leader: ring > 1 });
      }
    }
    // Last frame's spot while it stays clear, so labels don't hop between corners as particles move.
    const before = previous?.get(r.id);
    let spot =
      before !== undefined &&
      before < candidates.length &&
      free(at(candidates[before].dx, candidates[before].dy), false)
        ? before
        : undefined;
    // Else the first spot clear of everything, then one that only keeps clear of the things that matter.
    for (const strict of [true, false]) {
      if (spot !== undefined) break;
      const i = candidates.findIndex((c) => free(at(c.dx, c.dy), strict));
      if (i >= 0) spot = i;
    }
    if (spot === undefined) continue;
    const c = candidates[spot];
    placed.push({ ...at(c.dx, c.dy), id: r.id, text, count: r.count, ax: r.x, ay: r.y, leader: c.leader, spot });
  }
  return placed;
}

/** The point on `b`'s edge nearest to (x, y): where a leader line meets its label. */
export function nearestOnBox(b: Box, x: number, y: number): { x: number; y: number } {
  return { x: Math.min(Math.max(x, b.x), b.x + b.w), y: Math.min(Math.max(y, b.y), b.y + b.h) };
}
