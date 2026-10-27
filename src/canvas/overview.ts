import type { Rect } from "./geometry/rect";
import { titleText } from "./identity";

export type OverviewItem = { id: string; name: string; box: Rect; group?: string; spotlight?: boolean };
export type OverviewHeader = OverviewItem & { lines: string[]; count: number };

/** Obstacle visits for one layout. Imported diagrams are untrusted, so placement work stays linear in it. */
export const OVERVIEW_WORK_BUDGET = 500_000;
const GAP = 2;

type Band = { left: number; right: number; top: number; bottom: number };
const band = ({ x, y, width, height }: Rect): Band => ({ left: x, right: x + width, top: y, bottom: y + height });
/** Insert into an array kept sorted by `key`, without re-sorting every obstacle per zone. */
function insertSorted(list: Band[], item: Band, key: (b: Band) => number) {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (key(list[middle]) <= key(item)) low = middle + 1;
    else high = middle;
  }
  list.splice(low, 0, item);
}

/**
 * Zone headers take a free band; individual cards always retain their own identity. Cards and every
 * previously placed header are obstacles, so headers never cover a card or one another. Each zone sweeps
 * the obstacles in its column once (pre-sorted), and a shared budget bounds the whole layout: past it, the
 * remaining headers sit at their zone's top edge without a search.
 */
export function overviewLayout(
  nodes: OverviewItem[],
  zones: OverviewItem[],
  measure: (text: string) => number,
  budget = OVERVIEW_WORK_BUDGET,
) {
  const cards = nodes.map((node) => band(node.box));
  const cardsByTop = [...cards].sort((a, b) => a.top - b.top);
  const cardsByBottom = [...cards].sort((a, b) => b.bottom - a.bottom);
  const headersByTop: Band[] = [];
  const headersByBottom: Band[] = [];
  let work = 0;
  const headers = zones.map((zone): OverviewHeader => {
    const lines: string[] = [];
    const width = Math.max(0, zone.box.width - 12);
    for (const word of zone.name.split(/\s+/)) {
      const fitted = titleText(word, width, measure);
      const last = lines.at(-1);
      if (last && measure(`${last} ${fitted}`) <= width) lines[lines.length - 1] += ` ${fitted}`;
      else {
        lines.push(measure(fitted) <= width ? fitted : "");
      }
    }
    const height = lines.length * 12 + 6;
    const box = { ...zone.box, height };
    const left = zone.box.x;
    const right = zone.box.x + zone.box.width;
    const cost = 2 * (cards.length + headersByTop.length);
    if (work + cost > budget) box.y = zone.box.y;
    else {
      work += cost;
      // Same strict overlap as `intersects`: touching edges are clear.
      const column = (sorted: Band[], placed: Band[], order: (a: Band, b: Band) => boolean) => {
        const out: Band[] = [];
        let i = 0;
        let j = 0;
        while (i < sorted.length || j < placed.length) {
          const next =
            j >= placed.length || (i < sorted.length && order(sorted[i], placed[j])) ? sorted[i++] : placed[j++];
          if (next.left < right && left < next.right) out.push(next);
        }
        return out;
      };
      // Inside: the lowest y at or below the zone's top that clears every obstacle in the column.
      let y = zone.box.y;
      const bottom = zone.box.y + zone.box.height;
      for (const o of column(cardsByTop, headersByTop, (a, b) => a.top <= b.top)) {
        if (o.top >= y + height || y + height > bottom) break;
        if (o.bottom > y) y = o.bottom + GAP;
      }
      if (y + height <= bottom) box.y = y;
      else {
        // Outside: walk above every collision, including cards and headers outside the zone.
        y = zone.box.y - height - GAP;
        for (const o of column(cardsByBottom, headersByBottom, (a, b) => a.bottom >= b.bottom)) {
          if (o.bottom <= y) break;
          if (o.top < y + height) y = o.top - height - GAP;
        }
        box.y = y;
      }
    }
    const placed = band(box);
    insertSorted(headersByTop, placed, (b) => b.top);
    insertSorted(headersByBottom, placed, (b) => -b.bottom);
    return { ...zone, count: 0, lines, box };
  });
  return { headers, work };
}

/** Live's decorator supplies the current-rate quartile; narration retains its adjacent routes. */
export function overviewConnection(near: boolean, main: boolean) {
  return near || main;
}
