import { DIAGRAM_FORMAT, type DiagramEdge, type DiagramFile, type DiagramGroup, type DiagramNode } from "../model/types";
import { uniqueId } from "./ids";

// Copy / paste on the saved-file level, so it is pure and the system clipboard carries plain
// JSON that also pastes into another tab (or a text editor).

export const CLIP_FORMAT = "diagrams/clip-v1" as const;

export interface ClipboardPayload {
  format: typeof CLIP_FORMAT;
  groups: DiagramGroup[];
  nodes: DiagramNode[];
  /** Only edges whose both ends were copied. */
  edges: DiagramEdge[];
}

export interface TakenIds {
  nodes: ReadonlySet<string>;
  edges: ReadonlySet<string>;
  groups: ReadonlySet<string>;
}

/** Builds a payload from a selection. Copying a group copies the nodes inside it too. */
export function makePayload(
  d: DiagramFile,
  nodeIds: Iterable<string>,
  groupIds: Iterable<string> = [],
): ClipboardPayload | null {
  const gs = new Set(groupIds);
  const groups = (d.groups ?? []).filter((g) => gs.has(g.id));
  const ns = new Set(nodeIds);
  for (const n of d.nodes) if (n.group && gs.has(n.group)) ns.add(n.id);
  const nodes = d.nodes.filter((n) => ns.has(n.id));
  if (!nodes.length && !groups.length) return null;
  const edges = d.edges.filter((e) => ns.has(e.from) && ns.has(e.to));
  return structuredClone({ format: CLIP_FORMAT, groups, nodes, edges });
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Accepts a clipboard payload or a whole diagrams/v1 file (pasting a file merges it in). */
export function parsePayload(text: string): ClipboardPayload | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(data) || (data.format !== CLIP_FORMAT && data.format !== DIAGRAM_FORMAT)) return null;
  if (!Array.isArray(data.nodes)) return null;
  const nodes = data.nodes.filter(
    (n): n is DiagramNode =>
      isObj(n) && typeof n.id === "string" && typeof n.stencil === "string" && typeof n.x === "number" && typeof n.y === "number",
  );
  const ids = new Set(nodes.map((n) => n.id));
  const edges = (Array.isArray(data.edges) ? data.edges : []).filter(
    (e): e is DiagramEdge => isObj(e) && typeof e.id === "string" && ids.has(e.from as string) && ids.has(e.to as string),
  );
  const groups = (Array.isArray(data.groups) ? data.groups : []).filter(
    (g): g is DiagramGroup =>
      isObj(g) && typeof g.id === "string" && ["x", "y", "width", "height"].every((k) => typeof g[k] === "number"),
  );
  if (!nodes.length && !groups.length) return null;
  return { format: CLIP_FORMAT, groups, nodes: nodes.map((n) => ({ ...n, label: n.label ?? "" })), edges };
}

/** Top-left of everything in the payload. */
export function payloadOrigin(p: ClipboardPayload): { x: number; y: number } {
  const xs = [...p.nodes.map((n) => n.x), ...p.groups.map((g) => g.x)];
  const ys = [...p.nodes.map((n) => n.y), ...p.groups.map((g) => g.y)];
  return { x: Math.min(...xs), y: Math.min(...ys) };
}

/**
 * Gives every element a fresh id (not in `taken`), rewires edges and group references, and moves
 * everything by `offset`. Node `group` references to groups outside the payload are kept as-is.
 */
export function remapPayload(p: ClipboardPayload, taken: TakenIds, offset: { x: number; y: number }): ClipboardPayload {
  const nodeIds = new Set(taken.nodes);
  const edgeIds = new Set(taken.edges);
  const groupIds = new Set(taken.groups);
  const gmap = new Map<string, string>();
  const nmap = new Map<string, string>();
  const groups = p.groups.map((g) => {
    const id = uniqueId(g.id, groupIds);
    groupIds.add(id);
    gmap.set(g.id, id);
    return { ...g, id, x: g.x + offset.x, y: g.y + offset.y };
  });
  const nodes = p.nodes.map((n) => {
    const id = uniqueId(n.id, nodeIds);
    nodeIds.add(id);
    nmap.set(n.id, id);
    const group = n.group ? (gmap.get(n.group) ?? n.group) : undefined;
    return { ...structuredClone(n), id, group, x: n.x + offset.x, y: n.y + offset.y };
  });
  const edges = p.edges.map((e) => {
    const id = uniqueId(e.id, edgeIds);
    edgeIds.add(id);
    return { ...structuredClone(e), id, from: nmap.get(e.from) ?? e.from, to: nmap.get(e.to) ?? e.to };
  });
  return { format: CLIP_FORMAT, groups, nodes, edges };
}
