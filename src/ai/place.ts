import type { DiagramFile } from "../model/types";
import { layeredLayout } from "../editor/layout";
import { createBoundaryRefitter, planBoundaryRefits } from "../editor/boundaryFit";
import { estimateCardSize } from "../canvas/nodes/size";
import { placeNextTo, placeFree, overlaps, type Box } from "../canvas/placement";
import type { LayoutMode } from "./index";
import { ancestorGroupIds } from "../model/groupHierarchy";

export function fitGroupToContents(diagram: DiagramFile, groupId: string): DiagramFile {
  return fitGroups(diagram, new Set([groupId]));
}

export function fitGroups(diagram: DiagramFile, requested?: ReadonlySet<string>): DiagramFile {
  if (!diagram.groups?.length || requested?.size === 0) return diagram;
  const refits = planBoundaryRefits(
    diagram.groups ?? [],
    [...diagram.nodes.map((n) => ({ ...n, ...estimateCardSize(n.label, n.sublabel) })), ...(diagram.annotations ?? [])],
    requested,
  );
  return refits.size
    ? {
        ...diagram,
        groups: diagram.groups?.map((g) => {
          const bounds = refits.get(g.id);
          return bounds ? { ...g, ...bounds } : g;
        }),
      }
    : diagram;
}

/**
 * How placeNew treats the existing nodes: the edit ops' layout modes, plus "incremental", which
 * places the new nodes next to their neighbours like "auto" but never lays out the whole diagram,
 * however many nodes are new (a pasted file's nodes without coordinates).
 */
export type PlaceMode = LayoutMode | "incremental";

/**
 * Gives the nodes in `newIds` positions and fits the boundaries they touch. A new node without a
 * boundary joins its only neighbour's, unless it's in `keepOutside`: an op that took it out, or a
 * whole file whose membership is as written.
 */
export function placeNew(
  diagram: DiagramFile,
  newIds: readonly string[],
  mode: PlaceMode = "auto",
  touchedGroups: readonly string[] = [],
  keepOutside: readonly string[] = [],
): DiagramFile {
  const fresh = new Set(newIds);
  const full = mode === "full" || (mode === "auto" && fresh.size > 0 && fresh.size >= diagram.nodes.length / 2);
  let nodes = diagram.nodes.map((n) => ({ ...n }));
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const neighbors = new Map<string, Set<string>>();
  for (const edge of diagram.edges) {
    for (const [id, other] of [
      [edge.from, edge.to],
      [edge.to, edge.from],
    ]) {
      if (!fresh.has(id) || id === other) continue;
      const links = neighbors.get(id) ?? new Set<string>();
      links.add(other);
      neighbors.set(id, links);
    }
  }
  const outside = new Set(keepOutside);
  for (const n of nodes) {
    if (!fresh.has(n.id) || n.group || outside.has(n.id)) continue;
    const links = neighbors.get(n.id);
    if (links?.size === 1) {
      const group = nodeById.get([...links][0])?.group;
      if (group) n.group = group;
    }
  }
  const ancestry = new Map<string, Set<string>>();
  const groups = diagram.groups ?? [];
  const groupById = new Map(groups.map((g) => [g.id, g]));
  for (const n of nodes) {
    if (!n.group || ancestry.has(n.group)) continue;
    ancestry.set(n.group, new Set([n.group, ...ancestorGroupIds(n.group, groups, groupById)]));
  }
  const foreignGroups = (n: (typeof nodes)[number], candidates = groups) =>
    candidates.filter((g) => !n.group || !ancestry.get(n.group)?.has(g.id));
  const includeAncestors = (ids: Iterable<string>) => {
    const result = new Set(ids);
    for (const id of ids)
      for (const ancestor of ancestry.get(id) ?? ancestorGroupIds(id, groups, groupById)) result.add(ancestor);
    return result;
  };
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
      const occupied = [...boxes, ...foreignGroups(n)];
      const edge =
        mode === "none"
          ? undefined
          : diagram.edges.find((e) => (e.from === n.id && !fresh.has(e.to)) || (e.to === n.id && !fresh.has(e.from)));
      const neighbor = edge && nodes.find((o) => o.id === (edge.from === n.id ? edge.to : edge.from));
      let center = neighbor
        ? placeNextTo(
            { ...neighbor, ...estimateCardSize(neighbor.label, neighbor.sublabel) },
            size,
            occupied,
            diagram.direction,
            edge!.from === n.id ? "upstream" : "downstream",
          )
        : placeFree({ x: 150, y: 100 }, size, occupied);
      const box = () => ({ x: center.x - size.width / 2, y: center.y - size.height / 2, ...size });
      if (occupied.some((o) => overlaps(box(), o))) center = placeFree(center, size, occupied);
      // placeFree's bounded search can exhaust; the rightmost free strip is deterministic.
      if (occupied.some((o) => overlaps(box(), o)))
        center = { x: Math.max(0, ...occupied.map((o) => o.x + o.width)) + 80 + size.width / 2, y: 100 };
      n.x = Math.round(center.x - size.width / 2);
      n.y = Math.round(center.y - size.height / 2);
      boxes.push({ ...n, ...size });
    }
  }
  const next = { ...diagram, nodes, groups: diagram.groups?.map((g) => ({ ...g })) };
  const nextGroups = new Map(next.groups?.map((g) => [g.id, g]));
  const sized = nodes.map((n) => ({ ...n, ...estimateCardSize(n.label, n.sublabel) }));
  const sizedById = new Map(sized.map((n) => [n.id, n]));
  const planRefits = createBoundaryRefitter(groups, [...sized, ...(diagram.annotations ?? [])]);
  const refit = (requested?: ReadonlySet<string>) => {
    for (const [id, bounds] of planRefits(requested)) Object.assign(nextGroups.get(id)!, bounds);
  };
  const touched = new Set([...touchedGroups, ...nodes.filter((n) => fresh.has(n.id) && n.group).map((n) => n.group!)]);
  refit(full ? undefined : includeAncestors(touched));
  // Fitting a boundary can enclose an unrelated addition, especially after a full layout.
  // Place those cards clear of every foreign boundary as well as the other cards.
  for (const n of next.nodes) {
    if (!full && !fresh.has(n.id)) continue;
    const foreign = foreignGroups(n, next.groups);
    const size = estimateCardSize(n.label, n.sublabel);
    if (!foreign.some((g) => overlaps({ ...n, ...size }, g))) continue;
    const occupied = [
      ...next.nodes.filter((o) => o.id !== n.id).map((o) => ({ ...o, ...estimateCardSize(o.label, o.sublabel) })),
      ...(next.annotations ?? []),
      ...foreign,
    ];
    let center = placeFree({ x: n.x + size.width / 2, y: n.y + size.height / 2 }, size, occupied);
    if (occupied.some((o) => overlaps({ x: center.x - size.width / 2, y: center.y - size.height / 2, ...size }, o)))
      center = { x: Math.max(0, ...occupied.map((o) => o.x + o.width)) + 80 + size.width / 2, y: center.y };
    n.x = Math.round(center.x - size.width / 2);
    n.y = Math.round(center.y - size.height / 2);
    Object.assign(sizedById.get(n.id)!, { x: n.x, y: n.y });
    if (n.group) refit(includeAncestors([n.group]));
  }
  return next;
}
