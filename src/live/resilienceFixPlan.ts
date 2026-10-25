import type { Simulation } from "../model/types";
import { stencilRole } from "../stencils/roles";
import { analyzeCapacity } from "../sim/capacity";
import { waitingPlan } from "../sim/waitingPlan";
import { requestResponseMs } from "../sim/timing";
import type { EdgeSimProps, QueuePolicy } from "../sim/types";
import { advanceHeadless, createHeadlessRun, startWork, type VerificationContext } from "../sim/headless";
import { simulationEdges } from "../sim/topology";
import { estimateTotalMs } from "../sim/simulation";
import { realSnapshot } from "../sim/units";
import { recoveryPath, recoveryFault } from "../sim/recoveryEvidence";
import { RECOMMENDED_RETRY, recommendedQueue } from "../sim/resiliencePresets";
import { THREAD_FIX_LIMITS, THREAD_FIX_WORK, threadFixWork } from "./threadFixPlan";
import type { TroubleAction } from "./observedTrouble";
import { HealthWindow, currentHealth } from "./healthWindow";

export type ResilienceStep = "jitter" | "budget" | "breaker" | "shedding" | "attempts";
export type ResilienceFix = Extract<TroubleAction, { kind: "resilience" }>;

/** Cumulative, cheapest first. Preserve the call's outcome and idempotency choices. */
export function resilienceLadder(
  caller: NonNullable<EdgeSimProps["caller"]>,
  queue?: { node: string; policy: QueuePolicy },
): {
  step: ResilienceStep;
  caller: NonNullable<EdgeSimProps["caller"]>;
  queue?: { node: string; policy: QueuePolicy };
}[] {
  if (!caller.retry || caller.retry.maxAttempts < 2) return [];
  const jitter = {
    ...caller,
    retry: {
      ...caller.retry,
      backoffMs: RECOMMENDED_RETRY.backoffMs,
      strategy: RECOMMENDED_RETRY.strategy,
      maxBackoffMs: RECOMMENDED_RETRY.maxBackoffMs,
      jitter: RECOMMENDED_RETRY.jitter,
    },
  };
  const budget = { ...jitter, retry: { ...jitter.retry, budget: { ...RECOMMENDED_RETRY.budget! } } };
  const breaker = { ...budget, breaker: caller.breaker ?? {} };
  return [
    { step: "jitter", caller: jitter },
    { step: "budget", caller: budget },
    { step: "breaker", caller: breaker },
    ...(queue ? [{ step: "shedding" as const, caller: breaker, queue }] : []),
    {
      step: "attempts",
      caller: { ...breaker, retry: { ...breaker.retry, maxAttempts: 2 } },
      ...(queue ? { queue } : {}),
    },
  ];
}

export interface RecoveryPoint {
  time: number;
  goodput: number;
  backlog: number;
  amplification: number;
  storm?: boolean;
}
export interface RecoveryEvidence {
  clear: number;
  preGoodput: number;
  preBacklog: number;
  threads: number;
  integral: number;
  points: RecoveryPoint[];
}
/** A completed same-seed replay must win on recovery AND successful work after the fault. */
export function recovers(before: RecoveryEvidence, after: RecoveryEvidence): boolean {
  return (
    before.preGoodput > 0 &&
    after.integral > 0 &&
    after.integral >= 1.2 * before.integral &&
    after.points.some(
      (p) =>
        p.time >= before.clear &&
        p.time <= before.clear + 10000 &&
        p.goodput >= 0.9 * before.preGoodput &&
        p.backlog <= before.preBacklog + before.threads &&
        p.amplification <= 1.5,
    )
  );
}

export function confirmedResilienceFix({
  context,
  edge,
  time,
  baseline,
  proven,
  budget,
}: {
  context: VerificationContext;
  edge: string;
  time: number;
  baseline?: (evidence: RecoveryEvidence) => boolean;
  proven?: (before: RecoveryEvidence, after: RecoveryEvidence, step: ResilienceStep) => void;
  budget?: { work: number; messages: { remaining: number } };
}): ResilienceFix | undefined {
  const d = context.origin.diagram,
    base = context.origin.simulation;
  const horizon = Math.min(60000, estimateTotalMs(base));
  // Refuse before indexing topology or traversing any ancestor.
  if (time > horizon || threadFixWork(d.nodes.length, d.edges.length, horizon) * 5 > THREAD_FIX_WORK) return;
  const effective = simulationEdges(d, base),
    connection = effective.edges.find((e) => e.id === edge);
  if (!connection) return;
  const caller = connection.props?.caller as EdgeSimProps["caller"];
  if (!caller) return;
  const path = recoveryPath(d, connection);
  if (!path) return;
  const sim = { ...base, durationMs: horizon };
  if (startWork(d, sim) > THREAD_FIX_LIMITS.startWork) return;
  const messages = budget?.messages ?? { remaining: THREAD_FIX_LIMITS.messages };
  const replayCost = threadFixWork(d.nodes.length, d.edges.length, horizon);
  const work = budget ?? { work: THREAD_FIX_WORK };
  const measure = (candidate: Simulation): RecoveryEvidence | undefined => {
    if (replayCost > work.work) return;
    work.work -= replayCost;
    const run = createHeadlessRun(d, candidate, messages, context);
    const points: RecoveryPoint[] = [],
      history: { time: number; processed: number; backlog: number }[] = [{ time: 0, processed: 0, backlog: 0 }];
    let clear = -1,
      preGoodput = 0,
      preBacklog = 0,
      threads = 0,
      wasFault = false,
      integral = 0;
    const health = new HealthWindow();
    advanceHeadless(run, horizon, () => {
      const snapshot = realSnapshot(run.engine.snapshot()),
        now = snapshot.time;
      health.observe(snapshot, run);
      const fault = recoveryFault(snapshot, path);
      const node = snapshot.nodes[connection.to],
        processed = snapshot.edges[edge]?.calls?.succeeded ?? 0;
      const previous = [...history].reverse().find((p) => p.time <= now - 2000);
      const goodput = previous ? ((processed - previous.processed) * 1000) / (now - previous.time) : 0;
      const backlog = node?.backlog ?? 0;
      if (fault && !wasFault) {
        preGoodput = goodput;
        preBacklog = backlog;
        integral = 0;
        clear = -1;
      }
      if (!fault && wasFault) {
        clear = now;
        integral = 0;
      }
      if (!fault && clear >= 0) integral += processed - history.at(-1)!.processed;
      wasFault = fault;
      threads =
        node?.threads?.slots ??
        (node?.replicas ?? 1) * Number(run.engine.effectiveProps(connection.to).concurrency ?? 4);
      const calls = snapshot.edges[edge]?.calls;
      points.push({
        time: now,
        goodput,
        backlog,
        amplification: calls?.windowRequests ? calls.windowAttempts! / calls.windowRequests : 1,
        storm:
          !!calls &&
          (calls.windowRequests ?? 0) > 0 &&
          (calls.windowAttempts ?? 0) / calls.windowRequests! >= 2 &&
          currentHealth(calls).failed > (calls.windowAttempts ?? 0) / 2 &&
          (currentHealth(node).growing || (clear >= 0 && currentHealth(calls).succeeded < calls.windowRequests! / 2)),
      });
      history.push({ time: now, processed, backlog });
    });
    if (run.state().time < horizon || clear < 0 || wasFault) return;
    return { clear, preGoodput, preBacklog, threads, integral, points };
  };
  try {
    const before = measure(sim);
    if (!before) return;
    if (baseline?.(before) === false) return;
    const target = effective.nodes.find((n) => n.id === connection.to);
    const analysis = target && stencilRole(target.stencil) === "processor" ? analyzeCapacity(d, base) : undefined;
    const props = analysis?.resolved[connection.to];
    const wait = analysis && waitingPlan(effective, analysis.resolved).nodes.get(connection.to);
    const policy =
      props && analysis && !props.admission
        ? recommendedQueue(
            caller.deadlineMs ?? undefined,
            requestResponseMs(
              props,
              wait,
              typeof connection.props?.endpointId === "string" ? connection.props.endpointId : undefined,
              Number(connection.props?.networkDelayMs ?? 0),
            ),
            analysis.nodes[connection.to].activeReplicas * props.concurrency,
            analysis.nodes[connection.to].capacity,
          )
        : undefined;
    for (const candidate of resilienceLadder(
      caller,
      target && props && policy && stencilRole(target.stencil) === "processor"
        ? { node: target.id, policy }
        : undefined,
    )) {
      const next = structuredClone(sim);
      next.setup = { ...next.setup, edges: { ...next.setup?.edges, [edge]: { caller: candidate.caller } } };
      if (candidate.queue)
        next.setup.props = {
          ...next.setup.props,
          [candidate.queue.node]: { ...next.setup.props?.[candidate.queue.node], queue: candidate.queue.policy },
        };
      const after = measure(next);
      if (!after) return;
      if (recovers(before, after)) {
        proven?.(before, after, candidate.step);
        return { kind: "resilience", edge, ...candidate };
      }
    }
  } catch {
    // Refused, incomplete or over-budget reruns provide no evidence. Never fall back to an unverified edit.
  }
}
