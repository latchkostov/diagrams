import type { DiagramFile } from "../model/types";
import { layeredLayout } from "../editor/layout";
import { createBoundaryRefitter, planBoundaryRefits } from "../editor/boundaryFit";
import { estimateCardSize } from "../canvas/nodes/size";
import { placeNextTo, placeFree, overlaps, type Box } from "../canvas/placement";
import type { LayoutMode } from "./index";
import { indexGroupAncestry, sanitizeGroupParents } from "../model/groupHierarchy";
import { boundaryAround } from "../editor/arrange";

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
  if (!full && !fresh.size && !touchedGroups.length) return diagram;
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
  const groups = diagram.groups ?? [];
  const groupById = new Map(groups.map((g) => [g.id, g]));
  let ancestry: ReturnType<typeof indexGroupAncestry> | undefined;
  const foreignGroups = (n: (typeof nodes)[number], candidates = groups) =>
    candidates.filter((g) => !n.group || !(ancestry ??= indexGroupAncestry(groups))(n.group, g.id));
  const includeAncestors = (ids: Iterable<string>) => {
    const result = new Set<string>();
    for (const id of ids) {
      let cur: string | undefined = id;
      while (cur && !result.has(cur)) {
        result.add(cur);
        cur = groupById.get(cur)?.group;
      }
    }
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
  const next = {
    ...diagram,
    nodes,
    ...(full ? { edges: diagram.edges.map(({ waypoints: _waypoints, ...edge }) => edge) } : {}),
    groups: diagram.groups?.map((g) => ({ ...g })),
  };
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
  // Later refits may have grown over earlier cards. Settle the hierarchy bottom-up,
  // treating fitted child boundaries as units: retrying individual cards can make
  // interleaved sibling boundaries expand over one another forever.
  if (
    next.nodes.some(
      (n) => (full || fresh.has(n.id)) && foreignGroups(n, next.groups).some((g) => overlaps(sizedById.get(n.id)!, g)),
    ) ||
    (full &&
      next.groups?.some((g, i, all) =>
        all.some((other, j) => {
          if (j <= i || !overlaps(g, other)) return false;
          const related = (ancestry ??= indexGroupAncestry(groups));
          return !related(g.id, other.id) && !related(other.id, g.id);
        }),
      ))
  )
    settleBoundaryCollisions(next, fresh, full, includeAncestors(touched));
  return next;
}

/** Repair only a layout whose final refits left a foreign-boundary collision. Each
 * boundary is settled once, then moves with its contents at its parent's level. */
function settleBoundaryCollisions(
  diagram: DiagramFile,
  fresh: ReadonlySet<string>,
  full: boolean,
  requested: ReadonlySet<string>,
) {
  const groups = diagram.groups ?? [];
  const byId = new Map(groups.map((g) => [g.id, g]));
  const nodeById = new Map(diagram.nodes.map((n) => [n.id, n]));
  const parents = sanitizeGroupParents(groups, new Set<string>());
  const children = new Map<string | undefined, string[]>();
  const members = new Map<string | undefined, typeof diagram.nodes>();
  const annotations = new Map<string | undefined, NonNullable<DiagramFile["annotations"]>>();
  for (const g of parents) {
    const list = children.get(g.group) ?? [];
    list.push(g.id);
    children.set(g.group, list);
  }
  for (const n of diagram.nodes) {
    const parent = n.group && byId.has(n.group) ? n.group : undefined;
    const list = members.get(parent) ?? [];
    list.push(n);
    members.set(parent, list);
  }
  // Translations must not mutate annotations shared with the input document.
  diagram.annotations = diagram.annotations?.map((a) => ({ ...a }));
  for (const a of diagram.annotations ?? []) {
    const parent = a.group && byId.has(a.group) ? a.group : undefined;
    const list = annotations.get(parent) ?? [];
    list.push(a);
    annotations.set(parent, list);
  }
  const moveBoundary = (root: string, dx: number, dy: number) => {
    const pending = [root];
    while (pending.length) {
      const id = pending.pop()!;
      const g = byId.get(id)!;
      g.x += dx;
      g.y += dy;
      for (const item of [...(members.get(id) ?? []), ...(annotations.get(id) ?? [])]) {
        item.x += dx;
        item.y += dy;
      }
      pending.push(...(children.get(id) ?? []));
    }
  };
  const order: (string | undefined)[] = [undefined];
  for (let i = 0; i < order.length; i++) order.push(...(children.get(order[i]) ?? []));
  for (const parent of order.reverse()) {
    const units = [
      ...(children.get(parent) ?? []).map((id) => ({ box: byId.get(id)!, movable: full, boundary: true })),
      ...(members.get(parent) ?? []).map((n) => ({
        box: { ...n, ...estimateCardSize(n.label, n.sublabel) },
        movable: full || fresh.has(n.id),
        boundary: false,
      })),
    ];
    const occupied: (Box & { id: string })[] = [
      ...(annotations.get(parent) ?? []),
      ...units.filter((u) => !u.movable).map((u) => u.box),
    ];
    for (const { box, movable, boundary } of units) {
      if (!movable) continue;
      if (occupied.some((other) => overlaps(box, other))) {
        let center = placeFree({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, box, occupied);
        const candidate = () => ({ ...box, x: center.x - box.width / 2, y: center.y - box.height / 2 });
        if (occupied.some((other) => overlaps(candidate(), other)))
          center = { x: Math.max(0, ...occupied.map((o) => o.x + o.width)) + 80 + box.width / 2, y: center.y };
        const x = Math.round(center.x - box.width / 2);
        const y = Math.round(center.y - box.height / 2);
        if (boundary) moveBoundary(box.id, x - box.x, y - box.y);
        else {
          const n = nodeById.get(box.id)!;
          n.x = x;
          n.y = y;
          Object.assign(box, { x, y });
        }
      }
      occupied.push(box);
    }
    if (parent !== undefined && (full || requested.has(parent)) && occupied.length)
      Object.assign(byId.get(parent)!, boundaryAround(occupied));
  }
}
