import {
  DIAGRAM_FORMAT,
  type DiagramAnnotation,
  type DiagramEdge,
  type DiagramFile,
  type DiagramGroup,
  type DiagramNode,
} from "../model/types";
import { filterLayerOrder } from "../model/layers";
import { expandGroupIds, sanitizeGroupParents } from "../model/groupHierarchy";
import { isPresetGroupTone } from "../canvas/groupTones";
import { isHexColor } from "../model/colors";
import { uniqueId } from "./ids";
import { normalizeAnnotation, annotationCoordinate } from "../model/annotations";
import { LIMITS, exceedsDepth, validateDiagram } from "../interop/native";

import { propsProblem, unsupportedPreset, invalidPlanningDelay } from "../model/simProps";
import { clipboardNodes } from "../model/planning";
import { remapConnection } from "../model/connectionDefaults";

// Copy / paste on the saved-file level, so it is pure and the system clipboard carries plain
// JSON that also pastes into another tab (or a text editor).

export const CLIP_FORMAT = "diagrams/clip-v1" as const;

export interface ClipboardPayload {
  format: typeof CLIP_FORMAT;
  /** Foreground ids, back to front, in the shared node/annotation namespace. */
  layerOrder?: string[];
  groups: DiagramGroup[];
  nodes: DiagramNode[];
  /** Only edges whose both ends were copied. */
  edges: DiagramEdge[];
  /** Texts, notes, zones and shapes (absent in payloads from before annotations). */
  annotations?: DiagramAnnotation[];
  /** Copied from a private diagram: pasting it makes the target diagram private too. */
  private?: boolean;
}

export interface TakenIds {
  nodes: ReadonlySet<string>;
  edges: ReadonlySet<string>;
  groups: ReadonlySet<string>;
}

/**
 * Builds a payload from a selection. Copying a group copies the nodes inside it too. `nodeIds` may
 * name annotations as well (they share the node namespace).
 */
export function makePayload(
  d: DiagramFile,
  nodeIds: Iterable<string>,
  groupIds: Iterable<string> = [],
  isPrivate = false,
): ClipboardPayload | null {
  const gs = expandGroupIds(groupIds, d.groups ?? []);
  const groups = (d.groups ?? []).filter((g) => gs.has(g.id));
  const ns = new Set(nodeIds);
  for (const n of d.nodes) if (n.group && gs.has(n.group)) ns.add(n.id);
  for (const a of d.annotations ?? []) if (a.group && gs.has(a.group)) ns.add(a.id);
  const nodes = clipboardNodes(d).filter((n) => ns.has(n.id));
  const annotations = (d.annotations ?? []).filter((a) => ns.has(a.id));
  if (!nodes.length && !groups.length && !annotations.length) return null;
  const edges = d.edges.filter((e) => ns.has(e.from) && ns.has(e.to));
  return structuredClone({
    format: CLIP_FORMAT,
    groups,
    nodes,
    edges,
    ...(annotations.length ? { annotations } : {}),
    ...(d.layerOrder ? { layerOrder: filterLayerOrder(d.layerOrder, { nodes, annotations }) } : {}),
    ...(isPrivate ? { private: true } : {}),
  });
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** A finite number within the file format's coordinate budget (positions and sizes alike). */
const isCoordinate = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= LIMITS.maxCoordinate;

/** Accepts a clipboard payload or a supported whole diagram file (pasting a file merges it in). */
export function parsePayload(text: string): ClipboardPayload | null {
  if (text.length > LIMITS.maxTextChars) return null;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(data) || (data.format !== CLIP_FORMAT && data.format !== DIAGRAM_FORMAT && data.format !== "diagrams/v2"))
    return null;
  if (data.format !== CLIP_FORMAT) {
    const result = validateDiagram(data);
    if (!result.ok) return null;
    data = { ...result.diagram, nodes: clipboardNodes(result.diagram), format: CLIP_FORMAT };
  }
  if (!isObj(data)) return null;
  if (!Array.isArray(data.nodes)) return null;
  if (exceedsDepth(data)) return null;
  for (const [list, max] of [
    [data.nodes, LIMITS.maxNodes],
    [data.annotations, LIMITS.maxAnnotations],
    [data.edges, LIMITS.maxEdges],
    [data.groups, LIMITS.maxGroups],
  ] as const)
    if (Array.isArray(list) && list.length > max) return null;
  const nodes = data.nodes.filter(
    (n): n is DiagramNode =>
      isObj(n) && typeof n.id === "string" && typeof n.stencil === "string" && isCoordinate(n.x) && isCoordinate(n.y),
  );
  if (nodes.some((n) => n.props !== undefined && (unsupportedPreset(n.props) || propsProblem(n.props)))) return null;
  const used = new Set(nodes.map((n) => n.id));
  const annotations: DiagramAnnotation[] = [];
  for (const raw of Array.isArray(data.annotations) ? data.annotations : []) {
    const a = normalizeAnnotation(raw, used);
    if (a) {
      annotations.push(a);
      used.add(a.id);
    }
  }
  const ids = new Set([...nodes.map((n) => n.id), ...annotations.filter((a) => a.kind === "shape").map((a) => a.id)]);
  const edges = (Array.isArray(data.edges) ? data.edges : []).filter(
    (e): e is DiagramEdge =>
      isObj(e) && typeof e.id === "string" && ids.has(e.from as string) && ids.has(e.to as string),
  );
  if (edges.some((e) => invalidPlanningDelay(e.props))) return null;
  const groups = (Array.isArray(data.groups) ? data.groups : []).filter(
    (g): g is DiagramGroup =>
      isObj(g) &&
      typeof g.id === "string" &&
      isCoordinate(g.x) &&
      isCoordinate(g.y) &&
      isCoordinate(g.width) &&
      isCoordinate(g.height) &&
      (g.width as number) >= 0 &&
      (g.height as number) >= 0,
  );
  if (!nodes.length && !groups.length && !annotations.length) return null;
  return {
    format: CLIP_FORMAT,
    groups: groups.map((g) => ({ ...g, tone: isPresetGroupTone(g.tone) || isHexColor(g.tone) ? g.tone : "neutral" })),
    nodes: nodes.map((n) => ({ ...n, label: n.label ?? "" })),
    edges,
    ...(annotations.length ? { annotations } : {}),
    ...(Array.isArray(data.layerOrder)
      ? { layerOrder: filterLayerOrder(data.layerOrder, { nodes, annotations }) }
      : {}),
    // Fails closed, like a file's "private": anything but absent or false keeps the paste private.
    ...(data.private !== undefined && data.private !== false ? { private: true } : {}),
  };
}

/** Top-left of everything in the payload. */
export function payloadOrigin(p: ClipboardPayload): { x: number; y: number } {
  const as = p.annotations ?? [];
  const xs = [...p.nodes.map((n) => n.x), ...p.groups.map((g) => g.x), ...as.map((a) => a.x)];
  const ys = [...p.nodes.map((n) => n.y), ...p.groups.map((g) => g.y), ...as.map((a) => a.y)];
  return { x: Math.min(...xs), y: Math.min(...ys) };
}

/**
 * Gives every element a fresh id (not in `taken`), rewires edges and group references, and moves
 * everything by `offset`. Node `group` references to groups outside the payload are kept as-is.
 */
export function remapPayload(p: ClipboardPayload, taken: TakenIds, offset: { x: number; y: number }): ClipboardPayload {
  // One id space for every kind: a pasted node never takes a connection's or a boundary's id.
  const used = new Set([...taken.nodes, ...taken.edges, ...taken.groups]);
  const gmap = new Map<string, string>();
  const nmap = new Map<string, string>();
  const groupIds = p.groups.map((g) => {
    const id = uniqueId(g.id, used);
    used.add(id);
    if (!gmap.has(g.id)) gmap.set(g.id, id);
    return id;
  });
  const groups = sanitizeGroupParents(
    p.groups.map((g, i) => {
      const id = groupIds[i];
      const group = typeof g.group === "string" ? (gmap.get(g.group) ?? g.group) : undefined;
      return { ...g, id, group, x: g.x + offset.x, y: g.y + offset.y };
    }),
    taken.groups,
  );
  const nodes = p.nodes.map((n) => {
    const id = uniqueId(n.id, used);
    used.add(id);
    nmap.set(n.id, id);
    const group = n.group ? (gmap.get(n.group) ?? n.group) : undefined;
    return { ...structuredClone(n), id, group, x: n.x + offset.x, y: n.y + offset.y };
  });
  const annotations = (p.annotations ?? []).map((a) => {
    const id = uniqueId(a.id, used);
    used.add(id);
    nmap.set(a.id, id);
    const group = a.group ? (gmap.get(a.group) ?? a.group) : undefined;
    return {
      ...structuredClone(a),
      id,
      group,
      x: annotationCoordinate(a.x + offset.x),
      y: annotationCoordinate(a.y + offset.y),
    };
  });
  const edges = p.edges.map((e) => {
    const id = uniqueId(e.id, used);
    used.add(id);
    return { ...remapConnection(e, nmap), id };
  });
  return {
    format: CLIP_FORMAT,
    groups,
    nodes,
    edges,
    ...(annotations.length ? { annotations } : {}),
    ...(p.layerOrder ? { layerOrder: filterLayerOrder(p.layerOrder, p)?.map((id) => nmap.get(id)!) } : {}),
  };
}
