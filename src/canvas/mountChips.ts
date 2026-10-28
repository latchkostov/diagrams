import { flushSync } from "react-dom";
import type { useStoreApi } from "@xyflow/react";
import type { DiagramFlowEdge, FlowNode } from "./types";
import { chipMeasurer, layoutChips } from "./chipLayout";
import { ChipNode, chipEdge } from "./nodes/ChipNode";
import { chipEdges } from "./chipEdges";
import { selectRoutes, type RouteOptions } from "./edges/useEdgeRoute";
import type { ChipLayout, ChipState, EdgeChip, LowZoom } from "./lowZoom";
import { registerFrameCapture } from "./camera/frameCapture";
import { subscribeGeometry } from "./shapes/geometry";
import { safeStorage } from "../lib/storage";

/** Publication code stays in the lazy surface too. */
function setLowZoom(store: ReturnType<typeof useStoreApi<FlowNode, DiagramFlowEdge>>, value: LowZoom | null) {
  store.setState({ ldChips: value } as Partial<ChipState>);
}

/** Keeps the previous entry when nothing in it changed, so its subscriber doesn't render again. */
function share<T extends object>(next: Map<string, T>, previous: Map<string, T> | undefined) {
  for (const [id, value] of next) {
    const old = previous?.get(id);
    if (old && JSON.stringify(old) === JSON.stringify(value)) next.set(id, old);
  }
  return next;
}

/** The lazy identity surface owns fitting; renderers only subscribe to its settled result. */
export function mountChips(
  root: HTMLElement,
  store: ReturnType<typeof useStoreApi<FlowNode, DiagramFlowEdge>>,
  camera: { readonly phase: string; readonly interacting: boolean; subscribe(listener: () => void): () => void } | null,
  options: RouteOptions,
) {
  const context = document.createElement("canvas").getContext("2d");
  // The browser parity tier pins the natural drawing at every fitted zoom (docs/PARITY.md).
  if (!context || safeStorage.getItem("diagrams.lowZoom") === "off") return () => {};
  const font = getComputedStyle(root).fontFamily;
  const measure = chipMeasurer((text, size) => {
    context.font = `560 ${size}px ${font}`;
    return context.measureText(text.slice(0, 512)).width;
  });
  let frame = 0,
    disposed = false,
    suspended = false,
    ready = false,
    previous = "",
    fits = 0;
  /** Back to natural cards (zone titles keep their own bands: FrameDetail's placeRegionTitles). */
  const natural = () => root.removeAttribute("data-low-zoom");
  const clear = () => {
    if (previous) {
      previous = "";
      natural();
      setLowZoom(store, null);
    }
  };
  const update = () => {
    frame = 0;
    const state = store.getState();
    if (disposed || suspended || !ready) return;
    // Slow motion replays over the natural drawing, at any zoom, from its first frame (its camera may be moving).
    if (root.querySelector("[data-live-slowmo]")) return clear();
    if (
      root.hasAttribute("data-viewport-moving") ||
      (camera && (camera.phase !== "idle" || camera.interacting)) ||
      // While a node is held, its routes follow the pointer; fitting waits for the release.
      state.nodes.some((n) => n.dragging)
    )
      return;
    const zoom = state.transform[2];
    if (zoom >= 0.6) return clear();
    const visible = [...state.nodeLookup.values()].filter((n) => !n.hidden && n.measured?.width && n.measured.height);
    const nodes = visible.flatMap((n) => {
      if (n.type !== "diagram") return [];
      return [
        {
          id: n.id,
          label: "label" in n.data ? n.data.label : n.id,
          ...n.internals.positionAbsolute,
          width: n.measured!.width!,
          height: n.measured!.height!,
        },
      ];
    });
    const obstacles = visible
      .filter((n) => n.type === "annotation" && "kind" in n.data && n.data.kind !== "zone")
      .map((n) => ({
        ...n.internals.positionAbsolute,
        width: n.measured!.width!,
        height: n.measured!.height!,
      }));
    const routes = selectRoutes(state, options);
    const members = new Map<string, string[]>();
    for (const node of state.nodes) {
      if (node.type !== "diagram") continue;
      const seen = new Set<string>();
      for (
        let parent = node.data.group;
        parent && !seen.has(parent);
        parent = state.nodeLookup.get(`group:${parent}`)?.data.group
      ) {
        seen.add(parent);
        let ids = members.get(node.id);
        if (!ids) members.set(node.id, (ids = []));
        ids.push(parent);
      }
    }
    const key = JSON.stringify([zoom, nodes, obstacles, [...members], [...routes].map(([id, r]) => [id, r.path])]);
    if (key === previous) return;
    previous = key;
    root.dataset.lowZoom = zoom < 0.3 ? "far" : "mid";
    if (import.meta.env.DEV || import.meta.env.VITE_E2E === "1") root.dataset.chipFits = String(++fits);
    const shown = (state as ChipState).ldChips;
    const chips: Map<string, ChipLayout> = share(layoutChips(nodes, zoom, measure, obstacles), shown?.nodes);
    const { paths, lanes, shared } = chipEdges(routes, zoom);
    const edges = new Map<string, EdgeChip>();
    for (const [id, route] of routes)
      edges.set(id, {
        path: paths.get(id) ?? route.path,
        natural: route.path,
        lane: lanes.get(id) ?? id,
        ...(shared.has(id) ? { shared: shared.get(id) } : {}),
      });
    setLowZoom(store, {
      Edge: chipEdge,
      Node: ChipNode,
      zones: members,
      tier: zoom < 0.3 ? "far" : "mid",
      zoom,
      nodes: chips,
      edges: share(edges, shown?.edges),
    });
  };
  const schedule = () => {
    if (!disposed && !frame) frame = requestAnimationFrame(update);
  };
  void document.fonts.ready.then(() => {
    ready = true;
    schedule();
  });
  const unstore = store.subscribe((s, old) => {
    if (s.transform[2] !== old.transform[2] || s.nodes !== old.nodes || s.edges !== old.edges) schedule();
  });
  const uncam = camera?.subscribe(schedule);
  const ungeometry = subscribeGeometry(schedule);
  const observer = new MutationObserver(schedule);
  observer.observe(root, {
    attributes: true,
    subtree: true,
    attributeFilter: ["data-viewport-moving", "data-live-slowmo"],
  });
  const viewport = root.querySelector(".react-flow__viewport");
  const uncap = viewport
    ? registerFrameCapture(viewport, () => {
        suspended = true;
        natural();
        flushSync(() => setLowZoom(store, null));
        return () => {
          suspended = false;
          previous = "";
          schedule();
        };
      })
    : () => {};
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    unstore();
    uncam?.();
    ungeometry();
    observer.disconnect();
    uncap();
    natural();
    setLowZoom(store, null);
  };
}
