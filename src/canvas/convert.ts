import { DIAGRAM_FORMAT, type DiagramEdge, type DiagramFile, type DiagramGroup, type DiagramNode } from "../model/types";
import {
  GROUP_PREFIX,
  type DiagramFlowEdge,
  type DiagramFlowNode,
  type FlowNode,
  type GroupFlowNode,
} from "./types";

/** Metadata carried alongside the canvas state so export round-trips the whole file. */
export type DiagramMeta = Pick<DiagramFile, "title" | "description" | "direction">;

/**
 * DiagramFile -> React Flow. Groups become background nodes (zIndex -1), NOT React Flow
 * parents, so every node keeps the absolute coordinates stored in the file.
 */
export function toFlow(d: DiagramFile): { meta: DiagramMeta; nodes: FlowNode[]; edges: DiagramFlowEdge[] } {
  const groups: GroupFlowNode[] = (d.groups ?? []).map((g) => ({
    id: GROUP_PREFIX + g.id,
    type: "boundary",
    position: { x: g.x, y: g.y },
    width: g.width,
    height: g.height,
    zIndex: -1,
    dragHandle: ".grp-drag",
    data: { groupId: g.id, label: g.label, tone: g.tone ?? "neutral" },
  }));
  const nodes: DiagramFlowNode[] = d.nodes.map((n) => ({
    id: n.id,
    type: "diagram",
    position: { x: n.x, y: n.y },
    data: { stencil: n.stencil, label: n.label, sublabel: n.sublabel, group: n.group, props: n.props },
  }));
  const edges: DiagramFlowEdge[] = d.edges.map((e) => ({
    id: e.id,
    source: e.from,
    target: e.to,
    type: "flow",
    data: { kind: e.kind ?? "async", label: e.label, props: e.props },
  }));
  return {
    meta: { title: d.title, description: d.description, direction: d.direction },
    nodes: [...groups, ...nodes],
    edges,
  };
}

const r = (v: number) => Math.round(v);

/** React Flow -> DiagramFile (diagrams/v1). Undefined fields are dropped by JSON.stringify. */
export function fromFlow(meta: DiagramMeta, nodes: FlowNode[], edges: DiagramFlowEdge[]): DiagramFile {
  const groups: DiagramGroup[] = [];
  const out: DiagramNode[] = [];
  for (const n of nodes) {
    if (n.type === "boundary") {
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
    props: e.data?.props,
  }));
  return {
    format: DIAGRAM_FORMAT,
    title: meta.title,
    description: meta.description,
    direction: meta.direction,
    ...(groups.length ? { groups } : {}),
    nodes: out,
    edges: outEdges,
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
