import { useEffect, useState, type RefObject } from "react";
import { useStoreApi, type ReactFlowState } from "@xyflow/react";
import { intersects, type Rect } from "./geometry/rect";
import type { DiagramFlowEdge, FlowNode } from "./types";

// The canvas's floating chrome: what a fit and a reveal keep content clear of (camera/geometry.ts), and the
// title card folding while nodes sit under it.

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
