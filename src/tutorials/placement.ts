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
