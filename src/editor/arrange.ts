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
