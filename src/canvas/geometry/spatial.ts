import type { Rect } from "./rect";

/**
 * Uniform-grid spatial hash for rect queries. Diagrams are a few hundred boxes at most, so a flat
 * grid beats a tree: O(1) inserts, and a query only touches the cells its rect covers.
 */
export class SpatialGrid<T> {
  private cells = new Map<number, { rect: Rect; item: T }[]>();
  constructor(private cell = 160) {}

  private key(cx: number, cy: number) {
    // Cantor-free packing: cell coords stay well inside ±2^15 for any sane diagram.
    return (cx + 32768) * 65536 + (cy + 32768);
  }

  private range(r: Rect) {
    const c = this.cell;
    return [
      Math.floor(r.x / c),
      Math.floor(r.y / c),
      Math.floor((r.x + r.width) / c),
      Math.floor((r.y + r.height) / c),
    ] as const;
  }

  insert(rect: Rect, item: T) {
    const [x1, y1, x2, y2] = this.range(rect);
    const entry = { rect, item };
    for (let cx = x1; cx <= x2; cx++)
      for (let cy = y1; cy <= y2; cy++) {
        const k = this.key(cx, cy);
        const list = this.cells.get(k);
        if (list) list.push(entry);
        else this.cells.set(k, [entry]);
      }
  }

  /** Items whose rect's cells overlap `rect`'s cells (a superset of true hits; callers test exactly). */
  query(rect: Rect): { rect: Rect; item: T }[] {
    const [x1, y1, x2, y2] = this.range(rect);
    const seen = new Set<{ rect: Rect; item: T }>();
    for (let cx = x1; cx <= x2; cx++)
      for (let cy = y1; cy <= y2; cy++) {
        const list = this.cells.get(this.key(cx, cy));
        if (list) for (const e of list) seen.add(e);
      }
    return [...seen];
  }
}
