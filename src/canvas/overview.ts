import { intersects, type Rect } from "./geometry/rect";

export type OverviewItem = { id: string; name: string; box: Rect; group?: string; spotlight?: boolean };
export type OverviewHeader = OverviewItem & { lines: string[]; count: number };

/** Measure at the screen-space text floor, never at the diagram's zoom. */
export function overviewName(name: string, width: number, measure: (text: string) => number): string | null {
  const text = name.trim();
  if (!text) return null;
  if (measure(text) <= width) return text;
  const chars = [...text];
  while (chars.length > 3) {
    chars.pop();
    const short = `${chars.join("").trimEnd()}…`;
    if (measure(short) <= width) return short;
  }
  return null;
}

/** Headers own their band; crowded members become one named, counted navigation target. */
export function overviewLayout(
  nodes: OverviewItem[],
  zones: OverviewItem[],
  measure: (text: string) => number,
  aggregateName: (name: string, count: number) => string,
) {
  const header = (zone: OverviewItem, count: number): OverviewHeader => {
    const lines: string[] = [];
    for (const word of (count ? aggregateName(zone.name, count) : zone.name).split(/\s+/)) {
      const last = lines.at(-1);
      if (last && measure(`${last} ${word}`) <= zone.box.width - 12) lines[lines.length - 1] += ` ${word}`;
      else lines.push(word);
    }
    return { ...zone, count, lines, box: { ...zone.box, height: lines.length * 12 + 6 } };
  };
  let headers = zones.map((zone) => header(zone, 0));
  const names = new Map(nodes.map((node) => [node.id, overviewName(node.name, node.box.width - 8, measure)]));
  const crowded = new Set<string>();
  for (const node of nodes) {
    if (node.spotlight && node.name.trim()) continue;
    if (
      !names.get(node.id) ||
      node.box.height < 16 ||
      headers.some((zone) => intersects(zone.box, node.box)) ||
      nodes.some((other) => other.id !== node.id && intersects(node.box, other.box))
    ) {
      if (node.group) crowded.add(node.group);
    }
  }
  for (;;) {
    const hidden = new Set<string>();
    const tiles: (OverviewItem & { label: string })[] = [];
    for (const node of nodes) {
      if (node.spotlight && node.name.trim()) continue; // Existing full spotlight titles stay readable.
      const label = names.get(node.id);
      if ((node.group && crowded.has(node.group)) || !label || node.box.height < 16) hidden.add(node.id);
      else tiles.push({ ...node, label });
    }
    headers = zones.map((zone) => header(zone, nodes.filter((n) => n.group === zone.id && hidden.has(n.id)).length));
    // Counts can wrap a header onto another row. Grow the crowded set until every
    // surviving tile clears every band, then publish counts from that same set.
    let changed = false;
    for (let i = tiles.length - 1; i >= 0; i--)
      if (headers.some((zone) => intersects(zone.box, tiles[i].box))) {
        const group = tiles[i].group;
        if (group && !crowded.has(group)) {
          crowded.add(group);
          changed = true;
        }
        hidden.add(tiles[i].id);
        tiles.splice(i, 1);
      }
    if (!changed) return { headers, tiles, hidden };
  }
}

/** Live's decorator supplies the current-rate quartile; narration retains its adjacent routes. */
export function overviewConnection(near: boolean, main: boolean) {
  return near || main;
}
