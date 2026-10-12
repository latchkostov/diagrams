// Tidy the selection (D15): the layered layout on just the selected nodes and the edges between them, inside
// their current bounding box where it fits, keeping its top-left. Nothing else moves, and the result lands
// clear of everything else (nothing overlaps by default): when the tidied nodes would cover something, they
// move together to the nearest free place. Pure geometry.

import { layeredLayout } from "./layout";
import type { Positions } from "./arrange";

export type TidyBox = { id: string; x: number; y: number; width: number; height: number; label?: string };
type Rect = { x: number; y: number; width: number; height: number };

/**
 * Gaps a tidy may close down to, along the flow and across it. A gap a named edge crosses keeps the room the
 * layered layout gave its label.
 */
export const TIDY_GAP = { along: 80, across: 40 } as const;
/** Room kept between the tidied nodes and anything else. */
const CLEAR = 16;

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function bounds(boxes: readonly Rect[]): Rect {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
    height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
  };
}

/**
 * Closes the gaps between the layers on the flow's axis so they span at most `room`, never below each gap's
 * minimum (`minGap(i)`: between layer i and i + 1). A layer is the boxes that start at the same coordinate (the
 * layered layout's layers do). Every gap gives up the same share of what it can spare. Returns new starts by id;
 * unchanged when they already fit.
 */
export function fitAxis(
  boxes: readonly TidyBox[],
  axis: "x" | "y",
  room: number,
  minGap: (index: number) => number,
): Map<string, number> {
  const pos = (b: TidyBox) => (axis === "x" ? b.x : b.y);
  const size = (b: TidyBox) => (axis === "x" ? b.width : b.height);
  const out = new Map(boxes.map((b) => [b.id, pos(b)]));
  const starts = [...new Set(boxes.map(pos))].sort((a, b) => a - b);
  if (starts.length < 2) return out;
  const extent = starts.map((s) => Math.max(...boxes.filter((b) => pos(b) === s).map(size)));
  const gaps = starts.slice(1).map((s, i) => Math.max(0, s - (starts[i] + extent[i])));
  const span = starts[starts.length - 1] + extent[extent.length - 1] - starts[0];
  const spare = gaps.reduce((s, g, i) => s + Math.max(0, g - minGap(i)), 0);
  const over = span - room;
  if (over <= 0 || !spare) return out;
  const k = Math.min(1, over / spare);
  const next = [starts[0]];
  for (let i = 0; i < gaps.length; i++) {
    const g = gaps[i] - Math.max(0, gaps[i] - minGap(i)) * k;
    next.push(next[i] + extent[i] + g);
  }
  const at = new Map(starts.map((s, i) => [s, Math.round(next[i] / 10) * 10]));
  for (const b of boxes) out.set(b.id, at.get(pos(b))!);
  return out;
}

/**
 * Draws the slots of every layer closer together across the flow, by one factor for all, so they span at most
 * `room`: never closer than `minGap` between two neighbours in the same layer (other layers sit apart along the
 * flow, so they can't collide). `layerAxis` names the coordinate a layer shares. Returns new starts on `axis`
 * by id; unchanged when they already fit.
 */
export function scaleAcross(
  boxes: readonly TidyBox[],
  axis: "x" | "y",
  room: number,
  layerAxis: "x" | "y",
  minGap: number,
): Map<string, number> {
  const pos = (b: TidyBox) => (axis === "x" ? b.x : b.y);
  const size = (b: TidyBox) => (axis === "x" ? b.width : b.height);
  const out = new Map(boxes.map((b) => [b.id, pos(b)]));
  if (boxes.length < 2) return out;
  const p0 = Math.min(...boxes.map(pos));
  const far = boxes.reduce((a, b) => (pos(b) + size(b) > pos(a) + size(a) ? b : a));
  const reach = pos(far) - p0;
  if (reach <= 0 || reach + size(far) <= room) return out;
  // The closest two slots of one layer may come: the first one's size and the minimum gap.
  let floor = 0;
  const layers = new Map<number, TidyBox[]>();
  for (const b of boxes) layers.set(b[layerAxis], [...(layers.get(b[layerAxis]) ?? []), b]);
  for (const layer of layers.values()) {
    const sorted = [...layer].sort((a, b) => pos(a) - pos(b));
    for (let i = 1; i < sorted.length; i++) {
      const d = pos(sorted[i]) - pos(sorted[i - 1]);
      if (d > 0) floor = Math.max(floor, (size(sorted[i - 1]) + minGap) / d);
    }
  }
  const f = Math.min(1, Math.max(floor, (room - size(far)) / reach));
  // Rounded up to the grid, so two neighbours never end up closer than the minimum.
  for (const b of boxes) out.set(b.id, p0 + Math.ceil(((pos(b) - p0) * f) / 10) * 10);
  return out;
}

/** The smallest move (on a `step` grid, nearest first) that puts every box clear of `others`; null if none. */
function clearMove(
  boxes: readonly Rect[],
  others: readonly Rect[],
  step = 20,
  rings = 40,
): { x: number; y: number } | null {
  const grown = others.map((o) => ({
    x: o.x - CLEAR,
    y: o.y - CLEAR,
    width: o.width + CLEAR * 2,
    height: o.height + CLEAR * 2,
  }));
  const clear = (dx: number, dy: number) =>
    boxes.every((b) => !grown.some((o) => overlaps({ ...b, x: b.x + dx, y: b.y + dy }, o)));
  if (clear(0, 0)) return { x: 0, y: 0 };
  for (let ring = 1; ring <= rings; ring++) {
    const spots: { x: number; y: number; d: number }[] = [];
    for (let i = -ring; i <= ring; i++)
      for (let j = -ring; j <= ring; j++)
        if (Math.max(Math.abs(i), Math.abs(j)) === ring) spots.push({ x: i * step, y: j * step, d: Math.hypot(i, j) });
    spots.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
    const hit = spots.find((s) => clear(s.x, s.y));
    if (hit) return hit;
  }
  return null;
}

/**
 * New top-left positions for `nodes` (the selection, with their sizes): laid out in layers along `direction`
 * by the edges between them, closed up to fit their current bounding box where the minimum gaps allow, its
 * top-left kept, then moved clear of `others` (everything that isn't being tidied) if they'd cover any of it.
 */
export function tidyLayout({
  nodes,
  edges,
  direction = "LR",
  others = [],
}: {
  nodes: readonly TidyBox[];
  edges: readonly { from: string; to: string; label?: string }[];
  direction?: "LR" | "TB";
  others?: readonly Rect[];
}): Positions {
  const out: Positions = new Map();
  if (nodes.length < 2) return out;
  const ids = new Set(nodes.map((n) => n.id));
  const own = edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  const laid = layeredLayout({ nodes: nodes.map((n) => ({ ...n })), edges: own, direction });
  let boxes: TidyBox[] = nodes.map((n) => ({ ...n, ...laid.get(n.id)! }));

  // Fit the box the selection had, where the minimum gaps allow: along the flow, a gap a named edge crosses
  // keeps its label's room.
  const before = bounds(nodes);
  const lr = direction === "LR";
  const alongAxis = lr ? "x" : "y";
  const acrossAxis = lr ? "y" : "x";
  const layers = [...new Set(boxes.map((b) => b[alongAxis]))].sort((a, b) => a - b);
  const layerOf = new Map(boxes.map((b) => [b.id, layers.indexOf(b[alongAxis])]));
  const labelled = new Set<number>();
  for (const e of own) {
    if (!e.label?.trim()) continue;
    const a = Math.min(layerOf.get(e.from)!, layerOf.get(e.to)!);
    const b = Math.max(layerOf.get(e.from)!, layerOf.get(e.to)!);
    for (let i = a; i < b; i++) labelled.add(i);
  }
  const along = fitAxis(boxes, alongAxis, lr ? before.width : before.height, (i) =>
    labelled.has(i) ? Infinity : TIDY_GAP.along,
  );
  const across = scaleAcross(boxes, acrossAxis, lr ? before.height : before.width, alongAxis, TIDY_GAP.across);
  boxes = boxes.map((b) => ({ ...b, [alongAxis]: along.get(b.id)!, [acrossAxis]: across.get(b.id)! }));

  // Its top-left kept, on the grid.
  const after = bounds(boxes);
  const shift = { x: Math.round((before.x - after.x) / 10) * 10, y: Math.round((before.y - after.y) / 10) * 10 };
  boxes = boxes.map((b) => ({ ...b, x: b.x + shift.x, y: b.y + shift.y }));

  // Clear of everything else: the nearest free place for the whole tidied group.
  const move = clearMove(boxes, others) ?? { x: 0, y: 0 };
  for (const b of boxes) out.set(b.id, { x: Math.round(b.x + move.x), y: Math.round(b.y + move.y) });
  return out;
}
