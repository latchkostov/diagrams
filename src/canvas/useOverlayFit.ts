import { useEffect, useState, type RefObject } from "react";
import { useReactFlow, useStoreApi, type ReactFlowState } from "@xyflow/react";
import type { EdgeStyle } from "../harness/edgeStyles";
import { fitAvoiding, panClearOf, panIntoView, type FitOptions, type Viewport } from "./geometry/fit";
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

/**
 * Flow-space rects of everything that should stay visible: nodes, groups, routes and labels. With
 * `only`, just those nodes and the routes and labels of the `onlyEdges` (zoom to selection).
 */
function contentRects(
  s: State,
  opts: RouteOptions,
  only?: ReadonlySet<string>,
  onlyEdges: ReadonlySet<string> = new Set(),
): Rect[] {
  const out: Rect[] = [];
  for (const n of s.nodeLookup.values()) {
    if (n.hidden || (only && !only.has(n.id))) continue;
    const w = n.measured?.width ?? n.width ?? 0;
    const h = n.measured?.height ?? n.height ?? 0;
    if (w && h) out.push({ x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, width: w, height: h });
  }
  for (const [id, r] of selectRoutes(s, opts)) {
    if (only && !onlyEdges.has(id)) continue;
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
  return (o: FitOptions & { duration?: number; only?: ReadonlySet<string>; onlyEdges?: ReadonlySet<string> } = {}) => {
    const el = root.current;
    const s = store.getState() as State;
    if (!el || !el.clientWidth || !el.clientHeight) return;
    const v = fitAvoiding(
      contentRects(s, routing, o.only, o.onlyEdges),
      { width: el.clientWidth, height: el.clientHeight },
      overlayRects(el),
      o,
    );
    if (v) return setViewport(v, { duration: motionMs(o.duration ?? 0) });
  };
}

/** Screen room kept around a selection brought into view: clear of the title card, controls and minimap edges. */
const VIEW_MARGIN = { top: 72, right: 40, bottom: 56, left: 40 };

/**
 * The one reveal for keyboard focus and a new selection: the smallest pan (never a zoom) that shows flow-space
 * `want` in the pane, clear of the floating chrome (overlayRects: minimap, controls, live bar, title card).
 * When `want` is too big for the pane (a large boundary), `must` (its name) is what's shown instead, so the
 * part that says what it is never leaves. Null when that is in the pane and uncovered already: what's in
 * view never moves.
 */
export function revealPan(root: HTMLElement, viewport: Viewport, want: Rect, must: Rect = want): Viewport | null {
  const { width, height } = root.getBoundingClientRect();
  const overlays = overlayRects(root);
  const { x, y, zoom: k } = viewport;
  const view = {
    x: VIEW_MARGIN.left,
    y: VIEW_MARGIN.top,
    width: width - VIEW_MARGIN.left - VIEW_MARGIN.right,
    height: height - VIEW_MARGIN.top - VIEW_MARGIN.bottom,
  };
  const target = want.width * k <= view.width && want.height * k <= view.height ? want : must;
  const onScreen = (v: Viewport): Rect => ({
    x: target.x * k + v.x,
    y: target.y * k + v.y,
    width: target.width * k,
    height: target.height * k,
  });
  const now = onScreen(viewport);
  const inPane = now.x >= 0 && now.y >= 0 && now.x + now.width <= width && now.y + now.height <= height;
  if (inPane && !overlays.some((o) => intersects(now, o))) return null;
  // Cut off by the pane's edge: into the view first. Then off the chrome.
  const v = (inPane ? null : panIntoView(want, must, viewport, view)) ?? viewport;
  const d = panClearOf(onScreen(v), overlays, { width, height });
  const next = { x: v.x + d.dx, y: v.y + d.dy, zoom: k };
  return Math.abs(next.x - x) >= 1 || Math.abs(next.y - y) >= 1 ? next : null;
}

/**
 * Pans (never zooms) so the selection and its edges are visible in the pane as it is now, e.g.
 * after the inspector opened and narrowed the canvas. If they can't all fit, the selection itself
 * wins. Returns the viewport it pans to (where the view will be once the pan lands), or null when
 * nothing is selected or nothing had to move. Selection-driven opens use `selectionOnly`
 * so an attached connection cannot pull an already-visible item away from the pointer.
 */
export function useKeepSelectionInView(
  root: RefObject<HTMLElement | null>,
  opts: { style: EdgeStyle; direction: "LR" | "TB" },
) {
  const store = useStoreApi<FlowNode, DiagramFlowEdge>();
  const { setViewport } = useReactFlow<FlowNode, DiagramFlowEdge>();
  const routing = useRoutingOptions(opts);
  return (duration = 250, selectionOnly = false): Viewport | null => {
    const el = root.current;
    if (!el) return null;
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
      const attached = !selectionOnly && (selectedNodes.has(e.source) || selectedNodes.has(e.target));
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
    if (!core || !want) return null;
    const { width, height } = el.getBoundingClientRect();
    const [x, y, zoom] = s.transform;
    const view = {
      x: VIEW_MARGIN.left,
      y: VIEW_MARGIN.top,
      width: width - VIEW_MARGIN.left - VIEW_MARGIN.right,
      height: height - VIEW_MARGIN.top - VIEW_MARGIN.bottom,
    };
    const v = panIntoView(want, core, { x, y, zoom }, view);
    if (!v) return null;
    void setViewport(v, { duration: motionMs(duration), interpolate: "linear" });
    return v;
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
    let availableWidth = 0;
    let appearance = "";
    const measure = (invalidate = false) => {
      const width = base.clientWidth;
      const expandedAppearance = el.className.replace(/\bis-compact\b/g, "");
      // Folding/hover animates padding, but not the expanded footprint. Keep that footprint
      // until the content's metrics (including presentation style/fonts) or available width change.
      if (el.dataset.collapsed && full && width === availableWidth && appearance === expandedAppearance && !invalidate)
        return;
      // Text/reset rows can change while folded. Measure an unpainted expanded copy in
      // the same containing block, so the next fit never uses the old expanded footprint.
      let expanded = el;
      if (el.dataset.collapsed) {
        expanded = el.cloneNode(true) as HTMLElement;
        expanded.classList.remove("is-compact");
        expanded.removeAttribute("data-canvas-overlay");
        expanded.style.visibility = "hidden";
        expanded.style.transition = "none";
        expanded.inert = true;
        el.parentElement?.append(expanded);
      }
      full = { w: expanded.offsetWidth, h: expanded.offsetHeight };
      availableWidth = width;
      appearance = expandedAppearance;
      if (expanded !== el) expanded.remove();
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
            measure();
            check();
          });
    ro?.observe(el, { box: "border-box" });
    ro?.observe(base, { box: "border-box" });
    const contentChanged = () => {
      measure(true);
      check();
    };
    const content = new MutationObserver(contentChanged);
    content.observe(el, { subtree: true, childList: true, characterData: true });
    document.fonts.addEventListener("loadingdone", contentChanged);
    document.fonts.addEventListener("loadingerror", contentChanged);
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
      content.disconnect();
      document.fonts.removeEventListener("loadingdone", contentChanged);
      document.fonts.removeEventListener("loadingerror", contentChanged);
    };
  }, [card, root, store, enabled]);
  return enabled && covered;
}

/**
 * React Flow's minimap and controls panels don't forward props, so tag them for tests (which
 * select by data-testid only): `canvas-minimap`, `canvas-controls` (with `zoom-in-button` and
 * `zoom-out-button`), `canvas-attribution`.
 */
export function useOverlayTestIds(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const minimap = el.querySelector(".react-flow__panel.react-flow__minimap");
    minimap?.setAttribute("data-testid", "canvas-minimap");
    // A toast stacks above the minimap rather than over it (src/interop/ui/toastStack.ts).
    minimap?.setAttribute("data-toast-avoid", "");
    el.querySelector(".react-flow__panel.react-flow__controls")?.setAttribute("data-testid", "canvas-controls");
    el.querySelector(".react-flow__controls-zoomin")?.setAttribute("data-testid", "zoom-in-button");
    el.querySelector(".react-flow__controls-zoomout")?.setAttribute("data-testid", "zoom-out-button");
    el.querySelector(".react-flow__panel.react-flow__attribution")?.setAttribute("data-testid", "canvas-attribution");
  });
}
