import { resolveApiBehaviour } from "./admissionPolicy";
import { cacheEnabled } from "../model/caching";
import { classifyOutcome, expectedRetries } from "./retryPolicy";
import type { RetryPolicy } from "../model/admission";
import { revisionAtLeast } from "../model/revisions";
import type { DiagramFile } from "../model/types";
import type { ResolvedProps } from "./defaults";
import { activeCall, compileTopology } from "./topology";
import { stencilRole } from "../stencils/roles";
import { resolvedTiming } from "./timing";
import { callOutcome, callPolicy, type CallPolicy } from "./callPolicy";
import type { EdgeSimProps } from "./types";
import { onMiss } from "../model/cacheAside";

export interface WaitCapacity {
  workMs: number;
  callMs: number;
  threadHoldMs: number;
  memoryResidenceMs: number;
  replyMs?: number;
  replies?: number;
  poolCeiling?: number;
}

/** Rate-independent graph metadata, shared by every retry-budget solver pass. */
export function compileWaitingPlan(diagram: DiagramFile, topology = compileTopology(diagram)) {
  const inputs = new Map(diagram.edges.map((e) => [e.id, e]));
  const stencils = new Map(diagram.nodes.map((n) => [n.id, n.stencil]));
  const roles = new Map(diagram.nodes.map((n) => [n.id, stencilRole(n.stencil)]));
  const caching = new Set(
    diagram.nodes
      .filter((n) => cacheEnabled(diagram.planning, n.stencil, roles.get(n.id)!, n.props?.cache))
      .map((n) => n.id),
  );
  const remaining = new Map<string, number>();
  const parents = new Map<
    string,
    {
      node: string;
      delay: number;
      endpoint?: string;
      policy: CallPolicy;
      edge: string;
      retry?: RetryPolicy;
      onMiss?: string;
    }[]
  >();
  for (const node of diagram.nodes) remaining.set(node.id, 0);
  for (const edge of topology.edges) {
    if (!activeCall(roles.get(edge.from)!, edge, caching.has(edge.from))) continue;
    const props = inputs.get(edge.id)?.props;
    const caller = props?.caller as EdgeSimProps["caller"];
    const delay = typeof props?.networkDelayMs === "number" ? props.networkDelayMs : 0;
    remaining.set(edge.from, (remaining.get(edge.from) ?? 0) + 1);
    const list = parents.get(edge.to) ?? [];
    list.push({
      edge: edge.id,
      onMiss:
        revisionAtLeast(diagram.planning?.revision, "p3-w3") &&
        caching.has(inputs.get(onMiss(inputs.get(edge.id)!) ?? "")?.to ?? "")
          ? onMiss(inputs.get(edge.id)!)
          : undefined,
      retry: revisionAtLeast(diagram.planning?.revision, "p3-w2") ? caller?.retry : undefined,
      node: edge.from,
      delay: 2 * Math.max(0, delay),
      endpoint: edge.endpointId,
      policy: callPolicy(stencils.get(edge.from)!, caller),
    });
    parents.set(edge.to, list);
  }
  const lookups = new Set([...parents.values()].flatMap((list) => list.flatMap((p) => (p.onMiss ? [p.onMiss] : []))));
  return { remaining, parents, roles, lookups };
}

/** Reverse topological evaluation, O(nodes + connections), including deep graphs and cycles. */
export function waitingPlan(
  diagram: DiagramFile,
  resolved: Record<string, ResolvedProps>,
  requestRates: Readonly<Record<string, number>> = {},
  graph = compileWaitingPlan(diagram),
  missShares: Readonly<Record<string, number>> = {},
  fetchShares: Readonly<Record<string, number>> = missShares,
) {
  const result = new Map<string, WaitCapacity>();
  const amplification = new Map<string, { policy: RetryPolicy; probability: number }>();
  if (!revisionAtLeast(diagram.planning?.revision, "p3-w1")) return { nodes: result, amplification, converged: true };
  const { parents, roles } = graph;
  const remaining = new Map(graph.remaining);
  const callMs = new Map<string, number>();
  const response = new Map<string, number>();
  const failures = new Map<string, number>();
  const replies = new Map<string, { ms: number; count: number; pool: number }>();
  const pools = new Map<string, number>();
  const edgeResponses = new Map<string, number>();
  const deferred = new Map<string, { lookup: string; duration: number; blocking: boolean; share: number }[]>();
  const queue: string[] = [];
  for (const [id, count] of remaining) if (!count) queue.push(id);
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    for (const branch of deferred.get(id) ?? []) {
      const duration = (edgeResponses.get(branch.lookup) ?? 0) + branch.share * branch.duration;
      response.set(id, Math.max(response.get(id) ?? 0, duration));
      if (branch.blocking) callMs.set(id, Math.max(callMs.get(id) ?? 0, duration));
    }
    const props = resolved[id];
    const { workMs } = resolvedTiming(props);
    const reply = replies.get(id);
    // Playback executes a combined continuation on its 10 ms clock.
    const replyMs = reply ? Math.ceil(reply.ms / 10) * 10 : 0;
    const failAt = failures.get(id) ?? Infinity;
    const responseMs = Math.min(response.get(id) ?? 0, failAt);
    const waiting = Math.min(callMs.get(id) ?? 0, failAt) + replyMs;
    const threadHoldMs = workMs + waiting;
    const memoryResidenceMs = workMs + responseMs + replyMs;
    if (waiting > 0 || response.has(id))
      result.set(id, {
        workMs,
        callMs: waiting,
        threadHoldMs,
        memoryResidenceMs,
        ...(reply
          ? { replyMs, replies: reply.count, ...(reply.pool < Infinity ? { poolCeiling: reply.pool } : {}) }
          : {}),
        ...(pools.has(id) ? { poolCeiling: pools.get(id) } : {}),
      });
    for (const parent of parents.get(id) ?? []) {
      const endpointMs = resolvedTiming(props, 0, parent.endpoint).workMs;
      const localLookup = graph.lookups.has(parent.edge);
      const outcome = callOutcome(
        parent.policy,
        endpointMs + (localLookup ? 0 : responseMs + replyMs) + parent.delay,
        !localLookup && failAt < Infinity,
      );
      let duration = outcome.responseMs;
      let poolDuration = duration;
      if (parent.retry) {
        const retryClass = classifyOutcome(outcome.timedOut ? "deadline" : "error").class!;
        const p = parent.retry.retryOn.includes(retryClass)
          ? outcome.failed
            ? 1
            : ((props.admission
                ? resolveApiBehaviour(
                    props.admission.api,
                    props.admission.endpoints.find((endpoint) => endpoint.id === parent.endpoint),
                  ).errorRate
                : undefined) ?? props.failureRate)
          : 0;
        const expected = expectedRetries(parent.retry, p, requestRates[parent.edge] ?? Infinity);
        amplification.set(parent.edge, { policy: parent.retry, probability: p });
        poolDuration *= expected.attempts;
        duration = duration * expected.attempts + expected.backoffMs;
      }
      const share = parent.onMiss ? (missShares[parent.edge] ?? 1) : 1;
      const poolShare = parent.onMiss ? (fetchShares[parent.edge] ?? share) : 1;
      if (parent.policy.pool)
        pools.set(
          parent.node,
          Math.min(
            pools.get(parent.node) ?? Infinity,
            (parent.policy.pool * 1000) / Math.max(1e-9, Math.max(10, poolDuration) * poolShare),
          ),
        );
      if (outcome.failed) failures.set(parent.node, Math.min(failures.get(parent.node) ?? Infinity, duration));
      edgeResponses.set(parent.edge, duration);
      if (parent.onMiss) {
        const branches = deferred.get(parent.node) ?? [];
        branches.push({ lookup: parent.onMiss, duration, blocking: parent.policy.blocking, share });
        deferred.set(parent.node, branches);
      } else {
        response.set(parent.node, Math.max(response.get(parent.node) ?? 0, duration));
        if (parent.policy.blocking) callMs.set(parent.node, Math.max(callMs.get(parent.node) ?? 0, duration));
      }
      if (!parent.policy.blocking) {
        const r = replies.get(parent.node) ?? { ms: 0, count: 0, pool: Infinity };
        if (roles.get(parent.node) === "processor") {
          r.ms += parent.policy.replyMs * share;
          r.count += share;
        }
        if (parent.policy.pool)
          r.pool = Math.min(
            r.pool,
            (parent.policy.pool * 1000) / Math.max(1e-9, Math.max(10, poolDuration) * poolShare),
          );
        replies.set(parent.node, r);
      }
      const count = remaining.get(parent.node)! - 1;
      remaining.set(parent.node, count);
      if (!count) queue.push(parent.node);
    }
  }
  for (const [id, count] of remaining)
    if (count)
      result.set(id, {
        workMs: resolved[id].latencyMs,
        callMs: Infinity,
        threadHoldMs: Infinity,
        memoryResidenceMs: Infinity,
      });
  return { nodes: result, amplification, converged: queue.length === remaining.size };
}
