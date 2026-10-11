import type { DiagramFile } from "../model/types";
import { layeredLayout } from "../editor/layout";
import { boundaryAround } from "../editor/arrange";
import { estimateCardSize } from "../canvas/nodes/size";
import { placeNextTo, placeFree, overlaps, type Box } from "../canvas/placement";
import type { LayoutMode } from "./index";

export function fitGroupToContents(diagram: DiagramFile, groupId: string): DiagramFile {
  const members = diagram.nodes
    .filter((n) => n.group === groupId)
    .map((n) => ({ ...n, ...estimateCardSize(n.label, n.sublabel) }));
  return members.length
    ? { ...diagram, groups: diagram.groups?.map((g) => (g.id === groupId ? { ...g, ...boundaryAround(members) } : g)) }
    : diagram;
}
export function placeNew(
  diagram: DiagramFile,
  newIds: readonly string[],
  mode: LayoutMode = "auto",
  touchedGroups: readonly string[] = [],
): DiagramFile {
  const fresh = new Set(newIds);
  const full = mode === "full" || (mode === "auto" && fresh.size > 0 && fresh.size >= diagram.nodes.length / 2);
  let nodes = diagram.nodes.map((n) => ({ ...n }));
  if (full) {
    const positions = layeredLayout({ nodes, edges: diagram.edges, direction: diagram.direction });
    nodes = nodes.map((n) => ({ ...n, ...positions.get(n.id) }));
  } else {
    const boxes: Box[] = [
      ...nodes.filter((n) => !fresh.has(n.id)).map((n) => ({ ...n, ...estimateCardSize(n.label, n.sublabel) })),
      ...(diagram.annotations ?? []),
    ];
    for (const n of nodes.filter((n) => fresh.has(n.id))) {
      const size = estimateCardSize(n.label, n.sublabel);
      const edge =
        mode === "none"
          ? undefined
          : diagram.edges.find((e) => (e.from === n.id && !fresh.has(e.to)) || (e.to === n.id && !fresh.has(e.from)));
      const neighbor = edge && nodes.find((o) => o.id === (edge.from === n.id ? edge.to : edge.from));
      let center = neighbor
        ? placeNextTo(
            { ...neighbor, ...estimateCardSize(neighbor.label, neighbor.sublabel) },
            size,
            boxes,
            diagram.direction,
            edge!.from === n.id ? "upstream" : "downstream",
          )
        : placeFree({ x: 150, y: 100 }, size, boxes);
      const box = () => ({ x: center.x - size.width / 2, y: center.y - size.height / 2, ...size });
      if (boxes.some((o) => overlaps(box(), o))) center = placeFree(center, size, boxes);
      // placeFree's bounded search can exhaust; the rightmost free strip is deterministic.
      if (boxes.some((o) => overlaps(box(), o)))
        center = { x: Math.max(0, ...boxes.map((o) => o.x + o.width)) + 80 + size.width / 2, y: 100 };
      n.x = Math.round(center.x - size.width / 2);
      n.y = Math.round(center.y - size.height / 2);
      boxes.push({ ...n, ...size });
    }
  }
  let next = { ...diagram, nodes };
  const touched = new Set([...touchedGroups, ...nodes.filter((n) => fresh.has(n.id) && n.group).map((n) => n.group!)]);
  for (const group of next.groups ?? []) if (full || touched.has(group.id)) next = fitGroupToContents(next, group.id);
  return next;
}
