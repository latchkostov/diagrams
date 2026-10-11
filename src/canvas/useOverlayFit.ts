import { useEffect, useState, type RefObject } from "react";
import { useReactFlow, useStoreApi, type ReactFlowState } from "@xyflow/react";
import type { EdgeStyle } from "../harness/edgeStyles";
import { fitAvoiding, type FitOptions } from "./geometry/fit";
import { intersects, type Rect } from "./geometry/rect";
import { selectRoutes } from "./edges/useEdgeRoute";
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
function contentRects(s: State, style: EdgeStyle, direction: "LR" | "TB"): Rect[] {
  const out: Rect[] = [];
  for (const n of s.nodeLookup.values()) {
    if (n.hidden) continue;
    const w = n.measured?.width ?? n.width ?? 0;
    const h = n.measured?.height ?? n.height ?? 0;
    if (w && h) out.push({ x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, width: w, height: h });
  }
  for (const r of selectRoutes(s, { style, direction }).values()) {
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
  const { style, direction } = opts;
  // Plain function: the React compiler memoises it (it reads root.current at call time).
  return (o: FitOptions & { duration?: number } = {}) => {
    const el = root.current;
    const s = store.getState() as State;
    if (!el || !s.width || !s.height) return;
    const v = fitAvoiding(contentRects(s, style, direction), { width: s.width, height: s.height }, overlayRects(el), o);
    if (v) void setViewport(v, { duration: o.duration ?? 0 });
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
        if (n.type !== "diagram" || n.hidden) continue;
        const nr = {
          x: n.internals.positionAbsolute.x,
          y: n.internals.positionAbsolute.y,
          width: n.measured?.width ?? 0,
          height: n.measured?.height ?? 0,
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
    const unsubscribe = store.subscribe(check);
    return () => {
      unsubscribe();
      ro?.disconnect();
    };
  }, [card, root, store, enabled]);
  return enabled && covered;
}

/**
 * React Flow's minimap and controls panels don't forward props, so tag them for tests (which
 * select by data-testid only): `canvas-minimap`, `canvas-controls`.
 */
export function useOverlayTestIds(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    el.querySelector(".react-flow__panel.react-flow__minimap")?.setAttribute("data-testid", "canvas-minimap");
    el.querySelector(".react-flow__panel.react-flow__controls")?.setAttribute("data-testid", "canvas-controls");
  });
}
