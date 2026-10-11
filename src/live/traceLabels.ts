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
  hard?: readonly Box[];
  /** Avoided when there's a choice: edge labels, other traced particles. */
  soft?: readonly Box[];
  /** `hard` and `soft` already indexed, shared by many placements in one frame (instead of them). */
  obstacles?: LabelObstacles;
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
/** Floating labels are a preview; the trace card keeps the complete journey. */
export const MAX_TRACE_LABELS = 48;

/** WCAG relative luminance: black or white always gives at least 4.5:1 on an opaque colour. */
export function traceLabelInk(background: string): string {
  const rgb = background.replace("#", "").match(/.{2}/g) ?? [];
  const channels = rgb.map((hex) => {
    const v = parseInt(hex, 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return luminance > 0.179 ? "#000000" : "#ffffff";
}

/** Uniform grid for local rectangle queries. Very large obstacles live in a small overflow list. */
class BoxIndex {
  private cells = new Map<string, Box[]>();
  private large: Box[] = [];
  constructor(
    private cell: number,
    boxes: readonly Box[] = [],
  ) {
    for (const box of boxes) this.add(box);
  }
  private keys(box: Box): string[] {
    const x0 = Math.floor((box.x - PAD) / this.cell),
      y0 = Math.floor((box.y - PAD) / this.cell);
    const x1 = Math.floor((box.x + box.w + PAD) / this.cell),
      y1 = Math.floor((box.y + box.h + PAD) / this.cell);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 128) return [];
    const keys: string[] = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) keys.push(`${x}:${y}`);
    return keys;
  }
  add(box: Box): void {
    const keys = this.keys(box);
    if (!keys.length) this.large.push(box);
    for (const key of keys) {
      const bucket = this.cells.get(key);
      if (bucket) bucket.push(box);
      else this.cells.set(key, [box]);
    }
  }
  hits(box: Box, pad: number): boolean {
    if (this.large.some((other) => hit(box, other, pad))) return true;
    const keys = this.keys(box);
    if (!keys.length) return [...this.cells.values()].some((bucket) => bucket.some((other) => hit(box, other, pad)));
    return keys.some((key) => this.cells.get(key)?.some((other) => hit(box, other, pad)));
  }
}

/**
 * A frame's obstacles, indexed once for many placements (slow motion places its captions and each
 * visited node's offset one by one). `add` what's been placed so later labels keep clear of it.
 */
export class LabelObstacles {
  readonly hard: BoxIndex;
  readonly soft: BoxIndex;
  constructor(hard: readonly Box[], soft: readonly Box[] = [], cell = 64) {
    this.hard = new BoxIndex(cell, hard);
    this.soft = new BoxIndex(cell, soft);
  }
  add(box: Box): void {
    this.hard.add(box);
  }
}

const hit = (a: Box, b: Box, pad = PAD) =>
  a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
const inside = (a: Box, b: Box) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

/** Merges same-text requests whose particles sit within `reach` px of each other. */
export function mergeLabels(
  reqs: readonly LabelRequest[],
  reach: number,
  limit = Infinity,
): (LabelRequest & { count: number })[] {
  const sorted = [...reqs].sort((a, b) => b.priority - a.priority || b.id - a.id);
  const out: (LabelRequest & { count: number })[] = [];
  const grid = new Map<string, Map<string, (LabelRequest & { count: number })[]>>();
  const cell = Math.max(1, reach);
  for (const r of sorted) {
    const x = Math.floor(r.x / cell),
      y = Math.floor(r.y / cell);
    const words = grid.get(r.text);
    let near: (LabelRequest & { count: number }) | undefined;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const found = words?.get(`${x + dx}:${y + dy}`)?.find((o) => Math.hypot(o.x - r.x, o.y - r.y) <= reach);
        // Retain the same priority/id ordering when more than one group is within reach.
        if (
          found &&
          (!near || found.priority > near.priority || (found.priority === near.priority && found.id > near.id))
        )
          near = found;
      }
    if (near) near.count++;
    else if (out.length < limit) {
      const group = { ...r, count: 1 };
      out.push(group);
      const buckets = words ?? new Map<string, (LabelRequest & { count: number })[]>();
      const key = `${x}:${y}`;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(group);
      else buckets.set(key, [group]);
      grid.set(r.text, buckets);
    }
  }
  return out;
}

export function placeTraceLabels(reqs: readonly LabelRequest[], env: LabelEnv): PlacedLabel[] {
  const { offset, bounds, previous } = env;
  const probe = env.measure("M");
  const merged = mergeLabels(reqs, probe.h * 2.5, MAX_TRACE_LABELS);
  const placed: PlacedLabel[] = [];
  const cell = Math.max(32, probe.h * 4);
  const placedIndex = new BoxIndex(cell);
  const { hard, soft } = env.obstacles ?? new LabelObstacles(env.hard ?? [], env.soft, cell);
  const free = (b: Box, strict: boolean) =>
    inside(b, bounds) && !placedIndex.hits(b, PAD) && !hard.hits(b, 0) && (!strict || !soft.hits(b, 0));

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
    placedIndex.add(placed.at(-1)!);
  }
  return placed;
}

/** The point on `b`'s edge nearest to (x, y): where a leader line meets its label. */
export function nearestOnBox(b: Box, x: number, y: number): { x: number; y: number } {
  return { x: Math.min(Math.max(x, b.x), b.x + b.w), y: Math.min(Math.max(y, b.y), b.y + b.h) };
}
