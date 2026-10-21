import { revisionAtLeast } from "../model/revisions";
import type { DiagramFile } from "../model/types";
import type { ResolvedProps } from "./defaults";
import { callEligible, compileTopology } from "./topology";
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
export function waitingPlan(diagram: DiagramFile, resolved: Record<string, ResolvedProps>) {
  const result = new Map<string, WaitCapacity>();
  if (!revisionAtLeast(diagram.planning?.revision, "p3-w1")) return { nodes: result, converged: true };
  const topology = compileTopology(diagram);
  const inputs = new Map(diagram.edges.map((e) => [e.id, e]));
  const stencils = new Map(diagram.nodes.map((n) => [n.id, n.stencil]));
  const roles = new Map(diagram.nodes.map((n) => [n.id, stencilRole(n.stencil)]));
  const delays = new Map(
    diagram.edges.map((e) => [e.id, typeof e.props?.networkDelayMs === "number" ? e.props.networkDelayMs : 0]),
  );
  const remaining = new Map<string, number>();
  const parents = new Map<string, { node: string; delay: number; endpoint?: string; policy: CallPolicy }[]>();
  const callMs = new Map<string, number>();
  const response = new Map<string, number>();
  const failures = new Map<string, number>();
  const replies = new Map<string, { ms: number; count: number; pool: number }>();
  const queue: string[] = [];
  for (const node of diagram.nodes) remaining.set(node.id, 0);
  for (const edge of topology.edges) {
    if (!callEligible(roles.get(edge.from)!, edge) || edge.deny || edge.share === 0) continue;
    remaining.set(edge.from, (remaining.get(edge.from) ?? 0) + 1);
    const list = parents.get(edge.to) ?? [];
    list.push({
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
      });
    for (const parent of parents.get(id) ?? []) {
      const endpointMs = resolvedTiming(props, 0, parent.endpoint).workMs;
      const outcome = callOutcome(parent.policy, endpointMs + responseMs + replyMs + parent.delay, failAt < Infinity);
      const duration = outcome.responseMs;
      if (outcome.failed) failures.set(parent.node, Math.min(failures.get(parent.node) ?? Infinity, duration));
      response.set(parent.node, Math.max(response.get(parent.node) ?? 0, duration));
      if (parent.policy.blocking) callMs.set(parent.node, Math.max(callMs.get(parent.node) ?? 0, duration));
      else {
        const r = replies.get(parent.node) ?? { ms: 0, count: 0, pool: Infinity };
        if (roles.get(parent.node) === "processor") {
          r.ms += parent.policy.replyMs;
          r.count++;
        }
        if (parent.policy.pool) r.pool = Math.min(r.pool, (parent.policy.pool * 1000) / Math.max(10, duration));
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
  return { nodes: result, converged: queue.length === remaining.size };
}
