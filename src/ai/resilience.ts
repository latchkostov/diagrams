import type { DiagramEdge, DiagramFile } from "../model/types";
import type { CapacityAnalysis } from "../sim/capacity";
import type { CompiledTopology } from "../sim/topology";
import type { EdgeSimProps } from "../sim/types";
import { revisionAtLeast } from "../model/revisions";
import { stencilRole } from "../stencils/roles";
import { retryIdempotency } from "../sim/resiliencePresets";
import { compileWaitingPlan, waitingPlan } from "../sim/waitingPlan";
import { expectedRetries } from "../sim/retryPolicy";
import { BREAKER_DEFAULTS } from "../sim/breaker";

/** Both describe formats use the same executed policy and steady-state solver as capacity planning. */
export function describeResilience(d: DiagramFile, topology: CompiledTopology, analysis?: CapacityAnalysis) {
  const enabled = revisionAtLeast(d.planning?.revision, "p3-w2");
  const methods = new Map(d.planning?.requestRoutes?.map((r) => [r.id, r.address.method]));
  const amplification =
    enabled && analysis
      ? waitingPlan(d, analysis.resolved, analysis.connections, compileWaitingPlan(d, topology)).amplification
      : undefined;
  const roles = new Map(d.nodes.map((n) => [n.id, stencilRole(n.stencil)]));
  const nodes = new Map(d.nodes.map((n) => [n.id, n]));
  return {
    connection(e: DiagramEdge) {
      if (!enabled || e.kind !== "sync" || (e.relation && e.relation !== "flow")) return;
      const caller = e.props?.caller as EdgeSimProps["caller"],
        retry = caller?.retry;
      const expected = amplification?.get(e.id);
      return {
        attempts: Math.min(10, retry?.maxAttempts ?? 1),
        backoff: {
          baseMs: retry?.backoffMs ?? 0,
          growth: retry?.strategy === "exponential" ? 2 : 1,
          capMs: retry?.maxBackoffMs ?? Math.min(600000, 20 * (retry?.backoffMs ?? 0)),
          jitter: retry?.jitter ?? 0,
        },
        retryOn: retry?.retryOn ?? [],
        idempotent: retryIdempotency(retry, methods.get(String(e.props?.requestRouteId ?? ""))),
        budget: retry?.budget ?? null,
        breaker: caller?.breaker ? { ...BREAKER_DEFAULTS, ...caller.breaker } : null,
        priority: e.props?.priority ?? "normal",
        amplification: {
          steady: expected
            ? expectedRetries(expected.policy, expected.probability, analysis?.connections[e.id]).attempts
            : retry && !analysis
              ? null
              : 1,
          worst: Math.min(10, retry?.maxAttempts ?? 1),
        },
      };
    },
    processor(id: string) {
      if (!enabled || roles.get(id) !== "processor") return;
      const queue =
        analysis?.resolved[id].queue ?? (nodes.get(id)?.props?.queue as import("../sim/types").QueuePolicy | undefined);
      const capacity = analysis?.nodes[id].capacity;
      const ceiling = Math.min(
        queue?.maxWaitMs ?? Infinity,
        queue?.limit !== undefined && capacity && capacity > 0 ? (queue.limit / capacity) * 1000 : Infinity,
      );
      return {
        limit: queue?.limit ?? null,
        order: queue?.order ?? "fifo",
        whenFull: queue?.whenFull ?? "reject-new",
        maxWaitMs: queue?.maxWaitMs ?? null,
        waitCeilingMs: Number.isFinite(ceiling) ? ceiling : null,
      };
    },
  };
}
