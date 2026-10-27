import type { MessageTrace } from "../sim/types";

/** The path needs no journey rows, timings, labels or diagram lookup. */
export function tracePath(trace: MessageTrace): { nodes: string[]; edges: string[] } {
  const nodes = new Set<string>();
  const edges = new Set<string>();
  if (trace.origin) nodes.add(trace.origin);
  for (const step of trace.steps) {
    if (step.kind === "arrive" && step.node) nodes.add(step.node);
    if (step.kind === "send" && step.edge) edges.add(step.edge);
  }
  return { nodes: [...nodes], edges: [...edges] };
}
