import { expectedRetries } from "./retryPolicy";
import type { RetryPolicy } from "../model/admission";
import { revisionAtLeast } from "../model/revisions";
import type { DiagramFile } from "../model/types";
import type { ResolvedProps } from "./defaults";
import { activeCall, compileTopology } from "./topology";
import { stencilRole } from "../stencils/roles";
import { resolvedTiming } from "./timing";
import { callOutcome, callPolicy, type CallPolicy } from "./callPolicy";
import type { EdgeSimProps } from "./types";

export interface WaitCapacity {
  workMs: number;
  callMs: number;
  threadHoldMs: number;
  memoryResidenceMs: number;
  replyMs?: number;
  replies?: number;
  poolCeiling?: number;
}

/** Reverse topological evaluation, O(nodes + connections), including deep graphs and cycles. */
export function waitingPlan(
  diagram: DiagramFile,
  resolved: Record<string, ResolvedProps>,
  requestRates: Readonly<Record<string, number>> = {},
) {
  const result = new Map<string, WaitCapacity>();
  const amplification = new Map<string, { policy: RetryPolicy; probability: number }>();
  if (!revisionAtLeast(diagram.planning?.revision, "p3-w1")) return { nodes: result, amplification, converged: true };
  const topology = compileTopology(diagram);
  const inputs = new Map(diagram.edges.map((e) => [e.id, e]));
  const stencils = new Map(diagram.nodes.map((n) => [n.id, n.stencil]));
  const roles = new Map(diagram.nodes.map((n) => [n.id, stencilRole(n.stencil)]));
  const delays = new Map(
    diagram.edges.map((e) => [e.id, typeof e.props?.networkDelayMs === "number" ? e.props.networkDelayMs : 0]),
  );
  const remaining = new Map<string, number>();
  const parents = new Map<
    string,
    { node: string; delay: number; endpoint?: string; policy: CallPolicy; edge: string; retry?: RetryPolicy }[]
  >();
  const callMs = new Map<string, number>();
  const response = new Map<string, number>();
  const failures = new Map<string, number>();
  const replies = new Map<string, { ms: number; count: number; pool: number }>();
  const pools = new Map<string, number>();
  const queue: string[] = [];
  for (const node of diagram.nodes) remaining.set(node.id, 0);
  for (const edge of topology.edges) {
    if (!activeCall(roles.get(edge.from)!, edge)) continue;
    remaining.set(edge.from, (remaining.get(edge.from) ?? 0) + 1);
    const list = parents.get(edge.to) ?? [];
    list.push({
      edge: edge.id,
      retry: revisionAtLeast(diagram.planning?.revision, "p3-w2")
        ? (inputs.get(edge.id)?.props?.caller as EdgeSimProps["caller"])?.retry
        : undefined,
      node: edge.from,
      delay: 2 * Math.max(0, delays.get(edge.id) ?? 0),
      endpoint: edge.endpointId,
      policy: callPolicy(stencils.get(edge.from)!, inputs.get(edge.id)?.props?.caller as EdgeSimProps["caller"]),
    });
    parents.set(edge.to, list);
  }
  for (const [id, count] of remaining) if (!count) queue.push(id);
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
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
      const outcome = callOutcome(parent.policy, endpointMs + responseMs + replyMs + parent.delay, failAt < Infinity);
      let duration = outcome.responseMs;
      let poolDuration = duration;
      if (parent.retry) {
        const retryClass = outcome.timedOut ? "timeout" : "transient";
        const p = parent.retry.retryOn.includes(retryClass)
          ? outcome.failed
            ? 1
            : (props.admission?.api.errorRate ?? props.failureRate)
          : 0;
        const expected = expectedRetries(parent.retry, p, requestRates[parent.edge] ?? Infinity);
        amplification.set(parent.edge, { policy: parent.retry, probability: p });
        poolDuration *= expected.attempts;
        duration = duration * expected.attempts + expected.backoffMs;
      }
      if (parent.policy.pool)
        pools.set(
          parent.node,
          Math.min(pools.get(parent.node) ?? Infinity, (parent.policy.pool * 1000) / Math.max(10, poolDuration)),
        );
      if (outcome.failed) failures.set(parent.node, Math.min(failures.get(parent.node) ?? Infinity, duration));
      response.set(parent.node, Math.max(response.get(parent.node) ?? 0, duration));
      if (parent.policy.blocking) callMs.set(parent.node, Math.max(callMs.get(parent.node) ?? 0, duration));
      else {
        const r = replies.get(parent.node) ?? { ms: 0, count: 0, pool: Infinity };
        if (roles.get(parent.node) === "processor") {
          r.ms += parent.policy.replyMs;
          r.count++;
        }
        if (parent.policy.pool) r.pool = Math.min(r.pool, (parent.policy.pool * 1000) / Math.max(10, poolDuration));
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
