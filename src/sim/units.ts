import type { NodeSimState, SimSnapshot } from "./types";
export function resolveScale(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value >= 1 ? value : 1;
}
export function resolveMultiplier(value: number | undefined, fallback = 1): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;
}
/** Counters, rates, queue depth and lag have the same sampling weight. */
export function toRealUnits(value: number, scale = 1): number {
  return value * resolveScale(scale);
}
export function toSimulatedUnits(value: number, scale = 1): number {
  return value / resolveScale(scale);
}
export function realNodeMetrics(node: NodeSimState, scale = 1): NodeSimState {
  const real = (n: number) => toRealUnits(n, scale);
  return {
    ...node,
    backlog: real(node.backlog),
    inFlight: real(node.inFlight),
    processed: real(node.processed),
    failed: real(node.failed),
    deadLettered: real(node.deadLettered),
    dropped: real(node.dropped),
    throughput: real(node.throughput),
    lag: Object.fromEntries(Object.entries(node.lag).map(([id, n]) => [id, real(n)])),
  };
}
/** Keeps particles, time and replica counts in native units. */
export function realSnapshot(snapshot: SimSnapshot): SimSnapshot {
  const scale = resolveScale(snapshot.scale);
  return {
    ...snapshot,
    inSystem: toRealUnits(snapshot.inSystem, scale),
    nodes: Object.fromEntries(Object.entries(snapshot.nodes).map(([id, node]) => [id, realNodeMetrics(node, scale)])),
    edges: Object.fromEntries(
      Object.entries(snapshot.edges).map(([id, edge]) => [
        id,
        { ...edge, delivered: toRealUnits(edge.delivered, scale), active: toRealUnits(edge.active, scale) },
      ]),
    ),
  };
}
