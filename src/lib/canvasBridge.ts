import { safeStorage, safeSessionStorage } from "./storage";
import { DIAGRAM_FORMAT, type DiagramFile, type DiagramNode, type Stencil } from "../model/types";
import { createDiagram } from "./diagramIO";
import { notify } from "../interop/ui/toast";
import { pushRecentStencil } from "./recentStencils";

/**
 * A small bridge from the Gallery to the Canvas. The two views never mount together, so
 * "Add to current diagram" queues stencil ids here and switches views through the URL;
 * the canvas palette drains the queue once the canvas has fitted its viewport and adds each
 * stencil at the viewport centre (a normal, undoable edit).
 */
/** Drag-and-drop payload type for a stencil id (palette → canvas, gallery tile → drop dock). */
export const STENCIL_DND_MIME = "application/x-diagrams-stencil";

const PENDING_KEY = "diagrams.pendingStencils.v1";
const LAST_CANVAS_KEY = "diagrams.lastCanvas.v1";

function readList(storage: Pick<Storage, "getItem">, key: string): string[] {
  try {
    const v = JSON.parse(storage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function queueStencilsForCanvas(ids: string[]) {
  safeSessionStorage.setItem(PENDING_KEY, JSON.stringify([...readList(safeSessionStorage, PENDING_KEY), ...ids]));
}

/** Returns and clears the queued stencil ids. */
export function takePendingStencils(): string[] {
  const ids = readList(safeSessionStorage, PENDING_KEY);
  safeSessionStorage.removeItem(PENDING_KEY);
  return ids;
}

/** The canvas records which diagram is open so the Gallery can send stencils back to it. */
export function rememberCanvas(slug: string) {
  try {
    safeStorage.setItem(LAST_CANVAS_KEY, slug);
  } catch {
    // ignore
  }
}

export function lastCanvas(): string | undefined {
  try {
    return safeStorage.getItem(LAST_CANVAS_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Client-side switch to the canvas: the app's URL state listens to popstate. */
export function openCanvas(slug = lastCanvas()) {
  const p = new URLSearchParams({ view: "canvas" });
  if (slug) p.set("example", slug);
  window.history.pushState(null, "", `${window.location.pathname}?${p}${window.location.hash}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function addToCurrentDiagram(stencilId: string) {
  queueStencilsForCanvas([stencilId]);
  pushRecentStencil(stencilId);
  openCanvas();
}

/** A diagrams/v1 node for this stencil, as pasted into a hand-written diagram file. */
export function nodeJson(s: Stencil, at = { x: 40, y: 40 }): DiagramNode {
  const base = s.id.split(".").pop() || "node";
  return {
    id: base,
    stencil: s.id,
    label: s.label,
    ...(s.defaultSublabel ? { sublabel: s.defaultSublabel } : {}),
    x: at.x,
    y: at.y,
  };
}

/** Starts a new diagram holding just this stencil, in Your diagrams (nothing is replaced). */
export function openNewDiagramWith(s: Stencil) {
  const d: DiagramFile = {
    format: DIAGRAM_FORMAT,
    title: `New ${s.label} diagram`,
    nodes: [nodeJson(s, { x: 40, y: 160 })],
    edges: [],
  };
  pushRecentStencil(s.id);
  // createDiagram tells the App to re-read the library; openCanvas navigates client-side (no reload).
  try {
    openCanvas(createDiagram(d));
  } catch (err) {
    notify(`Couldn't start a new diagram. ${err instanceof Error ? err.message : String(err)}`, { kind: "error" });
    return;
  }
  notify(`Started “${d.title}” in Your diagrams.`, { kind: "success" });
}
