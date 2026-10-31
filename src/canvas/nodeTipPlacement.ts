interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
const endX = (r: Rect) => r.x + r.width;
const endY = (r: Rect) => r.y + r.height;
const overlaps = (a: Rect, b: Rect) => a.x < endX(b) && endX(a) > b.x && a.y < endY(b) && endY(a) > b.y;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(v, b));

/** Never clamp a tooltip onto its subject. Slide beside obstacles or suppress it if no clear slot exists. */
export function placeNodeTip(
  target: Rect,
  size: { width: number; height: number },
  area: Rect,
  obstacles: readonly Rect[] = [],
): Rect | null {
  const pad = 8;
  const keepOff = [target, ...obstacles].map((r) => ({
    x: r.x - pad,
    y: r.y - pad,
    width: r.width + pad * 2,
    height: r.height + pad * 2,
  }));
  if (size.width + pad * 2 > area.width || size.height + pad * 2 > area.height) return null;
  const centreX = target.x + (target.width - size.width) / 2;
  const centreY = target.y + (target.height - size.height) / 2;
  const candidates = [
    { x: centreX, y: target.y - size.height - pad },
    { x: centreX, y: endY(target) + pad },
    { x: endX(target) + pad, y: centreY },
    { x: target.x - size.width - pad, y: centreY },
    ...keepOff.flatMap((r) => [
      { x: r.x - size.width, y: centreY },
      { x: endX(r), y: centreY },
      { x: centreX, y: r.y - size.height },
      { x: centreX, y: endY(r) },
    ]),
  ];
  for (const want of candidates) {
    const rect = {
      ...size,
      x: clamp(want.x, area.x + pad, endX(area) - size.width - pad),
      y: clamp(want.y, area.y + pad, endY(area) - size.height - pad),
    };
    if (!keepOff.some((r) => overlaps(rect, r))) return rect;
  }
  return null;
}
