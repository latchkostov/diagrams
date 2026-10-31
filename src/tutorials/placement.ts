export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
export const right = (r: Box) => r.x + r.width;
export const bottom = (r: Box) => r.y + r.height;
export const intersects = (a: Box, b: Box) => a.x < right(b) && right(a) > b.x && a.y < bottom(b) && bottom(a) > b.y;
export function intersect(a: Box, b: Box): Box {
  const x = Math.max(a.x, b.x),
    y = Math.max(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(right(a), right(b)) - x),
    height: Math.max(0, Math.min(bottom(a), bottom(b)) - y),
  };
}
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));

/** Split around occupied chrome; all returned panes are clear, including at phone dock heights. */
export function clearPanes(pane: Box, obstacles: readonly Box[]): Box[] {
  return obstacles.reduce<Box[]>(
    (panes, obstacle) =>
      panes.flatMap((p) => {
        if (!intersects(p, obstacle)) return [p];
        const o = intersect(p, obstacle);
        return [
          { x: p.x, y: p.y, width: p.width, height: o.y - p.y },
          { x: p.x, y: bottom(o), width: p.width, height: bottom(p) - bottom(o) },
          { x: p.x, y: p.y, width: o.x - p.x, height: p.height },
          { x: right(o), y: p.y, width: right(p) - right(o), height: p.height },
        ].filter((r) => r.width > 0 && r.height > 0);
      }),
    [pane],
  );
}

/** Measured, physical coordinates with logical preference: end, start, below, above. Never moves a camera. */
export function placeTip(target: Box, size: { width: number; height: number }, panes: readonly Box[], rtl: boolean) {
  const gap = 20,
    margin = 8;
  const candidates = panes.flatMap((p) => {
    const area = { x: p.x + margin, y: p.y + margin, width: p.width - margin * 2, height: p.height - margin * 2 };
    if (size.width > area.width || size.height > area.height) return [];
    const end = rtl ? target.x - size.width - gap : right(target) + gap;
    const start = rtl ? right(target) + gap : target.x - size.width - gap;
    return [
      { x: end, y: target.y + (target.height - size.height) / 2, side: rtl ? "left" : "right" },
      { x: start, y: target.y + (target.height - size.height) / 2, side: rtl ? "right" : "left" },
      { x: target.x + (target.width - size.width) / 2, y: bottom(target) + gap, side: "below" },
      { x: target.x + (target.width - size.width) / 2, y: target.y - size.height - gap, side: "above" },
    ].flatMap((c, rank) => {
      const x = clamp(c.x, area.x, right(area) - size.width),
        y = clamp(c.y, area.y, bottom(area) - size.height);
      // An explanation must not hide the thing it teaches. Use the strip when no clear place fits.
      if (intersects({ x, y, ...size }, target)) return [];
      return [{ x, y, side: c.side, score: Math.abs(x - c.x) + Math.abs(y - c.y) + rank }];
    });
  });
  return candidates.sort((a, b) => a.score - b.score)[0] ?? null;
}
