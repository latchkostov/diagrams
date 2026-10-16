import type { Rect } from "./rect";

interface Entry<T> {
  rect: Rect;
  item: T;
}

const MAX_QUERY_CELLS = 4096;
const MAX_CELL_ENTRIES = 262_144;
const valid = (r: Rect) =>
  Number.isFinite(r.x) &&
  Number.isFinite(r.y) &&
  Number.isFinite(r.width) &&
  Number.isFinite(r.height) &&
  Number.isFinite(r.x + r.width) &&
  Number.isFinite(r.y + r.height) &&
  r.width >= 0 &&
  r.height >= 0;
const touches = (a: Rect, b: Rect) =>
  a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;

/**
 * Bounded spatial hash. Unsafe/large ranges use a finite scan of entries instead of enumerating
 * cells. Invalid rectangles are ignored; valid rectangles are never silently lost.
 */
export class SpatialGrid<T> {
  /** Column, then row: numbers, not "x,y" strings (a query reads many cells; building a key per cell showed). */
  private cells = new Map<number, Map<number, Entry<T>[]>>();
  private entries: Entry<T>[] = [];
  private overflow: Entry<T>[] = [];
  private cellEntries = 0;
  private cell: number;
  constructor(cell = 160) {
    this.cell = Number.isFinite(cell) && cell > 0 ? cell : 160;
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
    for (let cx = x1; cx <= x2; cx++) {
      let column = this.cells.get(cx);
      if (!column) this.cells.set(cx, (column = new Map()));
      for (let cy = y1; cy <= y2; cy++) {
        const list = column.get(cy);
        if (list) list.push(entry);
        else column.set(cy, [entry]);
      }
    }
  }

  /** Items whose rect's cells overlap `rect`'s cells (a superset of true hits; callers test exactly). */
  query(rect: Rect): { rect: Rect; item: T }[];
  query(rect: Rect, budget: { remaining: number }): { rect: Rect; item: T }[] | null;
  query(rect: Rect, budget?: { remaining: number }): { rect: Rect; item: T }[] | null {
    if (!valid(rect)) return [];
    const range = this.range(rect);
    if (!range) {
      const hits: Entry<T>[] = [];
      for (const e of this.entries) {
        if (budget && --budget.remaining < 0) return null;
        if (touches(e.rect, rect)) hits.push(e);
      }
      return hits;
    }
    const [x1, y1, x2, y2] = range;
    if (x1 === x2 && y1 === y2) {
      // One cell: its list holds an entry once, and never one from the overflow, so nothing needs de-duplicating.
      const hits: Entry<T>[] = [];
      for (const e of this.overflow) {
        if (budget && --budget.remaining < 0) return null;
        if (touches(e.rect, rect)) hits.push(e);
      }
      for (const e of this.cells.get(x1)?.get(y1) ?? []) {
        if (budget && --budget.remaining < 0) return null;
        hits.push(e);
      }
      return hits;
    }
    const seen = new Set<Entry<T>>();
    for (const e of this.overflow) {
      if (budget && --budget.remaining < 0) return null;
      if (touches(e.rect, rect)) seen.add(e);
    }
    for (let cx = x1; cx <= x2; cx++) {
      const column = this.cells.get(cx);
      if (column)
        for (let cy = y1; cy <= y2; cy++) {
          const list = column.get(cy);
          if (list)
            for (const e of list) {
              if (budget && --budget.remaining < 0) return null;
              seen.add(e);
            }
        }
    }
    return [...seen];
  }
}

/**
 * Rects by position, for a pass that tests each against a box. `near` returns, in no particular order, the indices
 * into `rects` of a superset of those touching the box, never fewer: a rect the grid can't hold (non-finite, or a negative
 * size) is always among them, and a box the grid can't answer for returns every index. Callers keep their exact tests;
 * the index only spares them the rects far away.
 */
export class RectIndex {
  private grid = new SpatialGrid<number>();
  private loose: number[] = [];
  constructor(readonly rects: readonly Rect[]) {
    rects.forEach((r, i) => {
      if (valid(r)) this.grid.insert(r, i);
      else this.loose.push(i);
    });
  }

  near(box: Rect): number[] {
    if (!valid(box)) return this.rects.map((_, i) => i);
    const out = this.grid.query(box).map((e) => e.item);
    out.push(...this.loose);
    return out;
  }
}
