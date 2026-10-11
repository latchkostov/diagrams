import {
  DIAGRAM_FORMAT,
  type DiagramAnnotation,
  type DiagramEdge,
  type DiagramFile,
  type DiagramGroup,
  type DiagramNode,
  type EdgeRelation,
} from "../model/types";
import { implicitLabel, isDependency, relationOf } from "../model/relations";
import { foregroundLayerOrder } from "../model/layers";
import { getStencil } from "../stencils/registry";
import { annotationAriaLabel, annotationTitle, isConnectable } from "./annotations";
import {
  GROUP_PREFIX,
  type AnnotationFlowNode,
  type DiagramFlowEdge,
  type DiagramFlowNode,
  type FlowNode,
  type GroupFlowNode,
} from "./types";

/**
 * Everything in the file that isn't a node, edge or group, carried alongside the canvas state so
 * export / autosave / undo round-trip the whole file (saved simulations included, untouched).
 */
export type DiagramMeta = Pick<DiagramFile, "title" | "description" | "direction" | "simulations">;

// ---------------------------------------------------------------- accessible names
// React Flow renders nodes and edges as focusable elements named by `ariaLabel`, so every one
// gets a name derived from what's drawn: "Order service, .NET Service, processor".

export function nodeAriaLabel(d: { stencil: string; label: string }): string {
  const s = getStencil(d.stencil);
  return [d.label || s.label, s.label, s.simRole !== "none" ? s.simRole : null].filter(Boolean).join(", ");
}

export const groupAriaLabel = (label: string) => `${label || "Untitled"}, boundary`;

export function edgeAriaLabel(
  from: string,
  to: string,
  kind: "async" | "sync" | undefined,
  label?: string,
  relation?: EdgeRelation,
): string {
  return `${from} to ${to}, ${implicitLabel(relation ?? "flow", kind)}${label ? `: ${label}` : ""}`;
}

const nodeAriaCopies = new WeakMap<object, FlowNode>();

/**
 * Nodes with up-to-date accessible names (labels change by inline edit, the inspector, undo...).
 * Unchanged nodes pass through; refreshed copies are cached per node object, so React Flow sees
 * stable identities and does no extra work.
 */
export function withNodeAria(nodes: FlowNode[]): FlowNode[] {
  let changed = false;
  const out = nodes.map((n) => {
    const want =
      n.type === "boundary"
        ? groupAriaLabel(n.data.label)
        : n.type === "annotation"
          ? annotationAriaLabel(n.data)
          : nodeAriaLabel(n.data);
    if (n.ariaLabel === want) return n;
    changed = true;
    const cached = nodeAriaCopies.get(n);
    if (cached?.ariaLabel === want) return cached;
    const copy = { ...n, ariaLabel: want } as FlowNode;
    nodeAriaCopies.set(n, copy);
    return copy;
  });
  return changed ? out : nodes;
}

const edgeAriaCopies = new WeakMap<object, DiagramFlowEdge>();

/** Edges with accessible names that follow the current node labels (see withNodeAria). */
export function withEdgeAria(edges: DiagramFlowEdge[], labelOf: (id: string) => string): DiagramFlowEdge[] {
  let changed = false;
  const out = edges.map((e) => {
    const want = edgeAriaLabel(labelOf(e.source), labelOf(e.target), e.data?.kind, e.data?.label, e.data?.relation);
    if (e.ariaLabel === want) return e;
    changed = true;
    const cached = edgeAriaCopies.get(e);
    if (cached?.ariaLabel === want) return cached;
    const copy = { ...e, ariaLabel: want };
    edgeAriaCopies.set(e, copy);
    return copy;
  });
  return changed ? out : edges;
}

export const groupToFlow = (g: DiagramGroup): GroupFlowNode => ({
  id: GROUP_PREFIX + g.id,
  ariaLabel: groupAriaLabel(g.label),
  type: "boundary",
  position: { x: g.x, y: g.y },
  width: g.width,
  height: g.height,
  zIndex: -1,
  dragHandle: ".grp-drag",
  data: { groupId: g.id, label: g.label, tone: g.tone ?? "neutral" },
});

export const nodeToFlow = (n: DiagramNode): DiagramFlowNode => ({
  id: n.id,
  type: "diagram",
  ariaLabel: nodeAriaLabel(n),
  position: { x: n.x, y: n.y },
  data: { stencil: n.stencil, label: n.label, sublabel: n.sublabel, group: n.group, props: n.props },
});

/**
 * Zones sit behind boundaries (zIndex -2) and drag by their label, like boundaries, so the pane
 * inside them stays clickable. Only shapes take edges.
 */
export const annotationToFlow = (a: DiagramAnnotation): AnnotationFlowNode => ({
  id: a.id,
  type: "annotation",
  ariaLabel: annotationAriaLabel(a),
  position: { x: a.x, y: a.y },
  width: a.width,
  height: a.height,
  connectable: isConnectable(a.kind),
  ...(a.kind === "zone" ? { zIndex: -2, dragHandle: ".ann-zone-label" } : {}),
  data: { kind: a.kind, text: a.text, shape: a.shape, color: a.color, textSize: a.textSize },
});

export const edgeToFlow = (e: DiagramEdge): DiagramFlowEdge => ({
  id: e.id,
  source: e.from,
  target: e.to,
  type: "flow",
  data: {
    kind: e.kind ?? "async",
    ...(isDependency(e) ? { relation: relationOf(e) } : {}),
    label: e.label,
    sourceSide: e.sourceSide,
    targetSide: e.targetSide,
    props: e.props,
  },
});

/**
 * DiagramFile -> React Flow. Groups become background nodes (zIndex -1), NOT React Flow
 * parents, so every node keeps the absolute coordinates stored in the file.
 */
export function toFlow(d: DiagramFile): { meta: DiagramMeta; nodes: FlowNode[]; edges: DiagramFlowEdge[] } {
  const annotations = d.annotations ?? [];
  const labels = new Map<string, string>([
    ...annotations.map((a): [string, string] => [a.id, annotationTitle(a)]),
    ...d.nodes.map((n): [string, string] => [n.id, n.label || n.id]),
  ]);
  const nodes: FlowNode[] = [
    ...annotations.filter((a) => a.kind === "zone").map(annotationToFlow),
    ...(d.groups ?? []).map(groupToFlow),
    ...d.nodes.map(nodeToFlow),
    ...annotations.filter((a) => a.kind !== "zone").map(annotationToFlow),
  ];
  if (d.layerOrder) {
    const order = new Map(foregroundLayerOrder(d).map((id, i) => [id, i]));
    const backdrops = nodes.filter((n) => n.type === "boundary" || (n.type === "annotation" && n.data.kind === "zone"));
    const foreground = nodes.filter(
      (n) => n.type !== "boundary" && !(n.type === "annotation" && n.data.kind === "zone"),
    );
    foreground.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
    nodes.splice(0, nodes.length, ...backdrops, ...foreground);
  }
  return {
    meta: { title: d.title, description: d.description, direction: d.direction, simulations: d.simulations },
    nodes,
    edges: withEdgeAria(d.edges.map(edgeToFlow), (id) => labels.get(id) ?? id),
  };
}

const r = (v: number) => Math.round(v);

/** React Flow -> DiagramFile (diagrams/v1). Undefined fields are dropped by JSON.stringify. */
export function fromFlow(meta: DiagramMeta, nodes: FlowNode[], edges: DiagramFlowEdge[]): DiagramFile {
  const groups: DiagramGroup[] = [];
  const out: DiagramNode[] = [];
  const annotations: DiagramAnnotation[] = [];
  for (const n of nodes) {
    if (n.type === "annotation") {
      annotations.push({
        id: n.id,
        kind: n.data.kind,
        text: n.data.text,
        x: r(n.position.x),
        y: r(n.position.y),
        width: r(n.width ?? n.measured?.width ?? 0),
        height: r(n.height ?? n.measured?.height ?? 0),
        shape: n.data.kind === "shape" ? n.data.shape : undefined,
        color: n.data.color,
        textSize: n.data.textSize,
      });
    } else if (n.type === "boundary") {
      groups.push({
        id: n.data.groupId,
        label: n.data.label,
        tone: n.data.tone,
        x: r(n.position.x),
        y: r(n.position.y),
        width: r(n.width ?? n.measured?.width ?? 0),
        height: r(n.height ?? n.measured?.height ?? 0),
      });
    } else {
      out.push({
        id: n.id,
        stencil: n.data.stencil,
        label: n.data.label,
        sublabel: n.data.sublabel,
        x: r(n.position.x),
        y: r(n.position.y),
        group: n.data.group,
        props: n.data.props,
      });
    }
  }
  // Drop references to groups that were deleted on the canvas.
  const groupIds = new Set(groups.map((g) => g.id));
  for (const n of out) if (n.group && !groupIds.has(n.group)) n.group = undefined;
  const outEdges: DiagramEdge[] = edges.map((e) => ({
    id: e.id,
    from: e.source,
    to: e.target,
    label: e.data?.label,
    kind: e.data?.kind ?? "async",
    relation: isDependency(e.data) ? relationOf(e.data) : undefined,
    sourceSide: e.data?.sourceSide,
    targetSide: e.data?.targetSide,
    props: e.data?.props,
  }));
  const layerOrder = nodes
    .filter((n) => n.type !== "boundary" && !(n.type === "annotation" && n.data.kind === "zone"))
    .map((n) => n.id);
  const defaultOrder = [...out.map((n) => n.id), ...annotations.filter((a) => a.kind !== "zone").map((a) => a.id)];
  const reordered = layerOrder.some((id, i) => id !== defaultOrder[i]);
  return {
    format: DIAGRAM_FORMAT,
    title: meta.title,
    description: meta.description,
    direction: meta.direction,
    ...(groups.length ? { groups } : {}),
    nodes: out,
    edges: outEdges,
    ...(meta.simulations ? { simulations: meta.simulations } : {}),
    ...(annotations.length ? { annotations } : {}),
    ...(reordered ? { layerOrder } : {}),
  };
}

/** Which group (file id) contains the centre of a box, smallest group wins. */
export function groupAt(nodes: FlowNode[], cx: number, cy: number): string | undefined {
  let best: { id: string; area: number } | undefined;
  for (const n of nodes) {
    if (n.type !== "boundary") continue;
    const w = n.width ?? n.measured?.width ?? 0;
    const h = n.height ?? n.measured?.height ?? 0;
    const inside = cx >= n.position.x && cx <= n.position.x + w && cy >= n.position.y && cy <= n.position.y + h;
    if (inside && (!best || w * h < best.area)) best = { id: n.data.groupId, area: w * h };
  }
  return best?.id;
}
