import type { Simulation } from "../model/types";
import type { Trouble, TroubleAction } from "./observedTrouble";
import { planScaling } from "../sim/scalingPlanner";
import { estimateTotalMs } from "../sim/simulation";
import { realSnapshot } from "../sim/units";
import { advanceHeadless, createHeadlessRun, startWork, type VerificationContext } from "../sim/headless";
import { planDescriptor } from "../planning/scalingPlanText";
import type { DiagramFile } from "../model/types";
import { STEP } from "../sim/timing";
import { emptyInputs, freePlayProps, freePlayScale } from "./playbackInputs";
import { DEFAULT_SEED } from "./storm";

export const THREAD_FIX_LIMITS = { messages: 100_000, startWork: 1_000_000 };
export const THREAD_FIX_WORK = 2_000_000;
export const threadFixWork = (nodes: number, edges: number, horizon = 60000) => (horizon / 10) * (nodes + edges) * 7;

/** Free play as Checks see it: the diagram's own rates, no faults, the default seed. */
export function freePlaySimulation(d: DiagramFile): Simulation {
  const inputs = emptyInputs();
  return {
    id: "free-play",
    title: "Free play",
    seed: DEFAULT_SEED,
    scale: freePlayScale(d, inputs),
    durationMs: 60000,
    traffic: [],
    setup: { props: freePlayProps(d, inputs) },
    multipliers: { capacity: 1 },
  };
}

/** How long a timeout's replay issues free-play traffic: thousands of calls at most rates, jitter included. */
export const TIMEOUT_REPLAY_MS = 10_000;

/**
 * Whether a timeout of `deadlineMs` on the call `edge` lets every normal reply through, by a bounded same-seed headless
 * replay of free play (the diagram's own rates, no faults) with the deadline applied. Conservative: traffic stops after
 * TIMEOUT_REPLAY_MS and the replay runs on for the deadline, so every call issued had the chance to reply or reach its
 * deadline. It certifies the timeout only if, by then, the caller has nothing left to do and no call on that connection
 * is pending, at least one reply completed, and none timed out or failed. Anything else (calls still pending, no
 * completed reply, over `budget`, refused) is inconclusive: false, so no timeout is offered. The analytic value only
 * proposes the deadline; playback's own timing (ticks, jitter, every downstream stage) decides. Checks and the live
 * callout's Add a timeout both ask this, with the same inputs, so they agree.
 */
export function timeoutKeepsReplies(...args: Parameters<typeof timeoutReplay>): boolean {
  const replay = timeoutReplay(...args);
  return !!replay && replay.settled && replay.delivered > 0 && replay.timedOut === 0 && replay.failed === 0;
}

/** Below this, a drained counter is zero: sampled occupancy leaves floating-point residue when it settles. */
const RESIDUE = 1e-6;

/**
 * What timeoutKeepsReplies judges by: the replay's outcome for that call when it ends, or undefined when it couldn't
 * run (over budget, refused). `settled`: the caller has nothing left to do and no call is pending.
 */
export function timeoutReplay(
  d: DiagramFile,
  /** The connection, or its id (then looked up: callers with many connections pass the connection). */
  call: string | { id: string; from: string },
  deadlineMs: number,
  budget: { work: number },
  /** Free play already built for `d` (freePlaySimulation), else built here once the budget allows. */
  freePlay?: () => Simulation,
  /** A message budget to share (the callout's verification shares one across all its replays). */
  messages: { remaining: number } = { remaining: THREAD_FIX_LIMITS.messages },
): { settled: boolean; delivered: number; timedOut: number; failed: number } | undefined {
  const edge = typeof call === "string" ? call : call.id;
  const caller = typeof call === "string" ? d.edges.find((e) => e.id === call)?.from : call.from;
  if (!caller) return;
  // Calls issued until traffic stops reply or reach their deadline by then (two ticks for the last to land).
  const horizon = TIMEOUT_REPLAY_MS + deadlineMs + 2 * STEP;
  const work = threadFixWork(d.nodes.length, d.edges.length, horizon);
  if (work > budget.work) return;
  budget.work -= work;
  const base = freePlay ? freePlay() : freePlaySimulation(d);
  const sim: Simulation = {
    ...base,
    durationMs: horizon,
    setup: { ...base.setup, edges: { [edge]: { caller: { deadlineMs } } } },
  };
  if (startWork(d, sim) > THREAD_FIX_LIMITS.startWork) return;
  try {
    const run = createHeadlessRun(d, sim, messages, {
      revision: 0,
      origin: { diagram: d, simulation: sim, initialTraffic: true },
      controls: [],
    });
    advanceHeadless(run, TIMEOUT_REPLAY_MS);
    run.engine.setTraffic(false);
    advanceHeadless(run, horizon);
    const state = realSnapshot(run.engine.snapshot()).edges?.[edge];
    if (!state?.calls) return;
    const drained = (n: number | undefined) => Math.abs(n ?? 0) < RESIDUE;
    return {
      settled:
        drained(state.calls.inFlight) &&
        drained(state.calls.held) &&
        drained(run.engine.measure({ node: caller, field: "backlog" })) &&
        drained(run.engine.measure({ node: caller, field: "inFlight" })),
      delivered: state.delivered,
      timedOut: state.calls.timedOut,
      failed: state.calls.failed,
    };
  } catch {
    // A refused or over-budget replay is no evidence for a timeout.
    return;
  }
}

export interface ThreadFixRequest {
  /** The live run as it played (LiveController.verificationContext): every replay starts here. */
  context: VerificationContext;
  trouble: Trouble;
  /** When the trouble was seen (simulation ms). */
  time: number;
}

/** Cheapest means retuning an existing scaler before adding timeout failures, then
 * changing call semantics. Ties keep planner order; every fix must win a same-seed rerun. */
export function confirmedThreadFix(request: ThreadFixRequest): TroubleAction | undefined {
  const { trouble, context } = request;
  if (trouble.action.kind !== "add-timeout" && trouble.action.kind !== "free-thread") return;
  const edge = trouble.action.edge;
  const d = context.origin.diagram;
  const resolved = context.origin.simulation;
  const horizon = Math.min(60000, estimateTotalMs(resolved));
  if (request.time > horizon) return;
  const sim = { ...resolved, durationMs: horizon };
  if (threadFixWork(d.nodes.length, d.edges.length, horizon) > THREAD_FIX_WORK) return;
  const messages = { remaining: THREAD_FIX_LIMITS.messages };
  if (startWork(d, sim) > THREAD_FIX_LIMITS.startWork) return;
  const measure = (candidate: Simulation) => {
    const run = createHeadlessRun(d, candidate, messages, context);
    advanceHeadless(run, horizon);
    const snapshot = realSnapshot(run.engine.snapshot());
    const n = snapshot.nodes[trouble.node];
    const waiting = n?.threads?.waiting ?? 0;
    const queued = Object.values(snapshot.nodes).reduce((sum, n) => sum + n.backlog, 0);
    const pooled = d.edges.reduce((sum, e) => sum + run.engine.queuedCalls(e.id) * (snapshot.scale ?? 1), 0);
    return { waiting, queued: queued + pooled };
  };
  try {
    const candidates: Extract<TroubleAction, { kind: "free-thread" | "add-timeout" }>[] = [];
    // The inspector's planner owns scaling advice. Reuse its exact verified policy and seed.
    const plan = planScaling({ ...d, simulations: [sim] }, { ticks: 0, runs: 0 }, messages, context)[0];
    if (plan?.reason === "budget" || plan?.reason === "start") return;
    const scaling = plan?.suggestions.find((s) => s.node === trouble.node && s.fix && s.verified);
    if (scaling?.fix)
      return {
        kind: "scale-threads",
        changes: scaling.fix,
        plan: planDescriptor(plan!, scaling, (id) => d.nodes.find((n) => n.id === id)?.label ?? id),
      };
    const before = measure(sim);
    // A timeout must first keep every normal reply (free play, the deadline applied), exactly as Checks require.
    if (
      trouble.action.kind === "add-timeout" &&
      timeoutKeepsReplies(
        d,
        { id: edge, from: trouble.node },
        trouble.action.deadlineMs,
        { work: THREAD_FIX_WORK },
        undefined,
        messages,
      )
    )
      candidates.push(trouble.action);
    candidates.push({ kind: "free-thread", edge });
    for (const action of candidates) {
      const candidate = structuredClone(sim);
      const previous = candidate.setup?.edges?.[edge];
      candidate.setup = {
        ...candidate.setup,
        edges: {
          ...candidate.setup?.edges,
          [edge]: {
            ...previous,
            caller: {
              ...previous?.caller,
              ...(action.kind === "add-timeout"
                ? { deadlineMs: action.deadlineMs }
                : { wait: "non-blocking" as const }),
            },
          },
        },
      };
      const after = measure(candidate);
      if (after.queued < before.queued && after.waiting < before.waiting) return action;
    }
  } catch {
    // A refused or over-budget rerun is no evidence for a fix.
  }
  return;
}
