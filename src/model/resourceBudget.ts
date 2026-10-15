import type { DiagramFile } from "./types";
/** Lifecycle objects are independent of the particle budget. Reject the whole configuration, never a partial run. */
export const MAX_LIFECYCLE_REPLICAS = 100_000;
export class LifecycleBudgetError extends Error {}
/** The same contribution for a current configuration and a saved-run maximum. */
export function resourceAllocationCount(enabled: boolean, count: number, capacityMultiplier: number): number {
  return enabled ? Math.max(1, Math.min(10_000, Math.round(count * Math.max(4, capacityMultiplier)))) : 0;
}
export type ResourceCandidate = Pick<DiagramFile, "planning" | "simulations"> & {
  nodes: readonly { id: string; stencil?: string; props?: Record<string, unknown> }[];
  edges?: DiagramFile["edges"];
};
export function resourceBudgetExceeded(d: ResourceCandidate, capacityMultiplier = 4): boolean {
  if (d.planning?.revision !== "p3-a1") return false;
  const known = new Set(d.nodes.map((n) => n.id));
  const nodes = new Map<string, { enabled: boolean; count: number }>();
  let multiplier = Math.max(4, capacityMultiplier); // Includes the largest free-play Capacity × control.
  const collect = (id: string, props: Record<string, unknown> | undefined) => {
    if (!known.has(id)) return;
    const entry = nodes.get(id) ?? { enabled: false, count: 1 };
    if (props?.resources) entry.enabled = true;
    if (typeof props?.replicas === "number" && Number.isFinite(props.replicas))
      entry.count = Math.max(entry.count, props.replicas);
    const a = props?.autoscaling as { mode?: string; controller?: { maxReplicas?: unknown } } | undefined;
    if (a?.mode === "on" && typeof a.controller?.maxReplicas === "number")
      entry.count = Math.max(entry.count, a.controller.maxReplicas);
    nodes.set(id, entry);
  };
  for (const n of d.nodes) collect(n.id, n.props);
  for (const s of d.simulations ?? []) {
    const capacity = s.multipliers?.capacity;
    if (typeof capacity === "number" && Number.isFinite(capacity)) multiplier = Math.max(multiplier, capacity);
    for (const [id, props] of Object.entries(s.setup?.props ?? {})) collect(id, props);
    for (const step of s.timeline ?? []) if (step.action.do === "props") collect(step.action.node, step.action.props);
  }
  let total = 0;
  for (const { enabled, count } of nodes.values()) {
    total += resourceAllocationCount(enabled, count, multiplier);
    if (total > MAX_LIFECYCLE_REPLICAS) return true;
  }
  return false;
}
