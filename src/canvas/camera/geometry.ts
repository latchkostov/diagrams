import { getViewportForBounds, type ReactFlowState } from "@xyflow/react";
import { LIVE_BAR_SPACE } from "../../live/layout";
import { TRACE_CARD_FOOTPRINT, TRACE_CARD_TOP } from "../../live/traceCardLayout";
import { selectRoutes, type RouteOptions } from "../edges/useEdgeRoute";
import { fitAvoiding, panClearOf, panIntoView, type FitOptions, type Viewport } from "../geometry/fit";
import { intersects, union, type Rect } from "../geometry/rect";
import { overlayRects } from "../useOverlayFit";
import type { DiagramFlowEdge, FlowNode } from "../types";

// The camera's geometry, as pure reads of React Flow's state and the pane: where a fit, a reveal or a
// centring would put the view. Nothing here moves it (controller.ts does, through its port).

type State = ReactFlowState<FlowNode, DiagramFlowEdge>;

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
    pushRoute(out, r);
  }
  return out;
}

function pushRoute(
  out: Rect[],
  r: {
    points: readonly { x: number; y: number }[];
    label?: { x: number; y: number; width: number; height: number } | null;
  },
) {
  for (const p of r.points) out.push({ x: p.x - 2, y: p.y - 2, width: 4, height: 4 });
  if (r.label)
    out.push({
      x: r.label.x - r.label.width / 2,
      y: r.label.y - r.label.height / 2,
      width: r.label.width,
      height: r.label.height,
    });
}

/** The fit that keeps content out from under floating chrome (see geometry/fit.ts), or null with no pane. */
export function overlayFitViewport(
  root: HTMLElement,
  s: State,
  routing: RouteOptions,
  o: FitOptions & { only?: ReadonlySet<string>; onlyEdges?: ReadonlySet<string> },
): Viewport | null {
  if (!root.clientWidth || !root.clientHeight) return null;
  return fitAvoiding(
    contentRects(s, routing, o.only, o.onlyEdges),
    { width: root.clientWidth, height: root.clientHeight },
    overlayRects(root),
    o,
  );
}

/** Screen room kept around a selection brought into view: clear of the title card, controls and minimap edges. */
const VIEW_MARGIN = { top: 72, right: 40, bottom: 56, left: 40 };

/**
 * The one reveal, for keyboard focus, a new selection, a placement, a check's finding and a pane change: the
 * smallest pan (never a zoom) that shows flow-space `want` in the pane, clear of the floating chrome
 * (overlayRects: minimap, controls, live bar, title card). When `want` is too big for the pane (a large
 * boundary), `must` (its name, or the selection without its connections) is what's shown instead, so the part
 * that says what it is never leaves. Null when that is in the pane and uncovered already: what's in view never
 * moves.
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
 * The selection's flow-space boxes: `core` (selected nodes and connections; `roomBelow` screen px under each
 * node at `zoom`, for a label editor) and `want` (with `withEdges`, also the connections attached to selected
 * nodes). Null when nothing visible is selected.
 */
export function selectionBoxes(
  s: State,
  routing: RouteOptions,
  o: { withEdges: boolean; roomBelow: number; zoom: number },
): { core: Rect; want: Rect } | null {
  const k = o.zoom;
  // What hangs below, in flow px: screen px up to 100% zoom, growing with the zoom above it.
  const below = (o.roomBelow * Math.max(1, k)) / k;
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
    must.push({ x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, width: w, height: h + below });
  }
  const hasEdges = s.edges.some(
    (e) => e.selected || (o.withEdges && (selectedNodes.has(e.source) || selectedNodes.has(e.target))),
  );
  if (hasEdges) {
    const routes = selectRoutes(s, routing);
    for (const e of s.edges) {
      const attached = o.withEdges && (selectedNodes.has(e.source) || selectedNodes.has(e.target));
      if (!e.selected && !attached) continue;
      const r = routes.get(e.id);
      if (r) pushRoute(e.selected ? must : around, r);
    }
  }
  const core = union(must);
  const want = union([...must, ...around]);
  return core && want ? { core, want } : null;
}

/** The flow-space boxes of these nodes (a check's finding), measured and visible. */
export function nodeBoxes(s: State, ids: readonly string[]): Rect | null {
  return union(
    ids
      .map((id) => s.nodeLookup.get(id))
      .filter((n) => !!n && !n.hidden && n.measured?.width)
      .map((n) => ({
        x: n!.internals.positionAbsolute.x,
        y: n!.internals.positionAbsolute.y,
        width: n!.measured!.width!,
        height: n!.measured!.height ?? 0,
      })),
  );
}

/**
 * A focused node: its card, and what has to show when the whole can't (a boundary's name, else the card's
 * top-left corner).
 */
export function focusBoxes(
  root: HTMLElement,
  s: State,
  id: string,
  target: HTMLElement,
  viewport: Viewport,
): { card: Rect; must: Rect } | null {
  const n = s.nodeLookup.get(id);
  if (!n) return null;
  const width = n.measured?.width ?? n.width ?? 0;
  const height = n.measured?.height ?? n.height ?? 0;
  if (!width || !height) return null;
  const card = { x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, width, height };
  const { x: tx, y: ty, zoom: k } = viewport;
  const pane = root.getBoundingClientRect();
  const label = target.querySelector('[data-testid^="group-label-"]')?.getBoundingClientRect();
  const must = label
    ? {
        x: (label.left - pane.left - tx) / k,
        y: (label.top - pane.top - ty) / k,
        width: label.width / k,
        height: label.height / k,
      }
    : { ...card, width: Math.min(width, 240), height: Math.min(height, 48) };
  return { card, must };
}

/** The diagram's centre brought back into the pane (keeping the zoom), when it's within 40 px of its edge. */
export function centerViewport(root: HTMLElement, s: State, viewport: Viewport): Viewport | null {
  const bounds = union(
    [...s.nodeLookup.values()]
      .filter((n) => !n.hidden)
      .map((n) => ({
        x: n.internals.positionAbsolute.x,
        y: n.internals.positionAbsolute.y,
        width: n.measured?.width ?? n.width ?? 0,
        height: n.measured?.height ?? n.height ?? 0,
      })),
  );
  const pane = root.getBoundingClientRect();
  if (!bounds) return null;
  const { x, y, zoom } = viewport;
  const fx = bounds.x + bounds.width / 2;
  const fy = bounds.y + bounds.height / 2;
  const cx = fx * zoom + x;
  const cy = fy * zoom + y;
  if (cx >= 40 && cx <= pane.width - 40 && cy >= 40 && cy <= pane.height - 40) return null;
  return { x: pane.width / 2 - fx * zoom, y: pane.height / 2 - fy * zoom, zoom };
}

/** `zoom` about the pane's centre (Shift+0), as React Flow's zoomTo would. */
export function zoomAboutCentre(root: HTMLElement, viewport: Viewport, zoom: number): Viewport {
  const cx = root.clientWidth / 2;
  const cy = root.clientHeight / 2;
  const f = zoom / viewport.zoom;
  return { x: cx - (cx - viewport.x) * f, y: cy - (cy - viewport.y) * f, zoom };
}

/** A node centred at a readable zoom (at least 90%), as the command palette's go-to. */
export function goToViewport(root: HTMLElement, s: State, viewport: Viewport, id: string): Viewport | null {
  const n = s.nodeLookup.get(id);
  if (!n) return null;
  const width = n.measured?.width ?? n.width ?? 180;
  const height = n.measured?.height ?? n.height ?? 64;
  const zoom = Math.max(viewport.zoom, 0.9);
  const fx = n.position.x + width / 2;
  const fy = n.position.y + height / 2;
  return { x: root.clientWidth / 2 - fx * zoom, y: root.clientHeight / 2 - fy * zoom, zoom };
}

// ---------------------------------------------------------------- Live view

type Insets = { top: number; right: number; bottom: number; left: number };

/** Live's whole-diagram fit: clear of the title (top) and the live bar (bottom). */
export const LIVE_FIT = { insets: { top: 110, right: 48, bottom: 48 + LIVE_BAR_SPACE, left: 48 }, maxZoom: 1.25 };
/** A note's close-up: room for the note callout below its focus. */
export const NOTE_FIT = { insets: { top: 170, right: 80, bottom: 230, left: 80 }, maxZoom: 1 };
/** The right edge Live keeps clear: the side panel's column, else the trace card's. */
const PANEL_RIGHT = 440;
const CARD_RIGHT = 400;

/**
 * React Flow's fitView({ nodes, padding, maxZoom }): the measured, visible nodes (`only`: these) centred in the
 * pane inside px paddings, through React Flow's own getViewportForBounds. Null when none is measured.
 */
export function fitNodesViewport(s: State, only: ReadonlySet<string> | null, insets: Insets, maxZoom: number) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const n of s.nodeLookup.values()) {
    const w = n.measured.width;
    const h = n.measured.height;
    if (!w || !h || n.hidden || (only && !only.has(n.id))) continue;
    const { x, y } = n.internals.positionAbsolute;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + w);
    y1 = Math.max(y1, y + h);
  }
  if (!Number.isFinite(x0) || !s.width || !s.height) return null;
  const px = (v: number) => `${v}px` as const;
  const padding = { top: px(insets.top), right: px(insets.right), bottom: px(insets.bottom), left: px(insets.left) };
  const bounds = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  return getViewportForBounds(bounds, s.width, s.height, s.minZoom, maxZoom, padding);
}

/**
 * A fit of every node that leaves the trace card's footprint (its first rows, top right) clear: beside it, below
 * it, or untouched when nothing sits there anyway (see geometry/fit.ts). Null when there's nothing to fit.
 */
function fitBesideCard(s: State): Viewport | null {
  const items: Rect[] = [];
  for (const n of s.nodeLookup.values()) {
    const width = n.measured?.width ?? 0;
    const height = n.measured?.height ?? 0;
    if (n.hidden || !width || !height) continue;
    items.push({ x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, width, height });
  }
  const pane = s.domNode?.getBoundingClientRect();
  const el = s.domNode?.querySelector<HTMLElement>('[data-testid="trace-card"]')?.getBoundingClientRect();
  const width = el?.width || 352;
  const x = el && pane ? el.left - pane.left : s.width - 16 - width;
  return fitAvoiding(
    items,
    { width: s.width, height: s.height },
    [{ x, y: TRACE_CARD_TOP, width, height: TRACE_CARD_FOOTPRINT }],
    { margin: 0, gap: 16, maxZoom: LIVE_FIT.maxZoom, insets: LIVE_FIT.insets },
  );
}

/**
 * Live's whole diagram in view. With the trace card open (and no side panel) it keeps clear of the card's footprint
 * only: a wide diagram moves down a little instead of shrinking to the left of a full-height column, so tracing
 * costs no zoom. With the side panel open, it fits into what the panel leaves.
 */
export function liveFitViewport(s: State, room: { panel: boolean; card: boolean }): Viewport | null {
  if (room.card && !room.panel) {
    const beside = fitBesideCard(s);
    if (beside) return beside;
  }
  const right = room.panel ? PANEL_RIGHT : room.card ? CARD_RIGHT : LIVE_FIT.insets.right;
  return fitNodesViewport(s, null, { ...LIVE_FIT.insets, right }, LIVE_FIT.maxZoom);
}

/** A note's focus in view, clear of the side panel or the trace card's column. */
export function noteFitViewport(
  s: State,
  focus: readonly string[],
  room: { panel: boolean; card: boolean },
): Viewport | null {
  const right = room.panel ? PANEL_RIGHT : room.card ? CARD_RIGHT : NOTE_FIT.insets.right;
  return fitNodesViewport(s, new Set(focus), { ...NOTE_FIT.insets, right }, NOTE_FIT.maxZoom);
}
