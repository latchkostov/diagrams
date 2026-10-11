import type { Rect } from "./rect";

interface Entry<T> {
  rect: Rect;
  item: T;
}

const MAX_QUERY_CELLS = 4096;
const MAX_CELL_ENTRIES = 262_144;
const valid = (r: Rect) =>
  [r.x, r.y, r.width, r.height, r.x + r.width, r.y + r.height].every(Number.isFinite) && r.width >= 0 && r.height >= 0;
const touches = (a: Rect, b: Rect) =>
  a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;

/**
 * Bounded spatial hash. Unsafe/large ranges use a finite scan of entries instead of enumerating
 * cells. Invalid rectangles are ignored; valid rectangles are never silently lost.
 */
export class SpatialGrid<T> {
  private cells = new Map<string, Entry<T>[]>();
  private entries: Entry<T>[] = [];
  private overflow: Entry<T>[] = [];
  private cellEntries = 0;
  private cell: number;
  constructor(cell = 160) {
    this.cell = Number.isFinite(cell) && cell > 0 ? cell : 160;
  }

  private key(cx: number, cy: number) {
    return `${cx},${cy}`;
  }

  private range(r: Rect) {
    const c = this.cell;
    const range = [
      Math.floor(r.x / c),
      Math.floor(r.y / c),
      Math.floor((r.x + r.width) / c),
      Math.floor((r.y + r.height) / c),
    ] as const;
    if (!range.every(Number.isSafeInteger)) return null;
    const count = (range[2] - range[0] + 1) * (range[3] - range[1] + 1);
    return Number.isSafeInteger(count) && count > 0 && count <= MAX_QUERY_CELLS ? range : null;
  }

  insert(rect: Rect, item: T) {
    if (!valid(rect)) return;
    const range = this.range(rect);
    const entry = { rect, item };
    this.entries.push(entry);
    const count = range ? (range[2] - range[0] + 1) * (range[3] - range[1] + 1) : 0;
    if (!range || this.cellEntries + count > MAX_CELL_ENTRIES) {
      this.overflow.push(entry);
      return;
    }
    this.cellEntries += count;
    const [x1, y1, x2, y2] = range;
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
    if (!valid(rect)) return [];
    const range = this.range(rect);
    if (!range) return this.entries.filter((e) => touches(e.rect, rect));
    const [x1, y1, x2, y2] = range;
    const seen = new Set<Entry<T>>();
    for (const e of this.overflow) if (touches(e.rect, rect)) seen.add(e);
    for (let cx = x1; cx <= x2; cx++)
      for (let cy = y1; cy <= y2; cy++) {
        const list = this.cells.get(this.key(cx, cy));
        if (list) for (const e of list) seen.add(e);
      }
    return [...seen];
  }
}
