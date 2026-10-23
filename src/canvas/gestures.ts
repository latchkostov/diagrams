// Pure rules behind the canvas gestures: what a connection drag is over (D1, D2) and what a selection
// box picks (D5). The canvas feeds them what's under the pointer and the nodes' boxes; they decide.

import type { Side, AnnotationKind } from "../model/types";
import { isConnectable } from "./annotations";
import { overlaps, type Box } from "./placement";

/** What's under the pointer during a connection drag, as the canvas sees it. */
export interface ConnectHit {
  /** The React Flow node under the pointer (boundaries and zones never are: they let the pointer through). */
  node?: { id: string; type: string; annotation?: AnnotationKind };
  /** Over floating chrome inside the canvas: the controls, the minimap, the title card, a bar. */
  chrome?: boolean;
  /** Inside the canvas at all (the pane, an edge or its label). */
  canvas: boolean;
}

/**
 * - `node`: a drop connects to it (anywhere on it, not only a handle);
 * - `invalid`: a text, note or zone, which takes no edges (`not-allowed`);
 * - `source`: back over the node it started from: a drop does nothing;
 * - `canvas`: empty canvas: a drop opens quick-add there;
 * - `outside`: chrome or off the canvas: a drop does nothing.
 */
export type ConnectTarget =
  | { kind: "node"; id: string; side?: Side }
  | { kind: "invalid"; id: string }
  | { kind: "source" }
  | { kind: "canvas" }
  | { kind: "outside" };

export function connectTarget(hit: ConnectHit, sourceId: string): ConnectTarget {
  if (hit.chrome) return { kind: "outside" };
  const n = hit.node;
  if (n) {
    if (n.id === sourceId) return { kind: "source" };
    if (n.type === "diagram") return { kind: "node", id: n.id };
    if (n.type === "annotation") {
      if (n.annotation === "zone") return { kind: "canvas" };
      return n.annotation && isConnectable(n.annotation) ? { kind: "node", id: n.id } : { kind: "invalid", id: n.id };
    }
    // A boundary is a backdrop: dropping inside one adds the new node to it.
    return { kind: "canvas" };
  }
  return hit.canvas ? { kind: "canvas" } : { kind: "outside" };
}

/** Floating chrome inside the canvas: a drop there is not a drop on the canvas. */
export const CANVAS_CHROME =
  ".react-flow__panel, .react-flow__minimap, .react-flow__controls, .react-flow__attribution, [data-canvas-overlay], [data-editor-overlay]";

/** Reads a ConnectHit off the element under the pointer. */
export function connectHitAt(
  el: Element | null,
  annotationKind: (id: string) => AnnotationKind | undefined,
): ConnectHit {
  if (!el || !el.closest(".react-flow")) return { canvas: false };
  if (el.closest(CANVAS_CHROME)) return { canvas: true, chrome: true };
  const node = el.closest<HTMLElement>(".react-flow__node");
  const id = node?.dataset.id;
  if (!node || !id) return { canvas: true };
  const type = node.classList.contains("react-flow__node-diagram")
    ? "diagram"
    : node.classList.contains("react-flow__node-annotation")
      ? "annotation"
      : "boundary";
  return { canvas: true, node: { id, type, annotation: type === "annotation" ? annotationKind(id) : undefined } };
}

/** A node as the selection box sees it. */
export interface BoxItem extends Box {
  id: string;
  /** Boundaries and zones: backdrops, picked only when the box holds them whole. */
  backdrop?: boolean;
}

const inside = (b: Box, box: Box) =>
  b.x >= box.x && b.y >= box.y && b.x + b.width <= box.x + box.width && b.y + b.height <= box.y + box.height;

/**
 * What a selection box picks: the things it touches, as in Figma, tldraw and Excalidraw, or with
 * `contain` (Ctrl/Cmd held) only those wholly inside. Backdrops (boundaries, zones) always need to be
 * wholly inside: a box drawn among a boundary's nodes would otherwise always pick the boundary too.
 */
export function pickInBox(items: Iterable<BoxItem>, box: Box, contain = false): string[] {
  const out: string[] = [];
  for (const it of items) {
    if (contain || it.backdrop ? inside(it, box) : overlaps(it, box)) out.push(it.id);
  }
  return out;
}

/** Edges a box selection takes along: only those with both ends picked. */
export function edgesBetween<E extends { id: string; source: string; target: string }>(
  edges: Iterable<E>,
  picked: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>();
  for (const e of edges) if (picked.has(e.source) && picked.has(e.target)) out.add(e.id);
  return out;
}

/** React Flow measures its snap radius in flow pixels; retain at least 20 screen pixels at low zoom. */
export const CONNECT_RADIUS = 28;
export function connectionRadius(zoom: number): number {
  const step = Math.max(0.05, Math.floor(zoom * 20) / 20);
  return Math.max(CONNECT_RADIUS, 20 / step);
}

/** Side dots only: the quick-add handle (grow) is never a pinned side. */
export function portSide(id: string | null | undefined): Side | undefined {
  return id === "top" || id === "right" || id === "bottom" || id === "left" ? id : undefined;
}
