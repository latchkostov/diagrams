import type { NodeSimState, RealNodeMetrics, RealSimFrame, RealSimSnapshot, SimFrame, SimSnapshot } from "./types";
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
export function realNodeMetrics(node: NodeSimState, scale = 1): RealNodeMetrics {
  if ("units" in node && node.units === "real") return node as RealNodeMetrics;
  const real = (n: number) => toRealUnits(n, scale);
  return {
    ...node,
    units: "real",
    backlog: real(node.backlog),
    inFlight: real(node.inFlight),
    processed: real(node.processed),
    failed: real(node.failed),
    deadLettered: real(node.deadLettered),
    dropped: real(node.dropped),
    ...(node.outageDropped === undefined ? {} : { outageDropped: real(node.outageDropped) }),
    ...(node.blocked === undefined ? {} : { blocked: real(node.blocked) }),
    ...(node.rejected === undefined ? {} : { rejected: real(node.rejected) }),
    ...(node.rejectionReasons === undefined
      ? {}
      : {
          rejectionReasons: Object.fromEntries(
            Object.entries(node.rejectionReasons).map(([reason, count]) => [reason, real(count)]),
          ),
        }),
    throughput: real(node.throughput),
    lag: Object.fromEntries(Object.entries(node.lag).map(([id, n]) => [id, real(n)])),
  };
}
/** Keeps particles, time and replica counts in native units. Converted views are tagged and idempotent. */
export function realFrame(frame: SimFrame): RealSimFrame {
  if ("units" in frame && frame.units === "real") return frame as RealSimFrame;
  const scale = resolveScale(frame.scale);
  return {
    ...frame,
    units: "real",
    inSystem: toRealUnits(frame.inSystem, scale),
    nodes: Object.fromEntries(Object.entries(frame.nodes).map(([id, node]) => [id, realNodeMetrics(node, scale)])),
  };
}
export function realSnapshot(snapshot: SimSnapshot): RealSimSnapshot {
  if ("units" in snapshot && snapshot.units === "real") return snapshot as RealSimSnapshot;
  const scale = resolveScale(snapshot.scale);
  return {
    ...snapshot,
    ...realFrame(snapshot),
    edges: Object.fromEntries(
      Object.entries(snapshot.edges).map(([id, edge]) => [
        id,
        { ...edge, delivered: toRealUnits(edge.delivered, scale), active: toRealUnits(edge.active, scale) },
      ]),
    ),
  };
}
