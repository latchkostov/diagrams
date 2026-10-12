// Keyboard selection between nodes (D14). Pure geometry: the order Tab steps through, and the node an
// arrow points at.

export type NavBox = { id: string; x: number; y: number; width: number; height: number };
export type NavDirection = "right" | "left" | "down" | "up";

const cx = (b: NavBox) => b.x + b.width / 2;
const cy = (b: NavBox) => b.y + b.height / 2;

/**
 * Reading order: in a left-to-right diagram, rows from the top, each row left to right; in a top-to-bottom
 * one, columns from the left, each column top to bottom (the flow first). Things share a row when their
 * centres are within `band` of the row's first one (half a card, so a slightly lower neighbour still reads
 * as the same row).
 */
export function readingOrder<T extends NavBox>(boxes: readonly T[], direction: "LR" | "TB" = "LR", band = 40): T[] {
  const lr = direction === "LR";
  const across = (b: NavBox) => (lr ? cy(b) : cx(b));
  const along = (b: NavBox) => (lr ? cx(b) : cy(b));
  const sorted = [...boxes].sort((a, b) => across(a) - across(b) || along(a) - along(b));
  const lines: T[][] = [];
  let start = -Infinity;
  for (const b of sorted) {
    if (!lines.length || across(b) - start > band) {
      lines.push([]);
      start = across(b);
    }
    lines[lines.length - 1].push(b);
  }
  return lines.flatMap((line) => line.sort((a, b) => along(a) - along(b) || a.id.localeCompare(b.id)));
}

/** The next (or, with `back`, previous) id in `order` after `current`; null past either end. */
export function stepInOrder(order: readonly string[], current: string | undefined, back = false): string | null {
  if (!order.length) return null;
  const i = current === undefined ? -1 : order.indexOf(current);
  if (i < 0) return back ? order[order.length - 1] : order[0];
  const j = i + (back ? -1 : 1);
  return j >= 0 && j < order.length ? order[j] : null;
}

/**
 * The node an arrow from `from` points at: the nearest centre that way, within 45° of the arrow. Distance
 * across the arrow counts double, so the node straight ahead beats a closer one off to the side. When
 * nothing lies within 45°, the nearest anywhere on that side. Null when nothing is that way.
 */
export function nearestInDirection(from: NavBox, boxes: readonly NavBox[], dir: NavDirection): string | null {
  const fx = cx(from);
  const fy = cy(from);
  let cone: { id: string; score: number } | null = null;
  let side: { id: string; score: number } | null = null;
  for (const b of boxes) {
    if (b.id === from.id) continue;
    const dx = cx(b) - fx;
    const dy = cy(b) - fy;
    const ahead = dir === "right" ? dx : dir === "left" ? -dx : dir === "down" ? dy : -dy;
    const off = Math.abs(dir === "right" || dir === "left" ? dy : dx);
    if (ahead <= 0.5) continue;
    const score = ahead + 2 * off;
    if (off <= ahead) {
      if (!cone || score < cone.score) cone = { id: b.id, score };
    } else if (!side || score < side.score) side = { id: b.id, score };
  }
  return (cone ?? side)?.id ?? null;
}

/**
 * Tab's order: things in reading order, each boundary just before the first of its members (so Tab meets the
 * box, then what's in it), and an empty boundary where its own place reads.
 */
export function tabOrder(
  items: readonly NavBox[],
  boundaries: readonly (NavBox & { members: readonly string[] })[],
  direction: "LR" | "TB" = "LR",
): string[] {
  const read = readingOrder(items, direction).map((b) => b.id);
  const before = new Map<string, string[]>();
  const empty: NavBox[] = [];
  for (const g of boundaries) {
    const members = new Set(g.members);
    const first = read.find((id) => members.has(id));
    if (first) before.set(first, [...(before.get(first) ?? []), g.id]);
    else empty.push(g);
  }
  const order = empty.length ? readingOrder([...items, ...empty], direction).map((b) => b.id) : read;
  return order.flatMap((id) => [...(before.get(id) ?? []), id]);
}
