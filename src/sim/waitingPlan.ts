import type { DiagramFile } from "../model/types";
import type { ResolvedProps } from "./defaults";
import { compileTopology } from "./topology";

export interface WaitCapacity {
  workMs: number;
  callMs: number;
  holdMs: number;
}

/** Reverse topological evaluation, O(nodes + connections), including deep graphs and cycles. */
export function waitingPlan(diagram: DiagramFile, resolved: Record<string, ResolvedProps>) {
  const result = new Map<string, WaitCapacity>();
  if (diagram.planning?.revision !== "p3-w1") return { nodes: result, converged: true };
  const topology = compileTopology(diagram);
  const delays = new Map(
    diagram.edges.map((e) => [e.id, typeof e.props?.networkDelayMs === "number" ? e.props.networkDelayMs : 0]),
  );
  const remaining = new Map<string, number>();
  const parents = new Map<string, { node: string; delay: number; endpoint?: string }[]>();
  const callMs = new Map<string, number>();
  const queue: string[] = [];
  for (const node of diagram.nodes) remaining.set(node.id, 0);
  for (const edge of topology.edges) {
    if (!edge.sync || edge.dlq || edge.deny || edge.share === 0) continue;
    remaining.set(edge.from, (remaining.get(edge.from) ?? 0) + 1);
    const list = parents.get(edge.to) ?? [];
    list.push({ node: edge.from, delay: 2 * Math.max(0, delays.get(edge.id) ?? 0), endpoint: edge.endpointId });
    parents.set(edge.to, list);
  }
  for (const [id, count] of remaining) if (!count) queue.push(id);
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    const props = resolved[id];
    const workMs = props.admission?.api.latencyMs ?? props.latencyMs;
    const waiting = callMs.get(id) ?? 0;
    const holdMs = workMs + waiting;
    if (waiting > 0) result.set(id, { workMs, callMs: waiting, holdMs });
    for (const parent of parents.get(id) ?? []) {
      const endpointMs =
        props.admission?.endpoints.find((e) => e.id === parent.endpoint)?.behaviour?.latencyMs ?? workMs;
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
