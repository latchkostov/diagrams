import { useEffect, useState, type RefObject } from "react";
import { useReactFlow, useStoreApi, type ReactFlowState } from "@xyflow/react";
import type { EdgeStyle } from "../harness/edgeStyles";
import { fitAvoiding, panIntoView, type FitOptions } from "./geometry/fit";
import { intersects, union, type Rect } from "./geometry/rect";
import { motionMs } from "../lib/motion";
import { selectRoutes, useRoutingOptions, type RouteOptions } from "./edges/useEdgeRoute";
import type { DiagramFlowEdge, FlowNode } from "./types";

/**
 * Floating chrome that diagram content must not sit under after a fit. Other lanes can opt a
 * panel in with the `data-canvas-overlay` attribute. An element may report its full (expanded)
 * size in `data-overlay-width` / `data-overlay-height` while it's shown collapsed.
 */
export const OVERLAY_SELECTOR = [
  "[data-canvas-overlay]",
  ".react-flow__panel.react-flow__controls",
  ".react-flow__panel.react-flow__minimap",
  '[data-testid="live-toggle"]',
  '[data-testid="live-controls"]',
  '[data-testid="present-exit"]',
].join(",");

type State = ReactFlowState<FlowNode, DiagramFlowEdge>;

/** Screen rects (relative to `root`) of the visible overlays inside it. */
export function overlayRects(root: HTMLElement): Rect[] {
  const base = root.getBoundingClientRect();
  const out: Rect[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(OVERLAY_SELECTOR)) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(el).visibility === "hidden") continue;
    const w = Number(el.dataset.overlayWidth) || r.width;
    const h = Number(el.dataset.overlayHeight) || r.height;
    out.push({ x: r.left - base.left, y: r.top - base.top, width: w, height: h });
  }
  return out;
}

/** Flow-space rects of everything that should stay visible: nodes, groups, routes and labels. */
function contentRects(s: State, opts: RouteOptions): Rect[] {
  const out: Rect[] = [];
  for (const n of s.nodeLookup.values()) {
    if (n.hidden) continue;
    const w = n.measured?.width ?? n.width ?? 0;
    const h = n.measured?.height ?? n.height ?? 0;
    if (w && h) out.push({ x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, width: w, height: h });
  }
  for (const r of selectRoutes(s, opts).values()) {
    for (const p of r.points) out.push({ x: p.x - 2, y: p.y - 2, width: 4, height: 4 });
    if (r.label)
      out.push({
        x: r.label.x - r.label.width / 2,
        y: r.label.y - r.label.height / 2,
        width: r.label.width,
        height: r.label.height,
      });
  }
  return out;
}

/** fitView that keeps content out from under floating chrome (see geometry/fit.ts). */
export function useOverlayFit(root: RefObject<HTMLElement | null>, opts: { style: EdgeStyle; direction: "LR" | "TB" }) {
  const store = useStoreApi<FlowNode, DiagramFlowEdge>();
  const { setViewport } = useReactFlow<FlowNode, DiagramFlowEdge>();
  const routing = useRoutingOptions(opts);
  // Plain function: the React compiler memoises it (it reads root.current at call time).
  return (o: FitOptions & { duration?: number } = {}) => {
    const el = root.current;
    const s = store.getState() as State;
    if (!el || !s.width || !s.height) return;
    const v = fitAvoiding(contentRects(s, routing), { width: s.width, height: s.height }, overlayRects(el), o);
    if (v) void setViewport(v, { duration: motionMs(o.duration ?? 0) });
  };
}

/** Screen room kept around a selection brought into view: clear of the title card, controls and minimap edges. */
const VIEW_MARGIN = { top: 72, right: 40, bottom: 56, left: 40 };

/**
 * Pans (never zooms) so the selection and its edges are visible in the pane as it is now, e.g.
 * after the inspector opened and narrowed the canvas. If they can't all fit, the selection itself
 * wins. Returns false when nothing is selected or nothing had to move.
 */
export function useKeepSelectionInView(
  root: RefObject<HTMLElement | null>,
  opts: { style: EdgeStyle; direction: "LR" | "TB" },
) {
  const store = useStoreApi<FlowNode, DiagramFlowEdge>();
  const { setViewport } = useReactFlow<FlowNode, DiagramFlowEdge>();
  const routing = useRoutingOptions(opts);
  return (duration = 250): boolean => {
    const el = root.current;
    if (!el) return false;
    const s = store.getState() as State;
    const must: Rect[] = [];
    const around: Rect[] = [];
    const selectedNodes = new Set<string>();
    for (const n of s.nodeLookup.values()) {
      if (!n.selected || n.hidden) continue;
      // A just-added annotation isn't measured yet, but it has its size (a node waits for the measure).
      const w = n.measured?.width ?? n.width ?? 0;
      const h = n.measured?.height ?? n.height ?? 0;
      if (!w || !h) continue;
      selectedNodes.add(n.id);
      must.push({ x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, width: w, height: h });
    }
    const routes = selectRoutes(s, routing);
    for (const e of s.edges) {
      const attached = selectedNodes.has(e.source) || selectedNodes.has(e.target);
      if (!e.selected && !attached) continue;
      const r = routes.get(e.id);
      if (!r) continue;
      const out = e.selected ? must : around;
      for (const p of r.points) out.push({ x: p.x - 2, y: p.y - 2, width: 4, height: 4 });
      if (r.label)
        out.push({
          x: r.label.x - r.label.width / 2,
          y: r.label.y - r.label.height / 2,
          width: r.label.width,
          height: r.label.height,
        });
    }
    const core = union(must);
    const want = union([...must, ...around]);
    if (!core || !want) return false;
    const { width, height } = el.getBoundingClientRect();
    const [x, y, zoom] = s.transform;
    const view = {
      x: VIEW_MARGIN.left,
      y: VIEW_MARGIN.top,
      width: width - VIEW_MARGIN.left - VIEW_MARGIN.right,
      height: height - VIEW_MARGIN.top - VIEW_MARGIN.bottom,
    };
    const v = panIntoView(want, core, { x, y, zoom }, view);
    if (!v) return false;
    void setViewport(v, { duration: motionMs(duration) });
    return true;
  };
}

/**
 * True while any node sits under `card`'s expanded footprint at the current viewport. The
 * footprint is the card's expanded size even while it's folded, so folding can't flip the answer
 * back (no flicker). Computed in a store subscription, not a selector: it reads the DOM.
 */
export function useCovered(
  card: RefObject<HTMLElement | null>,
  root: RefObject<HTMLElement | null>,
  enabled = true,
): boolean {
  const store = useStoreApi<FlowNode, DiagramFlowEdge>();
  const [covered, setCovered] = useState(false);
  useEffect(() => {
    const el = card.current;
    const base = root.current;
    if (!enabled || !el || !base) return;
    let full: { w: number; h: number } | null = null;
    const measure = () => {
      if (el.dataset.collapsed) return;
      full = { w: el.offsetWidth, h: el.offsetHeight };
      // Fit-view avoids the expanded card even while it's folded (see overlayRects).
      el.dataset.overlayWidth = String(full.w);
      el.dataset.overlayHeight = String(full.h);
    };
    const check = () => {
      if (!full) measure();
      if (!full) return;
      const s = store.getState() as State;
      const b = base.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const [tx, ty, z] = s.transform;
      const box: Rect = {
        x: (r.left - b.left - tx) / z,
        y: (r.top - b.top - ty) / z,
        width: full.w / z,
        height: full.h / z,
      };
      let hit = false;
      for (const n of s.nodeLookup.values()) {
        // Cards, and the annotations that are content (not zones, which are backdrops).
        if (
          n.type === "boundary" ||
          n.hidden ||
          (n.type === "annotation" && (n.data as { kind?: string }).kind === "zone")
        )
          continue;
        const nr = {
          x: n.internals.positionAbsolute.x,
          y: n.internals.positionAbsolute.y,
          width: n.measured?.width ?? n.width ?? 0,
          height: n.measured?.height ?? n.height ?? 0,
        };
        if (intersects(box, nr)) {
          hit = true;
          break;
        }
      }
      setCovered(hit);
    };
    const ro =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            if (el.dataset.collapsed) return;
            measure();
            check();
          });
    ro?.observe(el);
    check();
    // The store changes many times a frame while dragging, zooming or measuring; checking on each
    // forced a layout (two rect reads) every time. Once per frame, at the frame's own layout, is enough.
    let frame = 0;
    const unsubscribe = store.subscribe(() => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          check();
        });
    });
    return () => {
      unsubscribe();
      cancelAnimationFrame(frame);
      ro?.disconnect();
    };
  }, [card, root, store, enabled]);
  return enabled && covered;
}

/**
 * React Flow's minimap and controls panels don't forward props, so tag them for tests (which
 * select by data-testid only): `canvas-minimap`, `canvas-controls`, `canvas-attribution`.
 */
export function useOverlayTestIds(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    el.querySelector(".react-flow__panel.react-flow__minimap")?.setAttribute("data-testid", "canvas-minimap");
    el.querySelector(".react-flow__panel.react-flow__controls")?.setAttribute("data-testid", "canvas-controls");
    el.querySelector(".react-flow__panel.react-flow__attribution")?.setAttribute("data-testid", "canvas-attribution");
  });
}
