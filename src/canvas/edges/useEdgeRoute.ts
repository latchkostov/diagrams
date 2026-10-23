import { useSettings } from "../../harness/settings";
import { useDiagram } from "../DiagramContext";
import { useShowDependencies } from "../dependencyVisibility";
import { geometrySnapshot, subscribeGeometry } from "../shapes/geometry";
import { useSyncExternalStore, useCallback } from "react";
import { useStore, type InternalNode, type ReactFlowState } from "@xyflow/react";
import type { EdgeStyle } from "../../harness/edgeStyles";
import {
  groupHeaderRect,
  Router,
  type EdgeRoute,
  type RouteGroup,
  type RouteInput,
  type RouteNode,
} from "../geometry/router";
import type { Rect } from "../geometry/rect";
import { estimateCardSize } from "../nodes/size";
import { isObstacle } from "../annotations";
import { relationInfo } from "./relationInfo";
import type { AnnotationNodeData, DiagramFlowEdge, DiagramNodeData, FlowNode, GroupNodeData } from "../types";

type State = ReactFlowState<FlowNode, DiagramFlowEdge>;

// All edges of a canvas are routed together (ports, nudging and labels depend on each other), once
// per change of the React Flow store's nodes or edges, and shared by every FlowEdge through this
// cache. Pan / zoom only cost an identity check; a drag re-routes just the edges near the moved node.

export interface RouteOptions {
  style: EdgeStyle;
  direction: "LR" | "TB";
  /** Icon-only nodes draw their caption below the box; routes and labels avoid it too. */
  captions?: boolean;
  /** Show ▸ Dependencies is off: dependency edges aren't drawn, so they take no ports or label room. */
  hideDependencies?: boolean;
}

interface Entry {
  router: Router;
  state?: unknown;
  optsKey?: string;
  nodes: InternalNode<FlowNode>[];
  edges?: readonly DiagramFlowEdge[];
  routes: Map<string, EdgeRoute>;
  /** Wall time of the last full routing pass (ms). */
  ms: number;
}

const entries = new WeakMap<object, Map<string, Entry>>();

/** Every canvas consumer uses the same view options, including dependency visibility. */
export function useRoutingOptions(overrides?: Pick<RouteOptions, "style" | "direction" | "captions">): RouteOptions {
  const { edgeStyle, nodeVariant } = useSettings();
  const { direction } = useDiagram();
  const showDependencies = useShowDependencies();
  return {
    style: edgeStyle,
    direction,
    captions: nodeVariant === "iconOnly",
    ...overrides,
    hideDependencies: !showDependencies,
  };
}

function rectOf(n: InternalNode<FlowNode>): Rect {
  const d = n.data as Partial<DiagramNodeData>;
  const est = n.type === "diagram" ? estimateCardSize(d.label ?? "", d.sublabel) : { width: 0, height: 0 };
  return {
    x: n.internals.positionAbsolute.x,
    y: n.internals.positionAbsolute.y,
    width: n.measured?.width ?? n.width ?? est.width,
    height: n.measured?.height ?? n.height ?? est.height,
  };
}

/** Naming and accessible-name updates don't change routing until the measured bounds change. */
function sameRoutingNode(a: InternalNode<FlowNode>, b: InternalNode<FlowNode>): boolean {
  if (a === b) return true;
  if (a.id !== b.id || a.type !== b.type) return false;
  if (a.type === "annotation" && (a.data as AnnotationNodeData).shape !== (b.data as AnnotationNodeData).shape)
    return false;
  if (a.type === "boundary") {
    const x = a.data as GroupNodeData;
    const y = b.data as GroupNodeData;
    if (x.groupId !== y.groupId || x.label !== y.label) return false;
  }
  const x = rectOf(a);
  const y = rectOf(b);
  return x.x === y.x && x.y === y.y && x.width === y.width && x.height === y.height;
}

function sameRoutingEdges(a: readonly DiagramFlowEdge[] | undefined, b: readonly DiagramFlowEdge[]): boolean {
  return (
    a === b ||
    (!!a &&
      a.length === b.length &&
      a.every((e, i) => {
        const next = b[i];
        return (
          e === next ||
          (e.id === next.id &&
            e.source === next.source &&
            e.target === next.target &&
            e.hidden === next.hidden &&
            e.data === next.data)
        );
      }))
  );
}

export function routeInputFromStore(
  nodes: Iterable<InternalNode<FlowNode>>,
  edges: readonly DiagramFlowEdge[],
  opts: RouteOptions,
): RouteInput {
  const routeNodes: RouteNode[] = [];
  const groups: RouteGroup[] = [];
  for (const n of nodes) {
    if (n.hidden) continue;
    // Zones and text aren't obstacles (edges may pass over them) and take no edges: leave them out.
    // Notes and shapes are solid, like nodes; shapes may also be edge ends.
    if (n.type === "annotation" && !isObstacle((n.data as AnnotationNodeData).kind)) continue;
    const rect = rectOf(n);
    if (n.type === "boundary") {
      const g = n.data as GroupNodeData;
      groups.push({ id: g.groupId, rect, header: groupHeaderRect(rect, g.label) });
    } else
      routeNodes.push({
        id: n.id,
        rect:
          n.type === "annotation" && (n.data as AnnotationNodeData).kind === "shape"
            ? { ...rect, shape: (n.data as AnnotationNodeData).shape ?? "rect" }
            : rect,
        extra:
          opts.captions && n.type === "diagram"
            ? { x: rect.x + rect.width / 2 - 90, y: rect.y + rect.height + 6, width: 180, height: 34 }
            : undefined,
      });
  }
  const deps = relationInfo(edges);
  return {
    nodes: routeNodes,
    groups,
    direction: opts.direction,
    style: opts.style,
    edges: edges
      .filter((e) => !e.hidden && !(opts.hideDependencies && deps.has(e.id)))
      .map((e) => {
        const dep = deps.get(e.id);
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          sourceSide: e.data?.sourceSide,
          targetSide: e.data?.targetSide,
          waypoints: e.data?.waypoints,
          label: dep ? dep.text : e.data?.label,
          ...(dep ? { glyph: true } : {}),
        };
      }),
  };
}

/** Routes for every edge in the store (memoised per store state). */
export function selectRoutes(
  s: ReactFlowState<FlowNode, DiagramFlowEdge>,
  opts: RouteOptions,
  revision = geometrySnapshot(),
): Map<string, EdgeRoute> {
  const optsKey = `${opts.style}|${opts.direction}|${opts.captions ? 1 : 0}|${opts.hideDependencies ? 1 : 0}|${revision}`;
  let byOptions = entries.get(s.nodeLookup);
  if (!byOptions) {
    byOptions = new Map();
    entries.set(s.nodeLookup, byOptions);
  }
  let e = byOptions.get(optsKey);
  if (!e) {
    e = { router: new Router(), nodes: [], routes: new Map(), ms: 0 };
    byOptions.set(optsKey, e);
  }
  if (e.state === s && e.optsKey === optsKey) return e.routes;
  // React Flow replaces internal nodes for a name/selection change too. Only geometry affects routes;
  // edge copies with refreshed aria labels still carry the same routing data.
  const relevantNodes = [...s.nodeLookup.values()].filter(
    (n) => !n.hidden && (n.type !== "annotation" || isObstacle((n.data as AnnotationNodeData).kind)),
  );
  let same = e.optsKey === optsKey && sameRoutingEdges(e.edges, s.edges) && e.nodes.length === relevantNodes.length;
  if (same) {
    let i = 0;
    for (const n of relevantNodes)
      if (!sameRoutingNode(e.nodes[i++], n)) {
        same = false;
        break;
      }
  }
  e.state = s;
  e.nodes = relevantNodes;
  e.edges = s.edges;
  if (same) return e.routes;
  const t0 = performance.now();
  e.optsKey = optsKey;
  e.routes = e.router.route(routeInputFromStore(e.nodes, s.edges, opts));
  e.ms = performance.now() - t0;
  return e.routes;
}

/** Duration of the last routing pass for this store, for the Lab's perf readout. */
export function lastRoutingMs(s: ReactFlowState<FlowNode, DiagramFlowEdge>): number {
  return Math.max(0, ...[...(entries.get(s.nodeLookup)?.values() ?? [])].map((e) => e.ms));
}

export function useEdgeRoute(id: string, opts: RouteOptions): EdgeRoute | undefined {
  const geometryReady = useSyncExternalStore(subscribeGeometry, geometrySnapshot, geometrySnapshot);
  const { style, direction, captions, hideDependencies } = opts;
  return useStore(
    useCallback(
      (s: ReactFlowState) =>
        selectRoutes(s as unknown as State, { style, direction, captions, hideDependencies }, geometryReady).get(id),
      [id, style, direction, captions, hideDependencies, geometryReady],
    ),
  );
}

/** Every route (for overlays such as the Lab's overlap audit). */
export function useAllRoutes(opts: RouteOptions): Map<string, EdgeRoute> {
  const geometryReady = useSyncExternalStore(subscribeGeometry, geometrySnapshot, geometrySnapshot);
  const { style, direction, captions, hideDependencies } = opts;
  return useStore(
    useCallback(
      (s: ReactFlowState) =>
        selectRoutes(s as unknown as State, { style, direction, captions, hideDependencies }, geometryReady),
      [style, direction, captions, hideDependencies, geometryReady],
    ),
  );
}
