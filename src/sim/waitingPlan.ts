import { revisionAtLeast } from "../model/revisions";
import type { DiagramFile } from "../model/types";
import type { ResolvedProps } from "./defaults";
import { callEligible, compileTopology } from "./topology";
import { stencilRole } from "../stencils/roles";
import { resolvedTiming } from "./timing";

export interface WaitCapacity {
  workMs: number;
  callMs: number;
  holdMs: number;
}

/** Reverse topological evaluation, O(nodes + connections), including deep graphs and cycles. */
export function waitingPlan(diagram: DiagramFile, resolved: Record<string, ResolvedProps>) {
  const result = new Map<string, WaitCapacity>();
  if (!revisionAtLeast(diagram.planning?.revision, "p3-w1")) return { nodes: result, converged: true };
  const topology = compileTopology(diagram);
  const roles = new Map(diagram.nodes.map((n) => [n.id, stencilRole(n.stencil)]));
  const delays = new Map(
    diagram.edges.map((e) => [e.id, typeof e.props?.networkDelayMs === "number" ? e.props.networkDelayMs : 0]),
  );
  const remaining = new Map<string, number>();
  const parents = new Map<string, { node: string; delay: number; endpoint?: string }[]>();
  const callMs = new Map<string, number>();
  const queue: string[] = [];
  for (const node of diagram.nodes) remaining.set(node.id, 0);
  for (const edge of topology.edges) {
    if (!callEligible(roles.get(edge.from)!, edge) || edge.deny || edge.share === 0) continue;
    remaining.set(edge.from, (remaining.get(edge.from) ?? 0) + 1);
    const list = parents.get(edge.to) ?? [];
    list.push({ node: edge.from, delay: 2 * Math.max(0, delays.get(edge.id) ?? 0), endpoint: edge.endpointId });
    parents.set(edge.to, list);
  }
  for (const [id, count] of remaining) if (!count) queue.push(id);
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    const props = resolved[id];
    const { workMs } = resolvedTiming(props);
    const waiting = callMs.get(id) ?? 0;
    const holdMs = workMs + waiting;
    if (waiting > 0) result.set(id, { workMs, callMs: waiting, holdMs });
    for (const parent of parents.get(id) ?? []) {
      const endpointMs = resolvedTiming(props, 0, parent.endpoint).workMs;
      callMs.set(parent.node, Math.max(callMs.get(parent.node) ?? 0, endpointMs + waiting + parent.delay));
      const count = remaining.get(parent.node)! - 1;
      remaining.set(parent.node, count);
      if (!count) queue.push(parent.node);
    }
  }
  for (const [id, count] of remaining)
    if (count) result.set(id, { workMs: resolved[id].latencyMs, callMs: Infinity, holdMs: Infinity });
  return { nodes: result, converged: queue.length === remaining.size };
}
