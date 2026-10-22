// Same-arrivals references for simulation goldens (docs/PARITY.md, "Sampling 8a-pre"). Test-only: never shipped.
//
// A golden plays a saved simulation (or 60 s of free play) at its dot scale N, as the live view does. Its same-arrivals
// reference is the same run at scale 1 with the sampled arrival instants: every dot a source or injection emits arrives
// as floor-cumulative real requests (EngineOptions.sameArrivals), as src/test/scaleEquivalence.ts does for its
// harness-driven fixtures. Both runs are compared by their final real counters, I1's quantities.

import { emptyInputs, freePlayProps, freePlayScale } from "../live/capacityModel";
import { TRACE_HISTORY } from "../live/controller";
import { DEFAULT_SEED } from "../live/storm";
import type { DiagramFile, Simulation } from "../model/types";
import { createEngine } from "../sim/engine";
import { autoScale } from "../sim/scale";
import { createSimulationRun } from "../sim/simulation";
import type { NodeSimProps, RealNodeMetrics } from "../sim/types";
import { realSnapshot } from "../sim/units";

export const FINAL_COUNTERS = ["processed", "failed", "dropped", "rejected", "deadLettered", "blocked"] as const;
export type FinalCounters = Record<string, Record<(typeof FINAL_COUNTERS)[number], number>>;

const FREE_PLAY_MS = 60_000;
const MAX_RUN_MS = 600_000;

function finals(nodes: Record<string, RealNodeMetrics>): FinalCounters {
  return Object.fromEntries(
    Object.entries(nodes).map(([id, node]) => [
      id,
      Object.fromEntries(
        FINAL_COUNTERS.map((key) => [key, (node[key] as number | undefined) ?? 0]),
      ) as FinalCounters[string],
    ]),
  );
}

/**
 * Plays a saved simulation to its end, or free play for 60 s, as the live view does (seed, dot scale and free-play
 * inputs), and returns its final real counters and dot scale. With `sameArrivals`, the run is its scale-1 reference.
 */
export function playFinal(
  diagram: DiagramFile,
  simulation: Simulation | null,
  { sameArrivals = false }: { sameArrivals?: boolean } = {},
): { atMs: number; scale: number; nodes: FinalCounters } {
  const engineOpts = { traceHistory: TRACE_HISTORY, ...(sameArrivals ? { sameArrivals: true as const } : {}) };
  if (simulation) {
    const sim = simulation.scale === undefined ? { ...simulation, scale: autoScale(simulation, diagram) } : simulation;
    const run = createSimulationRun(diagram, sim, { ...engineOpts, seed: DEFAULT_SEED });
    while (!run.state().done) {
      if (run.engine.metrics().time >= MAX_RUN_MS) throw new Error(`still running after ${MAX_RUN_MS} ms`);
      if (run.state().waiting) run.resume();
      run.step(10);
    }
    return {
      atMs: run.engine.metrics().time,
      scale: sim.scale!,
      nodes: finals(realSnapshot(run.engine.snapshot()).nodes),
    };
  }
  const engine = createEngine({ ...engineOpts, seed: DEFAULT_SEED });
  engine.load(diagram);
  const scale = freePlayScale(diagram, emptyInputs());
  engine.setScale(scale);
  engine.setNodePropsBatch(freePlayProps(diagram, emptyInputs()) as Record<string, NodeSimProps>, 1);
  engine.setTraffic(true);
  while (engine.metrics().time < FREE_PLAY_MS) engine.step(10);
  return { atMs: engine.metrics().time, scale, nodes: finals(realSnapshot(engine.snapshot()).nodes) };
}

/** Nodes whose counts follow a random draw: downstream of a connection that takes a `share` of what passes. */
export function shareSampled(diagram: DiagramFile): Set<string> {
  const out = new Set<string>();
  const next = (id: string) => diagram.edges.filter((e) => e.from === id).map((e) => e.to);
  const stack = diagram.edges
    .filter((e) => {
      const share = (e.props as { share?: number } | undefined)?.share;
      return share !== undefined && share > 0 && share < 1;
    })
    .map((e) => e.to);
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...next(id));
  }
  return out;
}

export interface Direction {
  /** Σ |final − reference| over every node and counter, master and branch, in real requests. */
  master: number;
  branch: number;
  /** Counters more than one dot (N real) further from the reference than master: away, unless share-sampled. */
  away: string[];
  noise: string[];
  /** toward: closer in total; within a dot: no counter more than one dot further; noise: only share-sampled ones. */
  verdict: "toward" | "within a dot" | "noise" | "away";
}

/** The owner's rule (2026-10-22): away means more than one dot further from scale 1 than master; share counts are noise. */
export function direction(
  diagram: DiagramFile,
  scale: number,
  master: FinalCounters,
  branch: FinalCounters,
  reference: FinalCounters,
): Direction {
  const sampled = shareSampled(diagram);
  let m = 0,
    b = 0;
  const away: string[] = [],
    noise: string[] = [];
  for (const [id, counters] of Object.entries(reference))
    for (const key of FINAL_COUNTERS) {
      const dm = Math.abs((master[id]?.[key] ?? 0) - counters[key]);
      const db = Math.abs((branch[id]?.[key] ?? 0) - counters[key]);
      m += dm;
      b += db;
      if (db > dm + scale + 1e-6) (sampled.has(id) ? noise : away).push(`${id}.${key}`);
    }
  m = Math.round(m * 100) / 100;
  b = Math.round(b * 100) / 100;
  return {
    master: m,
    branch: b,
    away,
    noise,
    verdict: away.length ? "away" : noise.length ? "noise" : b < m - 1e-6 ? "toward" : "within a dot",
  };
}
