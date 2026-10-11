import { useCallback } from "react";
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
}

interface Entry {
  router: Router;
  state?: unknown;
  optsKey?: string;
  nodes: InternalNode<FlowNode>[];
  edges?: unknown;
  routes: Map<string, EdgeRoute>;
  /** Wall time of the last full routing pass (ms). */
  ms: number;
}

const entries = new WeakMap<object, Entry>();

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
        rect,
        extra:
          opts.captions && n.type === "diagram"
            ? { x: rect.x + rect.width / 2 - 90, y: rect.y + rect.height + 6, width: 180, height: 34 }
            : undefined,
      });
  }
  return {
    nodes: routeNodes,
    groups,
    direction: opts.direction,
    style: opts.style,
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceSide: e.data?.sourceSide,
      targetSide: e.data?.targetSide,
      label: e.data?.label,
    })),
  };
}

/** Routes for every edge in the store (memoised per store state). */
export function selectRoutes(s: ReactFlowState<FlowNode, DiagramFlowEdge>, opts: RouteOptions): Map<string, EdgeRoute> {
  let e = entries.get(s.nodeLookup);
  if (!e) {
    e = { router: new Router(), nodes: [], routes: new Map(), ms: 0 };
    entries.set(s.nodeLookup, e);
  }
  const optsKey = `${opts.style}|${opts.direction}|${opts.captions ? 1 : 0}`;
  if (e.state === s && e.optsKey === optsKey) return e.routes;
  // Same nodes (by identity: React Flow replaces an internal node whenever it changes) and edges?
  let same = e.optsKey === optsKey && e.edges === s.edges && e.nodes.length === s.nodeLookup.size;
  if (same) {
    let i = 0;
    for (const n of s.nodeLookup.values())
      if (e.nodes[i++] !== n) {
        same = false;
        break;
      }
  }
  e.state = s;
  if (same) return e.routes;
  const t0 = performance.now();
  e.nodes = [...s.nodeLookup.values()];
  e.edges = s.edges;
  e.optsKey = optsKey;
  e.routes = e.router.route(routeInputFromStore(e.nodes, s.edges, opts));
  e.ms = performance.now() - t0;
  return e.routes;
}

/** Duration of the last routing pass for this store, for the Lab's perf readout. */
export function lastRoutingMs(s: ReactFlowState<FlowNode, DiagramFlowEdge>): number {
  return entries.get(s.nodeLookup)?.ms ?? 0;
}

export function useEdgeRoute(id: string, opts: RouteOptions): EdgeRoute | undefined {
  const { style, direction, captions } = opts;
  return useStore(
    useCallback(
      (s: ReactFlowState) => selectRoutes(s as unknown as State, { style, direction, captions }).get(id),
      [id, style, direction, captions],
    ),
  );
}

/** Every route (for overlays such as the Lab's overlap audit). */
export function useAllRoutes(opts: RouteOptions): Map<string, EdgeRoute> {
  const { style, direction, captions } = opts;
  return useStore(
    useCallback(
      (s: ReactFlowState) => selectRoutes(s as unknown as State, { style, direction, captions }),
      [style, direction, captions],
    ),
  );
}
