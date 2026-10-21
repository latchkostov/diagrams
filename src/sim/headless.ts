import type { DiagramFile, Simulation } from "../model/types";
import { createSimulationRun } from "./simulation";
import type { SimulationRun } from "./types";
import {
  applyDue,
  dispatchReplayControl,
  untilDue,
  type ReplayTarget,
  type TimedReplayControl,
  type VerificationContext,
} from "./replayControls";
import { SIM_TICK_MS } from "./scheduler";
import { resolveMultiplier, resolveScale } from "./units";
import { WorkBudgetError } from "./engine";

/**
 * What one arrival at each node can become: itself, plus what every connection it sends a copy down becomes
 * (an upper bound: a route that picks one connection still counts them all). Fan-out compounds through every stage.
 * A connection back into the path counts nothing here: the run's message budget bounds cycles.
 */
function downstream(d: DiagramFile): (id: string) => number {
  const out = new Map<string, string[]>();
  for (const e of d.edges) {
    if (e.relation && e.relation !== "flow") continue;
    const list = out.get(e.from);
    if (list) list.push(e.to);
    else out.set(e.from, [e.to]);
  }
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  return (root) => {
    if (memo.has(root)) return memo.get(root)!;
    // Iterative post-order: a long chain never deepens the call stack.
    const stack: [string, number][] = [[root, 0]];
    visiting.add(root);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const next = out.get(top[0]) ?? [];
      if (top[1] < next.length) {
        const child = next[top[1]++];
        if (!memo.has(child) && !visiting.has(child)) {
          visiting.add(child);
          stack.push([child, 0]);
        }
      } else {
        stack.pop();
        visiting.delete(top[0]);
        let sum = 1;
        for (const child of next) sum += memo.get(child) ?? 0;
        memo.set(top[0], Math.min(sum, 1e15));
      }
    }
    return memo.get(root)!;
  };
}
export function startWork(d: DiagramFile, sim: Simulation): number {
  const reach = downstream(d);
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0);
  let sent = 0;
  for (const p of sim.traffic) {
    const s = p.shape;
    sent +=
      reach(p.node) *
      (s.kind === "burst"
        ? n(s.count)
        : s.kind === "constant"
          ? (n(s.ratePerSec) * n(s.durationMs)) / 1000
          : s.kind === "spike"
            ? (Math.max(n(s.baseRate), n(s.peakRate)) * n(s.durationMs)) / 1000
            : s.stages.reduce((sum, st) => sum + (n(st.targetRate) * n(st.durationMs)) / 1000, n(s.startRate)));
  }
  for (const { action } of sim.timeline ?? []) if (action.do === "inject") sent += reach(action.node) * n(action.count);
  return (sent * resolveMultiplier(sim.multipliers?.traffic)) / resolveScale(sim.scale);
}

export type { ReplayControl, TimedReplayControl, VerificationContext, VerificationOrigin } from "./replayControls";

/** A headless run's recorded controls still to apply, and what they act on. */
const replays = new WeakMap<
  SimulationRun,
  { controls: readonly TimedReplayControl[]; cursor: number; target: ReplayTarget }
>();

/** Applies the run's recorded controls due by now, in order; returns the ms until its next one. */
function applyRecorded(run: SimulationRun): number {
  const replay = replays.get(run);
  if (!replay) return Infinity;
  const now = run.state().time;
  replay.cursor = applyDue(replay.controls, replay.cursor, now, (entry) =>
    dispatchReplayControl(entry.op, replay.target),
  );
  return untilDue(replay.controls, replay.cursor, now);
}

/**
 * Advance to an absolute horizon (rounded up to the engine's tick), or reject an incomplete measurement. At each
 * boundary the recorded controls due apply first, in order (src/sim/replayControls.ts); a pausing note still waiting
 * after them is passed. `sample` runs once per simulated second of play, and where the run stopped at a pausing note,
 * whatever controls split the steps in between.
 */
export function advanceHeadless(run: SimulationRun, horizon: number, sample?: () => void): void {
  const end = Math.ceil(horizon / SIM_TICK_MS) * SIM_TICK_MS;
  let from = run.state().time;
  for (let steps = 0; steps <= Math.ceil(end / SIM_TICK_MS) + 10000; steps++) {
    const next = applyRecorded(run);
    const state = run.state();
    if (state.done || state.time >= end) return;
    if (state.waiting) {
      run.resume();
      continue;
    }
    const target = Math.min(from + 1000, end);
    run.step(Math.min(target - state.time, next));
    const after = run.state();
    if (after.time <= state.time && !after.waiting) throw new WorkBudgetError("Headless replay did not advance");
    if (after.time >= target || after.waiting || after.done) {
      sample?.();
      from = after.time;
    }
  }
  throw new WorkBudgetError("Headless replay did not reach its horizon");
}

/**
 * A run of `sim` that replays `context`'s controls as `advanceHeadless` reaches them: the origin's traffic switch,
 * then every recorded control at its time. Every allocation consumes the caller's shared budget.
 */
export function createHeadlessRun(
  d: DiagramFile,
  sim: Simulation,
  messageBudget: { remaining: number },
  context?: VerificationContext,
): SimulationRun {
  const run = createSimulationRun(d, sim, { messageBudget });
  run.setTraceActions(false);
  run.engine.setTraffic(context?.origin.initialTraffic ?? false);
  if (context?.controls.length)
    replays.set(run, {
      controls: context.controls,
      cursor: 0,
      target: {
        engine: run.engine,
        resume: () => run.resume(),
        inject: (node, count, opts) => run.inject(node, count, opts),
        setMultipliers: (patch) => run.setMultipliers(patch),
      },
    });
  return run;
}
