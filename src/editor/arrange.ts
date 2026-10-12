// Pure geometry for align / distribute / boundaries. Positions are top-left, like the file format.

export interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";
export type Axis = "h" | "v";
export type Positions = Map<string, { x: number; y: number }>;

export function boundingBox(boxes: readonly Box[]): { x: number; y: number; width: number; height: number } {
  if (!boxes.length) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: right - x, height: bottom - y };
}

/** Aligns boxes to an edge / centre line of their common bounding box. */
export function align(boxes: readonly Box[], mode: AlignMode): Positions {
  const bb = boundingBox(boxes);
  const out: Positions = new Map();
  for (const b of boxes) {
    let { x, y } = b;
    if (mode === "left") x = bb.x;
    if (mode === "right") x = bb.x + bb.width - b.width;
    if (mode === "center") x = bb.x + bb.width / 2 - b.width / 2;
    if (mode === "top") y = bb.y;
    if (mode === "bottom") y = bb.y + bb.height - b.height;
    if (mode === "middle") y = bb.y + bb.height / 2 - b.height / 2;
    out.set(b.id, { x: Math.round(x), y: Math.round(y) });
  }
  return out;
}

/**
 * Spaces boxes so the gaps between neighbours are equal along an axis. The outermost boxes stay
 * put; needs at least three boxes to do anything.
 */
export function distribute(boxes: readonly Box[], axis: Axis): Positions {
  const out: Positions = new Map(boxes.map((b) => [b.id, { x: b.x, y: b.y }]));
  if (boxes.length < 3) return out;
  const pos = (b: Box) => (axis === "h" ? b.x : b.y);
  const size = (b: Box) => (axis === "h" ? b.width : b.height);
  const sorted = [...boxes].sort((a, b) => pos(a) - pos(b));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = pos(last) + size(last) - pos(first);
  const total = sorted.reduce((s, b) => s + size(b), 0);
  const gap = (span - total) / (sorted.length - 1);
  let cursor = pos(first);
  for (const b of sorted) {
    const p = Math.round(cursor);
    out.set(b.id, axis === "h" ? { x: p, y: b.y } : { x: b.x, y: p });
    cursor += size(b) + gap;
  }
  return out;
}

/** Group boundary around boxes, leaving room for the label chip at the top. */
export function boundaryAround(boxes: readonly Box[], pad = 40, labelRoom = 24) {
  const bb = boundingBox(boxes);
  return {
    x: Math.round(bb.x - pad),
    y: Math.round(bb.y - pad - labelRoom),
    width: Math.round(bb.width + pad * 2),
    height: Math.round(bb.height + pad * 2 + labelRoom),
  };
}

/**
 * Keeps an arrangement overlap-free: aligning a column's tops (or distributing nodes that don't fit their span)
 * would stack them. In their order along `axis` ("h": sideways, "v": down), a box that overlaps one placed
 * before it moves just past the furthest of those that share its band across the axis, `gap` apart; boxes that
 * don't overlap stay where `positions` put them. One pass, each box looked at against the ones before it
 * once: a thousand boxes lined up on one spot take a few milliseconds, not seconds.
 */
export function spreadOverlaps(boxes: readonly Box[], positions: Positions, axis: Axis, gap = 40): Positions {
  const out: Positions = new Map(positions);
  const h = axis === "h";
  const placed = boxes.map((b) => {
    const p = positions.get(b.id) ?? b;
    return { id: b.id, x: p.x, y: p.y, width: b.width, height: b.height };
  });
  placed.sort((a, b) => (h ? a.x - b.x || a.y - b.y : a.y - b.y || a.x - b.x));
  // Along the axis: start and end; across it: start and end. Flat arrays, no allocation in the loop.
  const n = placed.length;
  const s1 = new Float64Array(n);
  const s2 = new Float64Array(n);
  const c1 = new Float64Array(n);
  const c2 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const b = placed[i];
    let start = h ? b.x : b.y;
    const size = h ? b.width : b.height;
    c1[i] = h ? b.y : b.x;
    c2[i] = c1[i] + (h ? b.height : b.width);
    let hit = false;
    let past = -Infinity;
    for (let j = 0; j < i; j++) {
      if (c1[i] >= c2[j] || c1[j] >= c2[i]) continue;
      if (s2[j] > start) past = Math.max(past, s2[j]);
      if (start < s2[j] && s1[j] < start + size) hit = true;
    }
    if (hit) start = past + gap;
    s1[i] = start;
    s2[i] = start + size;
    out.set(b.id, h ? { x: Math.round(start), y: Math.round(b.y) } : { x: Math.round(b.x), y: Math.round(start) });
  }
  return out;
}
