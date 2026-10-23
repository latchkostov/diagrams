import type { Simulation } from "../model/types";
import type { EdgeSimProps } from "../sim/types";
import { advanceHeadless, createHeadlessRun, startWork, type VerificationContext } from "../sim/headless";
import { simulationEdges } from "../sim/simulationEdges";
import { estimateTotalMs } from "../sim/simulation";
import { realSnapshot } from "../sim/units";
import { recoveryPath, recoveryFault } from "../sim/recoveryEvidence";
import { RECOMMENDED_RETRY } from "../sim/resiliencePresets";
import { THREAD_FIX_LIMITS, THREAD_FIX_WORK, threadFixWork } from "./threadFixPlan";
import type { TroubleAction } from "./observedTrouble";

export type ResilienceStep = "jitter" | "budget" | "breaker" | "attempts";
export type ResilienceFix = Extract<TroubleAction, { kind: "resilience" }>;

/** Cumulative, cheapest first. Preserve the call's outcome and idempotency choices. */
export function resilienceLadder(
  caller: NonNullable<EdgeSimProps["caller"]>,
): { step: ResilienceStep; caller: NonNullable<EdgeSimProps["caller"]> }[] {
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
    { step: "attempts", caller: { ...breaker, retry: { ...breaker.retry, maxAttempts: 2 } } },
  ];
}

export interface RecoveryPoint {
  time: number;
  goodput: number;
  backlog: number;
  amplification: number;
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
}: {
  context: VerificationContext;
  edge: string;
  time: number;
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
  const messages = { remaining: THREAD_FIX_LIMITS.messages };
  const measure = (candidate: Simulation): RecoveryEvidence | undefined => {
    const run = createHeadlessRun(d, candidate, messages, context);
    const points: RecoveryPoint[] = [],
      history: { time: number; processed: number; backlog: number }[] = [{ time: 0, processed: 0, backlog: 0 }];
    let clear = -1,
      preGoodput = 0,
      preBacklog = 0,
      threads = 0,
      wasFault = false,
      integral = 0;
    advanceHeadless(run, horizon, () => {
      const snapshot = realSnapshot(run.engine.snapshot()),
        now = snapshot.time;
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
      });
      history.push({ time: now, processed, backlog });
    });
    if (run.state().time < horizon || clear < 0 || wasFault) return;
    return { clear, preGoodput, preBacklog, threads, integral, points };
  };
  try {
    const before = measure(sim);
    if (!before) return;
    for (const candidate of resilienceLadder(caller)) {
      const next = structuredClone(sim);
      next.setup = { ...next.setup, edges: { ...next.setup?.edges, [edge]: { caller: candidate.caller } } };
      const after = measure(next);
      if (!after) return;
      if (recovers(before, after)) return { kind: "resilience", edge, ...candidate };
    }
  } catch {
    // Refused, incomplete or over-budget reruns provide no evidence. Never fall back to an unverified edit.
  }
}
