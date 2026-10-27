import type { Rect } from "../geometry/rect";

/** Screen-space room for the card's top decoration and badges below it. */
export const FRAME_CARD_SPACE = { top: 12, bottom: 32 };
export function innerFrame(
  width: number,
  height: number,
  _view: "focus" | "follow",
  _dock: boolean,
  _rtl = false,
  phone = false,
): Rect {
  const side = phone ? 8 : 28;
  return { x: side, y: 28, width: Math.max(0, width - side * 2), height: Math.max(0, height - 56) };
}

export function oneHop(edges: readonly { source: string; target: string }[], ids: ReadonlySet<string>): Set<string> {
  const near = new Set(ids);
  for (const edge of edges)
    if (ids.has(edge.source) || ids.has(edge.target)) {
      near.add(edge.source);
      near.add(edge.target);
    }
  return near;
}

/** Intersect the pane with the docked surfaces, all measured in screen pixels. */
export function fitRectangle(
  pane: Rect,
  limits: { left?: number; top?: number; right?: number; bottom?: number },
): Rect {
  const x = Math.max(pane.x, limits.left ?? pane.x);
  const y = Math.max(pane.y, limits.top ?? pane.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(pane.x + pane.width, limits.right ?? Infinity) - x),
    height: Math.max(0, Math.min(pane.y + pane.height, limits.bottom ?? Infinity) - y),
  };
}

export function visibleCanvas(root: HTMLElement): Rect {
  const pane = root.getBoundingClientRect();
  const doc = root.ownerDocument;
  const rect = (id: string) => doc?.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect();
  const rail = rect("tool-rail"),
    dock = rect("inspector"),
    bezel = rect("canvas-bezel");
  const legend = rect("live-route-legend");
  // An expanded phone note is an overlay sheet: the pane grows under it, so it crops like a dock.
  const note = doc?.querySelector('[data-testid="live-note"][data-expanded="1"]')?.getBoundingClientRect();
  const paneRight = pane.left + root.clientWidth;
  const paneBottom = pane.top + root.clientHeight;
  const limits = {
    left: pane.left,
    right: paneRight,
    top: bezel && bezel.top <= pane.top && bezel.bottom > pane.top ? bezel.bottom : pane.top,
    bottom: Math.min(paneBottom, legend?.top ?? paneBottom),
  };
  // Remove each surface from the edge it actually occludes, choosing the smallest
  // crop. A full-width phone sheet belongs to the bottom even at its full snap;
  // it must never be mistaken for both side docks. Outside surfaces cost nothing.
  for (const r of [rail, dock, note]) {
    if (!r || r.right <= pane.left || r.left >= paneRight || r.bottom <= pane.top || r.top >= paneBottom) continue;
    const cuts = [
      { side: "bottom", touches: r.bottom >= paneBottom, depth: (paneBottom - r.top) / root.clientHeight },
      { side: "top", touches: r.top <= pane.top, depth: (r.bottom - pane.top) / root.clientHeight },
      { side: "left", touches: r.left <= pane.left, depth: (r.right - pane.left) / root.clientWidth },
      { side: "right", touches: r.right >= paneRight, depth: (paneRight - r.left) / root.clientWidth },
    ] as const;
    const cut = cuts.filter((c) => c.touches).sort((a, b) => a.depth - b.depth)[0];
    if (cut?.side === "bottom") limits.bottom = Math.min(limits.bottom, r.top);
    if (cut?.side === "top") limits.top = Math.max(limits.top, r.bottom);
    if (cut?.side === "left") limits.left = Math.max(limits.left, r.right);
    if (cut?.side === "right") limits.right = Math.min(limits.right, r.left);
  }
  const frame = fitRectangle({ x: pane.left, y: pane.top, width: root.clientWidth, height: root.clientHeight }, limits);
  return { ...frame, x: frame.x - pane.left, y: frame.y - pane.top };
}
