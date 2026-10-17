import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import { useReactFlow, useStoreApi } from "@xyflow/react";
import type { EditorApi } from "../../editor/types";
import { motionMs } from "../../lib/motion";
import { connectedMenuPlacement, type ConnectedMenuAnchor } from "../geometry/connectedMenuPlacement";
import { type Viewport } from "../geometry/fit";
import { union, type Rect } from "../geometry/rect";
import { revealPan } from "../useOverlayFit";
import type { DiagramFlowEdge, FlowNode } from "../types";

/**
 * Brings the selection into view (a pan, never a zoom) once React Flow has measured it, clear of the
 * floating chrome (minimap, controls, hint), then runs `then`: a copy, a paste or a node added from a
 * dropped connection may land off screen, under the inspector its selection opens, or under the
 * minimap. `roomBelow` keeps space for what hangs under the card (its label editor): screen px up to 100%
 * zoom (the editor never reads smaller than its CSS size), growing with the zoom above it.
 */
export function useRevealSelection(wrapper: RefObject<HTMLDivElement | null>) {
  const { getNodes, setViewport } = useReactFlow<FlowNode, DiagramFlowEdge>();
  const store = useStoreApi<FlowNode, DiagramFlowEdge>();
  const keepInView = useRef<() => Viewport | null>(() => null);
  const revealSelection = useCallback(
    (then?: () => void, roomBelow = 0) => {
      /** The reveal from `from` (where keep-in-view's pan lands, else the view now), or null. */
      const clearOfChrome = (from: Viewport | null): Viewport | null => {
        const el = wrapper.current;
        if (!el) return null;
        const s = store.getState();
        const [tx, ty] = s.transform;
        const base = from ?? { x: tx, y: ty, zoom: s.transform[2] };
        const k = base.zoom;
        // What hangs below, in flow px.
        const below = (roomBelow * Math.max(1, k)) / k;
        const sel = union(
          [...s.nodeLookup.values()]
            .filter((n) => n.selected && !n.hidden && n.measured?.width)
            .map((n) => ({
              x: n.internals.positionAbsolute.x,
              y: n.internals.positionAbsolute.y,
              width: n.measured?.width ?? 0,
              height: (n.measured?.height ?? 0) + below,
            })),
        );
        if (!sel) return null;
        // The same reveal as keyboard focus (revealFocused).
        return revealPan(el, base, sel);
      };
      let frames = 30;
      const step = () => {
        const waiting = getNodes().some((n) => n.selected && !n.measured?.width);
        if (waiting && --frames > 0) return void requestAnimationFrame(step);
        // The editor opens at once (keys typed next belong to it); the view follows meanwhile, clearing
        // the chrome once keep-in-view's own pan has landed. Worked out from where that pan lands, not
        // from the view mid-way (a busy frame can still be animating it then).
        then?.();
        const kept = keepInView.current();
        const next = clearOfChrome(kept);
        if (!next) return;
        const go = () => void setViewport(next, { duration: motionMs(200), interpolate: "linear" });
        if (kept) setTimeout(go, motionMs(250) + 30);
        else go();
      };
      requestAnimationFrame(step);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the canvas's wrapper ref is stable
    [getNodes, setViewport, store],
  );
  return { keepInView, revealSelection };
}

/**
 * Quick-add opens beside the outline of where the node will land. First the view pans, if it must, to show
 * the node, the outline and the menu's room; returns where the view lands.
 */
export function panForConnectedMenu(
  setViewport: ReturnType<typeof useReactFlow>["setViewport"],
  connected: ConnectedMenuAnchor,
  view: Viewport,
  bounds: Rect,
): Viewport | null {
  const { viewport: next } = connectedMenuPlacement(connected, view, bounds);
  if (next) void setViewport(next, { duration: motionMs(200), interpolate: "linear" });
  return next;
}

/**
 * A check's row or chip: selects the nodes and connections it names and brings them into view with the one
 * reveal (revealPan), clear of the Checks card and the other floating chrome.
 */
export function useRevealIds(wrapper: RefObject<HTMLDivElement | null>, editor: EditorApi) {
  const { setViewport } = useReactFlow<FlowNode, DiagramFlowEdge>();
  const store = useStoreApi<FlowNode, DiagramFlowEdge>();
  return useCallback(
    (ids: readonly string[]) => {
      // From React Flow's lookups: one finding may name thousands of things, and the editor's getNode/getEdge
      // each rebuild the file.
      const st = store.getState();
      const nodeIds = ids.filter((id) => st.nodeLookup.get(id)?.type === "diagram");
      const edgeIds = ids.filter((id) => st.edgeLookup.has(id));
      editor.select({ nodeIds, edgeIds, groupIds: [] });
      requestAnimationFrame(() => {
        const el = wrapper.current;
        if (!el) return;
        const now = store.getState();
        const ends = edgeIds.flatMap((id) => {
          const e = now.edgeLookup.get(id);
          return e ? [e.source, e.target] : [];
        });
        const boxes = [...nodeIds, ...ends]
          .map((id) => now.nodeLookup.get(id))
          .filter((n) => !!n && !n.hidden && n.measured?.width)
          .map((n) => ({
            x: n!.internals.positionAbsolute.x,
            y: n!.internals.positionAbsolute.y,
            width: n!.measured!.width!,
            height: n!.measured!.height ?? 0,
          }));
        const want = union(boxes);
        if (!want) return;
        const [x, y, zoom] = now.transform;
        const next = revealPan(el, { x, y, zoom }, want);
        if (next) void setViewport(next, { duration: motionMs(250) });
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the canvas's wrapper ref is stable
    [editor, store, setViewport],
  );
}

/**
 * Keyboard focus that lands on a node out of view or under the chrome (Tab into the canvas, a screen reader's
 * focus) brings it into view with a pan: the same reveal as a new selection (revealPan). The canvas can't
 * scroll (overflow: clip in canvas.css), and React Flow's own pan on focus only moves for a node wholly
 * outside the pane. A boundary too big for the pane keeps its name in view.
 */
export function useRevealFocused(wrapper: RefObject<HTMLDivElement | null>) {
  const { setViewport } = useReactFlow<FlowNode, DiagramFlowEdge>();
  const store = useStoreApi<FlowNode, DiagramFlowEdge>();
  const revealFocused = useRef((_id: string, _target: HTMLElement) => {});
  useLayoutEffect(() => {
    revealFocused.current = (id, target) => {
      const el = wrapper.current;
      const s = store.getState();
      const n = s.nodeLookup.get(id);
      if (!el || !n) return;
      const width = n.measured?.width ?? n.width ?? 0;
      const height = n.measured?.height ?? n.height ?? 0;
      if (!width || !height) return;
      const card = { x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, width, height };
      const [tx, ty, k] = s.transform;
      const pane = el.getBoundingClientRect();
      // A boundary's name, else the card's top-left corner: what has to show when the whole can't.
      const label = target.querySelector('[data-testid^="group-label-"]')?.getBoundingClientRect();
      const must = label
        ? {
            x: (label.left - pane.left - tx) / k,
            y: (label.top - pane.top - ty) / k,
            width: label.width / k,
            height: label.height / k,
          }
        : { ...card, width: Math.min(width, 240), height: Math.min(height, 48) };
      const next = revealPan(el, { x: tx, y: ty, zoom: k }, card, must);
      if (next) void setViewport(next, { duration: motionMs(200), interpolate: "linear" });
    };
  });
  return revealFocused;
}
