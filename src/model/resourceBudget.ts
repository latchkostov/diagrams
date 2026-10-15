import type { DiagramFile } from "./types";
/** Lifecycle objects are independent of the particle budget. Reject the whole configuration, never a partial run. */
export const MAX_LIFECYCLE_REPLICAS = 100_000;
export function resourceBudgetExceeded(d: DiagramFile): boolean {
  if (d.planning?.revision !== "p3-a1") return false;
  const known = new Set(d.nodes.map((n) => n.id));
  const nodes = new Map<string, { enabled: boolean; count: number }>();
  let multiplier = 4; // Includes the largest free-play Capacity × control.
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
    if (enabled) total += Math.max(1, Math.min(10_000, Math.round(count * multiplier)));
    if (total > MAX_LIFECYCLE_REPLICAS) return true;
  }
  return false;
}
