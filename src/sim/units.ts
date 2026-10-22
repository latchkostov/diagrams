import type {
  EdgeSimState,
  NodeSimState,
  RealNodeMetrics,
  RealSimFrame,
  RealSimSnapshot,
  RouteCounts,
  SimFrame,
  SimSnapshot,
} from "./types";
export function resolveScale(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value >= 1 ? value : 1;
}
export function resolveMultiplier(value: number | undefined, fallback = 1): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;
}
/**
 * A dot carries `scale` real requests; a partial dot (split from one at a single instant) carries its own
 * `represented`. That is the one represented size: every admission, thread, pool and CPU sizing starts
 * from representedOf, and a counter adds unitsOf dots, so a split's parts always sum to its dot.
 */
export const representedOf = (m: { represented?: number } | undefined, scale: number): number =>
  m?.represented ?? scale;
export const unitsOf = (m: { represented?: number } | undefined, scale: number): number =>
  m?.represented === undefined ? 1 : m.represented / scale;
/** Partial dots leave roundoff in native counters; reports keep 1e-9 dots (and never -0). */
export const roundDots = (n: number): number => (Number.isInteger(n) ? n : Math.round(n * 1e9) / 1e9 || 0);
/** Per-frame copies: fixed-shape counters field by field, dictionaries in one loop. */
export function roundCounts(counts: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key in counts) out[key] = roundDots(counts[key]);
  return out;
}
export const roundCalls = (c: NonNullable<EdgeSimState["calls"]>): NonNullable<EdgeSimState["calls"]> => ({
  inFlight: roundDots(c.inFlight),
  held: roundDots(c.held),
  timedOut: roundDots(c.timedOut),
  failed: roundDots(c.failed),
  late: roundDots(c.late),
});
export const roundRoute = (c: RouteCounts): RouteCounts => ({
  sent: roundDots(c.sent),
  rejected: roundDots(c.rejected),
  completed: roundDots(c.completed),
});
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
    ...(node.threads
      ? {
          threads: {
            slots: real(node.threads.slots),
            working: real(node.threads.working),
            waiting: real(node.threads.waiting),
            queued: real(node.threads.queued),
            ...(node.threads.inFlight === undefined ? {} : { inFlight: real(node.threads.inFlight) }),
            waitingOn: node.threads.waitingOn.map(([id, count]): [string, number] => [id, real(count)]),
          },
        }
      : {}),
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
    ...(node.routeRejections === undefined
      ? {}
      : {
          routeRejections: Object.fromEntries(
            Object.entries(node.routeRejections).map(([route, count]) => [route, real(count)]),
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
    ...(frame.routes === undefined
      ? {}
      : {
          routes: Object.fromEntries(
            Object.entries(frame.routes).map(([id, c]) => [
              id,
              { sent: c.sent * scale, rejected: c.rejected * scale, completed: c.completed * scale },
            ]),
          ),
        }),
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
        {
          ...edge,
          ...(edge.calls
            ? {
                calls: Object.fromEntries(
                  Object.entries(edge.calls).map(([key, count]) => [key, toRealUnits(count, scale)]),
                ) as typeof edge.calls,
              }
            : {}),
          delivered: toRealUnits(edge.delivered, scale),
          active: toRealUnits(edge.active, scale),
        },
      ]),
    ),
  };
}
