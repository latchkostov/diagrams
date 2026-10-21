import type { DiagramFile, Simulation } from "../model/types";
import type { Trouble, TroubleAction } from "./observedTrouble";
import { planScaling } from "../sim/scalingPlanner";
import { estimateTotalMs } from "../sim/simulation";
import { realSnapshot } from "../sim/units";
import { advanceHeadless, createHeadlessRun, startWork, type VerificationContext } from "../sim/headless";
import { freePlaySimulation, emptyInputs } from "./capacityModel";
import { planDescriptor } from "../planning/scalingPlanText";

export const THREAD_FIX_LIMITS = { messages: 100_000, startWork: 1_000_000 };

export interface ThreadFixRequest {
  simulation: Simulation | null;
  context?: VerificationContext;
  trouble: Trouble;
  time: number;
}

/** Cheapest means retuning an existing scaler before adding timeout failures, then
 * changing call semantics. Ties keep planner order; every fix must win a same-seed rerun. */
export function confirmedThreadFix(d: DiagramFile, request: ThreadFixRequest): TroubleAction | undefined {
  const { trouble } = request;
  if (trouble.action.kind !== "add-timeout" && trouble.action.kind !== "free-thread") return;
  const edge = trouble.action.edge;
  const resolved: Simulation = request.context?.simulation ??
    request.simulation ?? {
      ...freePlaySimulation(d, emptyInputs()),
      seed: 7,
      durationMs: 60000,
    };
  const horizon = Math.min(60000, estimateTotalMs(resolved));
  if (request.time > horizon) return;
  const sim = { ...resolved, durationMs: horizon };
  if ((horizon / 10) * (d.nodes.length + d.edges.length) * 7 > 2_000_000) return;
  const messages = { remaining: THREAD_FIX_LIMITS.messages };
  if (startWork(d, sim) > THREAD_FIX_LIMITS.startWork) return;
  const measure = (candidate: Simulation) => {
    const run = createHeadlessRun(d, candidate, messages, request.context);
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
    const plan = planScaling({ ...d, simulations: [sim] }, { ticks: 0, runs: 0 }, messages, request.context)[0];
    if (plan?.reason === "budget" || plan?.reason === "start") return;
    const scaling = plan?.suggestions.find((s) => s.node === trouble.node && s.fix && s.verified);
    if (scaling?.fix)
      return {
        kind: "scale-threads",
        changes: scaling.fix,
        plan: planDescriptor(plan!, scaling, (id) => d.nodes.find((n) => n.id === id)?.label ?? id),
      };
    const before = measure(sim);
    if (trouble.action.kind === "add-timeout") candidates.push(trouble.action);
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
