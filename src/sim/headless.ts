import type { DiagramFile, Simulation } from "../model/types";
import { createSimulationRun } from "./simulation";
import type { Fault } from "../model/faults";
import type { InjectOptions, NodeSimProps, NodeStatus, SimulationRun } from "./types";
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

/** Advance to an absolute horizon, passing every narration pause, or reject an incomplete measurement. */
export function advanceHeadless(run: SimulationRun, horizon: number, sample?: () => void): void {
  for (let steps = 0; steps <= Math.ceil(horizon / 10) + 10000; steps++) {
    const state = run.state();
    if (state.done || state.time >= horizon) return;
    if (state.waiting) {
      run.resume();
      continue;
    }
    run.step(Math.min(1000, horizon - state.time));
    if (run.state().time <= state.time && !run.state().waiting)
      throw new WorkBudgetError("Headless replay did not advance");
    sample?.();
  }
  throw new WorkBudgetError("Headless replay did not reach its horizon");
}

export type ReplayControl =
  | { kind: "traffic"; on: boolean }
  | { kind: "inject"; node: string; count: number; opts?: InjectOptions }
  | { kind: "injectSources"; count: number }
  | { kind: "sendOne"; node: string; type?: string }
  | { kind: "fault"; fault: Fault }
  | { kind: "status"; node: string; status: NodeStatus }
  | { kind: "props"; node: string; patch: NodeSimProps };

/** Resolved run origin and controls, detached from playback speed and narration. */
export interface VerificationContext {
  simulation: Simulation;
  controls: { time: number; op: ReplayControl }[];
  initialTraffic: boolean;
}

/** The same control boundaries as live replay; all allocations consume the caller's shared budget. */
export function createHeadlessRun(
  d: DiagramFile,
  sim: Simulation,
  messageBudget: { remaining: number },
  context?: VerificationContext,
): SimulationRun {
  const run = createSimulationRun(d, sim, { messageBudget });
  run.setTraceActions(false);
  run.engine.setTraffic(context?.initialTraffic ?? false);
  const controls = context?.controls ?? [];
  let cursor = 0;
  const apply = () => {
    while (cursor < controls.length && controls[cursor].time <= run.state().time) {
      const op = controls[cursor++].op;
      switch (op.kind) {
        case "traffic":
          run.engine.setTraffic(op.on);
          break;
        case "fault":
          run.engine.setFault(op.fault);
          break;
        case "status":
          run.engine.setNodeStatus(op.node, op.status);
          break;
        case "props":
          run.engine.setNodeProps(op.node, op.patch);
          break;
        case "inject":
          run.inject(op.node, op.count, op.opts);
          break;
        case "sendOne":
          run.engine.inject(op.node, 1, op.type ? { type: op.type } : undefined);
          break;
        case "injectSources": {
          const flows = d.edges.filter((e) => !e.relation || e.relation === "flow");
          const fed = new Set(flows.map((e) => e.to));
          const sources = new Set(flows.map((e) => e.from));
          for (const n of d.nodes) if (sources.has(n.id) && !fed.has(n.id)) run.inject(n.id, op.count);
          break;
        }
      }
    }
  };
  const step = run.step;
  run.step = (ms) => {
    apply();
    step(Math.min(ms, controls[cursor] ? controls[cursor].time - run.state().time : Infinity));
    apply();
  };
  apply();
  return run;
}
