import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import type { NodeChange, ReactFlowState } from "@xyflow/react";
import { guideIndex, snapMove, type Box, type GuideIndex, type SnapResult } from "./guides";
import type { AnnotationFlowNode, DiagramFlowEdge, FlowNode, GroupFlowNode } from "./types";

// Smart guides and snapping while dragging (D6). A drag session starts with React Flow's drag: it indexes
// the other nodes' edges and centres once, then rewrites each batch of position changes so the dragged box
// lands on a guide, an equal gap or the grid (Ctrl/Cmd held: wherever the pointer puts it). Guides engage
// only while the pointer moves slowly, so a fast drag across the canvas isn't sticky; once it stops, they
// catch up. They draw on one overlay over the flow, only during a drag (never in exports, presentation or
// live view: the layer isn't there).

type XY = { x: number; y: number };
type Store = { getState: () => ReactFlowState<FlowNode, DiagramFlowEdge> };

/** 6 screen px, as in Figma and tldraw. */
const SNAP_PX = 6;
/** Guides come from nodes at most this far away (screen px, across the axis). */
const REACH_PX = 600;
const GRID = 10;
/** Faster than this (screen px per ms, about 1000 px/s), only the grid snaps. */
const FAST = 1;
/** After a fast move, the guides catch up once the pointer has rested this long. */
const SETTLE_MS = 90;

interface Session {
  /** Where each moving node started (a copy, for an Alt-drag, from its original's place). */
  start: Map<string, XY>;
  /** Boundary members that move with a dragged boundary (they aren't React Flow's drag items). */
  followers: Map<string, XY>;
  box: Box;
  index: GuideIndex;
  snap: boolean;
  free: boolean;
  fast: boolean;
  raw: XY;
  delta: XY | null;
  samples: { t: number; x: number; y: number }[];
  timer: number | undefined;
  stop: () => void;
}

const isBackdrop = (n: FlowNode) =>
  n.type === "boundary" || (n.type === "annotation" && (n as AnnotationFlowNode).data.kind === "zone");

/** The changes that put every moving node (and boundary member) at its start plus `delta`. */
function changesFor(g: Session, delta: XY, dragging: boolean): NodeChange<FlowNode>[] {
  const out: NodeChange<FlowNode>[] = [];
  for (const map of [g.start, g.followers])
    for (const [id, p] of map)
      out.push({ id, type: "position", position: { x: p.x + delta.x, y: p.y + delta.y }, dragging });
  return out;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * A drag snaps here (guides first, then the grid; Ctrl/Cmd: neither), so React Flow's own grid snapping
 * stands aside while one runs; it still snaps resizes and drop points. Its drag reads the flag from the
 * store's state on every move, and nothing subscribes to it, so it's switched in place: a `setState`
 * would wake every node's and edge's store subscription twice a drag (8 ms at 4× on 150 nodes).
 */
function setGridSnap(store: Store, on: boolean) {
  const state = store.getState();
  if (state.snapToGrid !== on) state.snapToGrid = on;
}

/** Shows the overlay, or clears and hides it. */
function showOverlay(layer: SVGSVGElement | null, on: boolean) {
  if (!layer) return;
  if (!on) draw(layer, null, [0, 0, 1]);
  layer.toggleAttribute("data-on", on);
}

/**
 * Draws the guides on the overlay, in screen pixels (the flow's pan and zoom applied): one thin path per
 * line or gap, so a change repaints only those paths' bounds, never the whole pane (a full-pane canvas
 * cost 8 ms a move on a 150-node diagram at 4× CPU throttling).
 */
function draw(layer: SVGSVGElement | null, r: SnapResult | null, transform: [number, number, number]) {
  if (!layer) return;
  const lines = r?.lines ?? [];
  const gaps = r?.gaps ?? [];
  // Nothing drawn and nothing to draw: no work (most moves of a drag away from other nodes).
  if (!lines.length && !gaps.length && layer.dataset.lines === "0" && layer.dataset.gaps === "0") return;
  const counts = { lines: String(lines.length), gaps: String(gaps.length) };
  const axes = [...new Set([...lines, ...gaps].map((g) => g.axis))].sort().join(",");
  if (layer.dataset.lines !== counts.lines) layer.dataset.lines = counts.lines;
  if (layer.dataset.gaps !== counts.gaps) layer.dataset.gaps = counts.gaps;
  if (layer.dataset.axes !== axes) layer.dataset.axes = axes;
  const [tx, ty, k] = transform;
  const sx = (v: number) => Math.round(v * k + tx) + 0.5;
  const sy = (v: number) => Math.round(v * k + ty) + 0.5;
  const OVER = 6;
  const T = 4;
  const ds: string[] = [];
  for (const l of lines)
    ds.push(
      l.axis === "x"
        ? `M${sx(l.at)} ${sy(l.from) - OVER}V${sy(l.to) + OVER}`
        : `M${sx(l.from) - OVER} ${sy(l.at)}H${sx(l.to) + OVER}`,
    );
  // Each equal gap: a line between the two boxes with end ticks, and a small "=" at its middle.
  for (const g of gaps) {
    if (g.axis === "x") {
      const [y, a, b] = [sy(g.at), sx(g.from), sx(g.to)];
      const m = Math.round((a + b) / 2);
      ds.push(`M${a} ${y}H${b}M${a} ${y - T}V${y + T}M${b} ${y - T}V${y + T}M${m - 3} ${y - 6}h6M${m - 3} ${y - 9}h6`);
    } else {
      const [x, a, b] = [sx(g.at), sy(g.from), sy(g.to)];
      const m = Math.round((a + b) / 2);
      ds.push(`M${x} ${a}V${b}M${x - T} ${a}H${x + T}M${x - T} ${b}H${x + T}M${x + 6} ${m - 1}h6M${x + 6} ${m + 2}h6`);
    }
  }
  while (layer.childElementCount < ds.length) layer.appendChild(document.createElementNS(SVG_NS, "path"));
  Array.from(layer.children).forEach((p, i) => {
    const d = ds[i] ?? "";
    if ((p.getAttribute("d") ?? "") !== d) p.setAttribute("d", d);
  });
}

/**
 * The drag session. `start` when React Flow starts a drag, `filter` every batch of node changes (after
 * Alt-drag's remap to the copies), `stop` when it ends. `apply` writes changes made outside React Flow's
 * own drag (the guides catching up after a fast move, or Ctrl pressed mid-drag).
 */
export function useSmartGuides({
  store,
  snap,
  guides,
  layer,
  apply,
}: {
  store: Store;
  /** Snapping (Show ▸ Snapping): guides and the grid. Off, a drag goes where the pointer puts it. */
  snap: boolean;
  /** Guides at all: only while editing (a drag in live view or presentation snaps to the grid alone). */
  guides: boolean;
  layer: RefObject<SVGSVGElement | null>;
  apply: (changes: NodeChange<FlowNode>[]) => void;
}) {
  const session = useRef<Session | null>(null);
  const applyRef = useRef(apply);
  useEffect(() => {
    applyRef.current = apply;
  }, [apply]);

  const compute = useCallback(
    (g: Session): SnapResult => {
      const k = store.getState().transform[2];
      const moving = { ...g.box, x: g.box.x + g.raw.x, y: g.box.y + g.raw.y };
      const on = g.snap && !g.free;
      return snapMove(g.index, moving, {
        threshold: SNAP_PX / k,
        reach: REACH_PX / k,
        guides: on && !g.fast,
        grid: on ? GRID : 0,
      });
    },
    [store],
  );

  /** Recomputes from the last pointer position and writes the result (no React Flow event behind it). */
  const refresh = useCallback(() => {
    const g = session.current;
    if (!g) return;
    const r = compute(g);
    const delta = { x: g.raw.x + r.dx, y: g.raw.y + r.dy };
    draw(layer.current, r, store.getState().transform);
    if (g.delta && g.delta.x === delta.x && g.delta.y === delta.y) return;
    g.delta = delta;
    applyRef.current(changesFor(g, delta, true));
  }, [compute, layer, store]);

  const stop = useCallback(() => {
    const g = session.current;
    session.current = null;
    if (!g) return;
    g.stop();
    setGridSnap(store, snap);
    showOverlay(layer.current, false);
  }, [layer, store, snap]);

  const start = useCallback(
    (e: { ctrlKey?: boolean; metaKey?: boolean }, dragged: FlowNode[], copies: Map<string, string> | null) => {
      stop();
      const s = store.getState();
      const [tx, ty, k] = s.transform;
      const startPos = new Map<string, XY>();
      const originals = new Set(dragged.map((n) => n.id));
      let x1 = Infinity;
      let y1 = Infinity;
      let x2 = -Infinity;
      let y2 = -Infinity;
      for (const n of dragged) {
        startPos.set(copies?.get(n.id) ?? n.id, { ...n.position });
        const w = n.measured?.width ?? n.width ?? 0;
        const h = n.measured?.height ?? n.height ?? 0;
        x1 = Math.min(x1, n.position.x);
        y1 = Math.min(y1, n.position.y);
        x2 = Math.max(x2, n.position.x + w);
        y2 = Math.max(y2, n.position.y + h);
      }
      if (!startPos.size) return;
      // Boundaries aren't React Flow parents: their members move along by the same amount.
      const groups = new Set(
        dragged.filter((n): n is GroupFlowNode => n.type === "boundary").map((n) => n.data.groupId),
      );
      const followers = new Map<string, XY>();
      if (groups.size)
        for (const n of s.nodes)
          if (n.type === "diagram" && n.data.group && groups.has(n.data.group) && !originals.has(n.id))
            followers.set(copies?.get(n.id) ?? n.id, { ...n.position });
      // Candidates: what's in view, not moving, and not a backdrop (boundaries and zones). An Alt-drag's
      // originals stay put, so its copies line up with them.
      const view = { x: -tx / k, y: -ty / k, width: s.width / k, height: s.height / k };
      const boxes: Box[] = [];
      if (snap && guides)
        for (const n of s.nodeLookup.values()) {
          const u = n.internals.userNode;
          if (n.hidden || isBackdrop(u) || startPos.has(n.id) || followers.has(n.id)) continue;
          if (!copies && originals.has(n.id)) continue;
          if (u.type === "diagram" && u.data.group && groups.has(u.data.group)) continue;
          const w = n.measured?.width ?? n.width ?? 0;
          const h = n.measured?.height ?? n.height ?? 0;
          const p = n.internals.positionAbsolute;
          if (!w || !h) continue;
          if (p.x > view.x + view.width || p.x + w < view.x || p.y > view.y + view.height || p.y + h < view.y) continue;
          boxes.push({ x: p.x, y: p.y, width: w, height: h });
        }
      const free = !!(e.ctrlKey || e.metaKey);
      const onKey = (ev: KeyboardEvent) => {
        const g = session.current;
        if (!g || (ev.key !== "Control" && ev.key !== "Meta")) return;
        const now = ev.ctrlKey || ev.metaKey;
        if (now === g.free) return;
        g.free = now;
        refresh();
      };
      const onMove = (ev: PointerEvent) => {
        const g = session.current;
        if (g) g.free = ev.ctrlKey || ev.metaKey;
      };
      window.addEventListener("keydown", onKey, true);
      window.addEventListener("keyup", onKey, true);
      window.addEventListener("pointermove", onMove, true);
      const g: Session = {
        start: startPos,
        followers,
        box: { x: x1, y: y1, width: x2 - x1, height: y2 - y1 },
        index: guideIndex(boxes),
        snap,
        free,
        fast: false,
        raw: { x: 0, y: 0 },
        delta: null,
        samples: [],
        timer: undefined,
        stop: () => {
          window.clearTimeout(g.timer);
          window.removeEventListener("keydown", onKey, true);
          window.removeEventListener("keyup", onKey, true);
          window.removeEventListener("pointermove", onMove, true);
        },
      };
      session.current = g;
      setGridSnap(store, false);
      showOverlay(layer.current, true);
    },
    [store, snap, guides, layer, stop, refresh],
  );

  /** Rewrites a batch of node changes during a drag: the moving nodes land snapped, members follow. */
  const filter = useCallback(
    (changes: NodeChange<FlowNode>[]): NodeChange<FlowNode>[] => {
      const g = session.current;
      if (!g) return changes;
      let raw: XY | null = null;
      let dragging = true;
      for (const c of changes) {
        if (c.type !== "position" || !c.position) continue;
        const p = g.start.get(c.id);
        if (!p) continue;
        raw = { x: c.position.x - p.x, y: c.position.y - p.y };
        dragging = c.dragging !== false;
        break;
      }
      if (!raw) return changes;
      let delta: XY;
      if (!dragging && g.delta) {
        // The drop: where the user saw it last (the guides may have caught up since the last move).
        delta = g.delta;
      } else {
        g.raw = raw;
        const t = performance.now();
        const k = store.getState().transform[2];
        g.samples.push({ t, x: raw.x * k, y: raw.y * k });
        while (g.samples.length > 2 && t - g.samples[0].t > 100) g.samples.shift();
        const first = g.samples[0];
        const span = t - first.t;
        g.fast = span > 0 && Math.hypot(raw.x * k - first.x, raw.y * k - first.y) / span > FAST;
        const r = compute(g);
        delta = { x: raw.x + r.dx, y: raw.y + r.dy };
        const same = !!g.delta && g.delta.x === delta.x && g.delta.y === delta.y;
        g.delta = delta;
        window.clearTimeout(g.timer);
        if (g.fast && dragging)
          g.timer = window.setTimeout(() => {
            if (session.current !== g) return;
            g.fast = false;
            g.samples = [];
            refresh();
          }, SETTLE_MS);
        // The guides follow every move, even one that lands where the node already is (the pointer slowing
        // down in the same grid cell can bring a line in).
        if (dragging) draw(layer.current, r, store.getState().transform);
        // Snapped to where it already is: no change, so nothing re-renders or re-routes (as React Flow's
        // own grid snapping skipped such moves).
        if (dragging && same)
          return changes.filter((c) => !(c.type === "position" && (g.start.has(c.id) || g.followers.has(c.id))));
      }
      const out: NodeChange<FlowNode>[] = [];
      for (const c of changes)
        if (!(c.type === "position" && (g.start.has(c.id) || g.followers.has(c.id)))) out.push(c);
      out.push(...changesFor(g, delta, dragging));
      if (!dragging) stop();
      return out;
    },
    [compute, layer, store, refresh, stop],
  );

  useEffect(() => stop, [stop]);
  return useMemo(() => ({ start, filter, stop }), [start, filter, stop]);
}
