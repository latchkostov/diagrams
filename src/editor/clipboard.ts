import { borderRadius } from "../model/borderRadius";
import { validWaypoints } from "../model/edgeRoute";
import { validDocumentation } from "../model/documentation";
import { revisionAtLeast } from "../model/revisions";
import {
  DIAGRAM_FORMAT,
  type DiagramAnnotation,
  type DiagramEdge,
  type DiagramFile,
  type DiagramGroup,
  type DiagramNode,
} from "../model/types";
import { createResourceValidator } from "../model/resourceValidation";
import { filterLayerOrder } from "../model/layers";
import { expandGroupIds, sanitizeGroupParents } from "../model/groupHierarchy";
import { isPresetGroupTone } from "../canvas/groupTones";
import { isHexColor } from "../model/colors";
import { uniqueId } from "./ids";
import { normalizeAnnotation, annotationCoordinate } from "../model/annotations";
import { cloneAnnotation } from "./cloneAnnotation";
import { LIMITS, exceedsDepth, validateDiagram } from "../interop/native";

import { propsProblem, unsupportedPreset, invalidPlanningDelay } from "../model/simProps";
import { clipboardNodes } from "../model/planning";
import { remapConnection } from "../model/connectionDefaults";
import { remapScaler, scalerGroupRemap } from "../model/kedaBindings";
import {
  checkAddress,
  hasEdgeRouting,
  hasNodeRouting,
  requestRoutesSchema,
  routingEnabled,
  type RequestRoute,
  type RouteTable,
  type TrafficMix,
} from "../model/requestRouting";
import { checkJsonSchema } from "../model/jsonSchema";

// Copy / paste on the saved-file level, so it is pure and the system clipboard carries plain
// JSON that also pastes into another tab (or a text editor).

export const CLIP_FORMAT = "diagrams/clip-v1" as const;
export const CLIP_FORMAT_A1 = "diagrams/clip-v2" as const;

export interface ClipboardPayload {
  format: typeof CLIP_FORMAT | typeof CLIP_FORMAT_A1;
  planning?: { revision: "p3-a1" };
  /** Foreground ids, back to front, in the shared node/annotation namespace. */
  layerOrder?: string[];
  groups: DiagramGroup[];
  nodes: DiagramNode[];
  /** Only edges whose both ends were copied. */
  edges: DiagramEdge[];
  /** Texts, notes, zones and shapes (absent in payloads from before annotations). */
  annotations?: DiagramAnnotation[];
  /** Copied from a private diagram: pasting it makes the target diagram private too. */
  private?: boolean;
  /** Request routing: the definitions the copied mixes and caller addresses use (merged into the target's). */
  requestRoutes?: RequestRoute[];
  /** Set by remapPayload, never serialized: copied routers whose table lost a connection (so it wasn't kept). */
  droppedTables?: string[];
}

export interface TakenIds {
  nodes: ReadonlySet<string>;
  edges: ReadonlySet<string>;
  groups: ReadonlySet<string>;
}

/**
 * Builds a payload from a selection. Copying a group copies the nodes inside it too. `nodeIds` may
 * name annotations as well (they share the node namespace).
 */
export function makePayload(
  d: DiagramFile,
  nodeIds: Iterable<string>,
  groupIds: Iterable<string> = [],
  isPrivate = false,
): ClipboardPayload | null {
  const gs = expandGroupIds(groupIds, d.groups ?? []);
  const groups = (d.groups ?? []).filter((g) => gs.has(g.id));
  const ns = new Set(nodeIds);
  for (const n of d.nodes) if (n.group && gs.has(n.group)) ns.add(n.id);
  for (const a of d.annotations ?? []) if (a.group && gs.has(a.group)) ns.add(a.id);
  const nodes = clipboardNodes(d).filter((n) => ns.has(n.id));
  const annotations = (d.annotations ?? []).filter((a) => ns.has(a.id));
  if (!nodes.length && !groups.length && !annotations.length) return null;
  const edges = d.edges.filter((e) => ns.has(e.from) && ns.has(e.to));
  const routeIds = new Set<string>();
  if (routingEnabled(d.planning)) {
    for (const n of nodes)
      for (const e of ((n.props as Record<string, unknown> | undefined)?.trafficMix as TrafficMix | undefined)
        ?.entries ?? [])
        routeIds.add(e.routeId);
    for (const e of edges) if (typeof e.props?.requestRouteId === "string") routeIds.add(e.props.requestRouteId);
  }
  const requestRoutes = (d.planning?.requestRoutes ?? []).filter((r) => routeIds.has(r.id));
  return structuredClone({
    format: revisionAtLeast(d.planning?.revision, "p3-a1") ? CLIP_FORMAT_A1 : CLIP_FORMAT,
    ...(revisionAtLeast(d.planning?.revision, "p3-a1") ? { planning: { revision: "p3-a1" as const } } : {}),
    groups,
    nodes,
    edges,
    ...(annotations.length ? { annotations } : {}),
    ...(d.layerOrder ? { layerOrder: filterLayerOrder(d.layerOrder, { nodes, annotations }) } : {}),
    ...(isPrivate ? { private: true } : {}),
    ...(requestRoutes.length ? { requestRoutes } : {}),
  });
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** A finite number within the file format's coordinate budget (positions and sizes alike). */
const isCoordinate = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= LIMITS.maxCoordinate;

/** Accepts a clipboard payload or a supported whole diagram file (pasting a file merges it in). */
export function parsePayload(text: string): ClipboardPayload | null {
  if (text.length > LIMITS.maxTextChars) return null;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    !isObj(data) ||
    (data.format !== CLIP_FORMAT &&
      data.format !== CLIP_FORMAT_A1 &&
      data.format !== DIAGRAM_FORMAT &&
      data.format !== "diagrams/v2")
  )
    return null;
  if (data.format === CLIP_FORMAT_A1 && (!isObj(data.planning) || !revisionAtLeast(data.planning.revision, "p3-a1")))
    return null;
  if (data.format !== CLIP_FORMAT && data.format !== CLIP_FORMAT_A1) {
    const result = validateDiagram(data);
    if (!result.ok) return null;
    data = { ...result.diagram, nodes: clipboardNodes(result.diagram), format: CLIP_FORMAT };
  }
  if (!isObj(data)) return null;
  if (!Array.isArray(data.nodes)) return null;
  if (exceedsDepth(data)) return null;
  for (const [list, max] of [
    [data.nodes, LIMITS.maxNodes],
    [data.annotations, LIMITS.maxAnnotations],
    [data.edges, LIMITS.maxEdges],
    [data.groups, LIMITS.maxGroups],
  ] as const)
    if (Array.isArray(list) && list.length > max) return null;
  const nodes = data.nodes.filter(
    (n): n is DiagramNode =>
      isObj(n) && typeof n.id === "string" && typeof n.stencil === "string" && isCoordinate(n.x) && isCoordinate(n.y),
  );
  if (nodes.some((n) => !validDocumentation(n.description))) return null;
  if (nodes.some((n) => n.props !== undefined && (unsupportedPreset(n.props) || propsProblem(n.props)))) return null;
  if (
    createResourceValidator({ fragment: true })({
      nodes,
      planning:
        isObj(data.planning) && revisionAtLeast(data.planning.revision, "p3-a1") ? { revision: "p3-a1" } : undefined,
    })
  )
    return null;
  const used = new Set(nodes.map((n) => n.id));
  const annotations: DiagramAnnotation[] = [];
  for (const raw of Array.isArray(data.annotations) ? data.annotations : []) {
    const a = normalizeAnnotation(raw, used);
    if (a) {
      annotations.push(a);
      used.add(a.id);
    }
  }
  const ids = new Set([...nodes.map((n) => n.id), ...annotations.filter((a) => a.kind === "shape").map((a) => a.id)]);
  const edges = (Array.isArray(data.edges) ? data.edges : []).filter(
    (e): e is DiagramEdge =>
      isObj(e) && typeof e.id === "string" && ids.has(e.from as string) && ids.has(e.to as string),
  );
  if (edges.some((e) => invalidPlanningDelay(e.props) || (e.waypoints !== undefined && !validWaypoints(e.waypoints))))
    return null;
  const groups = (Array.isArray(data.groups) ? data.groups : []).filter(
    (g): g is DiagramGroup =>
      isObj(g) &&
      typeof g.id === "string" &&
      isCoordinate(g.x) &&
      isCoordinate(g.y) &&
      isCoordinate(g.width) &&
      isCoordinate(g.height) &&
      (g.width as number) >= 0 &&
      (g.height as number) >= 0,
  );
  if (!nodes.length && !groups.length && !annotations.length) return null;
  // Routing travels only with the current planning model, and only with valid route definitions.
  const a1 = isObj(data.planning) && revisionAtLeast(data.planning.revision, "p3-a1");
  const routes =
    isObj(data.planning) && Array.isArray(data.planning.requestRoutes)
      ? data.planning.requestRoutes
      : data.requestRoutes;
  let requestRoutes: RequestRoute[] | undefined;
  if (routes !== undefined) {
    try {
      checkJsonSchema(routes, requestRoutesSchema, "requestRoutes");
      (routes as RequestRoute[]).forEach((r, i) => checkAddress(r.address, `requestRoutes[${i}].address`));
      requestRoutes = routes as RequestRoute[];
    } catch {
      return null;
    }
  }
  if (!a1 && (nodes.some((n) => hasNodeRouting(n.props)) || edges.some((e) => hasEdgeRouting(e.props)))) return null;
  return {
    ...(requestRoutes?.length ? { requestRoutes } : {}),
    format: isObj(data.planning) && revisionAtLeast(data.planning.revision, "p3-a1") ? CLIP_FORMAT_A1 : CLIP_FORMAT,
    ...(isObj(data.planning) && revisionAtLeast(data.planning.revision, "p3-a1")
      ? { planning: { revision: "p3-a1" as const } }
      : {}),
    groups: groups.map((g) => ({
      ...g,
      borderRadius: borderRadius(g.borderRadius),
      tone: isPresetGroupTone(g.tone) || isHexColor(g.tone) ? g.tone : "neutral",
    })),
    nodes: nodes.map((n) => ({ ...n, label: n.label ?? "" })),
    edges,
    ...(annotations.length ? { annotations } : {}),
    ...(Array.isArray(data.layerOrder)
      ? { layerOrder: filterLayerOrder(data.layerOrder, { nodes, annotations }) }
      : {}),
    // Fails closed, like a file's "private": anything but absent or false keeps the paste private.
    ...(data.private !== undefined && data.private !== false ? { private: true } : {}),
  };
}

/**
 * The payload's request routes merged into the target's: the same id and address is the same route (reused);
 * a missing one is added; the same id with another address is a different route, added under a new id. Returns the
 * merged list and the payload's nodes and edges with their references remapped.
 */
export function mergeRoutes(
  target: readonly RequestRoute[],
  p: Pick<ClipboardPayload, "requestRoutes" | "nodes" | "edges">,
): { routes: RequestRoute[]; nodes: DiagramNode[]; edges: DiagramEdge[] } {
  const routes = [...target];
  const ids = new Map<string, string>();
  const used = new Set(routes.map((r) => r.id));
  for (const route of p.requestRoutes ?? []) {
    const same = routes.find((r) => r.id === route.id);
    if (same && JSON.stringify(same.address) === JSON.stringify(route.address)) continue;
    const id = same ? uniqueId(route.id, used) : route.id;
    used.add(id);
    ids.set(route.id, id);
    routes.push({ ...structuredClone(route), id });
  }
  if (!ids.size) return { routes, nodes: p.nodes, edges: p.edges };
  const nodes = p.nodes.map((n) => {
    const mix = n.props?.trafficMix as TrafficMix | undefined;
    if (!mix?.entries) return n;
    return {
      ...n,
      props: {
        ...n.props,
        trafficMix: { ...mix, entries: mix.entries.map((e) => ({ ...e, routeId: ids.get(e.routeId) ?? e.routeId })) },
      },
    };
  });
  const edges = p.edges.map((e) =>
    typeof e.props?.requestRouteId === "string" && ids.has(e.props.requestRouteId)
      ? { ...e, props: { ...e.props, requestRouteId: ids.get(e.props.requestRouteId) } }
      : e,
  );
  return { routes, nodes, edges };
}

/** Top-left of everything in the payload. */
export function payloadOrigin(p: ClipboardPayload): { x: number; y: number } {
  const as = p.annotations ?? [];
  const xs = [...p.nodes.map((n) => n.x), ...p.groups.map((g) => g.x), ...as.map((a) => a.x)];
  const ys = [...p.nodes.map((n) => n.y), ...p.groups.map((g) => g.y), ...as.map((a) => a.y)];
  return { x: Math.min(...xs), y: Math.min(...ys) };
}

/**
 * Gives every element a fresh id (not in `taken`), rewires edges and group references, and moves
 * everything by `offset`. Node `group` references to groups outside the payload are kept as-is.
 */
export function remapPayload(
  p: ClipboardPayload,
  taken: TakenIds,
  offset: { x: number; y: number },
  allocateId = uniqueId,
): ClipboardPayload {
  // One id space for every kind: a pasted node never takes a connection's or a boundary's id.
  const used = new Set([...taken.nodes, ...taken.edges, ...taken.groups]);
  const gmap = new Map<string, string>();
  const nmap = new Map<string, string>();
  const emap = new Map<string, string>();
  const groupIds = p.groups.map((g) => {
    const id = allocateId(g.id, used);
    used.add(id);
    if (!gmap.has(g.id)) gmap.set(g.id, id);
    return id;
  });
  const groups = sanitizeGroupParents(
    p.groups.map((g, i) => {
      const id = groupIds[i];
      const group = typeof g.group === "string" ? (gmap.get(g.group) ?? g.group) : undefined;
      return { ...g, id, group, x: g.x + offset.x, y: g.y + offset.y };
    }),
    taken.groups,
  );
  const nodes = p.nodes.map((n) => {
    const id = allocateId(n.id, used);
    used.add(id);
    nmap.set(n.id, id);
    const group = n.group ? (gmap.get(n.group) ?? n.group) : undefined;
    return { ...structuredClone(n), id, group, x: n.x + offset.x, y: n.y + offset.y };
  });
  const annotations = (p.annotations ?? []).map((a) => {
    const id = allocateId(a.id, used);
    used.add(id);
    nmap.set(a.id, id);
    const group = a.group ? (gmap.get(a.group) ?? a.group) : undefined;
    return cloneAnnotation(a, {
      id,
      group,
      x: annotationCoordinate(a.x + offset.x),
      y: annotationCoordinate(a.y + offset.y),
    });
  });
  const edges = p.edges.map((e) => {
    const id = allocateId(e.id, used);
    used.add(id);
    emap.set(e.id, id);
    return {
      ...remapConnection(e, nmap),
      id,
      ...(e.waypoints ? { waypoints: e.waypoints.map((p) => ({ x: p.x + offset.x, y: p.y + offset.y })) } : {}),
    };
  });
  const scalerGroups = scalerGroupRemap(p.edges, nmap, emap);
  for (const n of nodes) remapScaler(n.props, nmap, scalerGroups);
  // A copied router's table follows its copied connections; one that lost a connection isn't kept (it could only
  // send that rule's requests somewhere else), and the editor says so.
  const droppedTables: string[] = [];
  for (const n of nodes) {
    const table = n.props?.routeTable as RouteTable | undefined;
    if (!table || !Array.isArray(table.rules)) continue;
    const actions = [...table.rules, ...(table.default ? [table.default] : [])];
    if (actions.every((a) => a.targets.every((t) => emap.has(t.edgeId)))) {
      const remap = <A extends { targets: { edgeId: string; weight: number }[] }>(a: A): A => ({
        ...a,
        targets: a.targets.map((t) => ({ ...t, edgeId: emap.get(t.edgeId)! })),
      });
      n.props = {
        ...n.props,
        routeTable: {
          ...table,
          rules: table.rules.map(remap),
          ...(table.default ? { default: remap(table.default) } : {}),
        },
      };
    } else {
      const props = { ...n.props };
      delete props.routeTable;
      n.props = props;
      droppedTables.push(n.label || n.id);
    }
  }
  return {
    ...(p.requestRoutes ? { requestRoutes: p.requestRoutes } : {}),
    ...(droppedTables.length ? { droppedTables } : {}),
    format: p.format,
    ...(p.planning ? { planning: p.planning } : {}),
    groups,
    nodes,
    edges,
    ...(annotations.length ? { annotations } : {}),
    ...(p.layerOrder ? { layerOrder: filterLayerOrder(p.layerOrder, p)?.map((id) => nmap.get(id)!) } : {}),
  };
}
