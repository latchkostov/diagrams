import type { DiagramFile, Simulation } from "../model/types";
import { advanceHeadless, createHeadlessRun, startWork } from "../sim/headless";
import { realSnapshot } from "../sim/units";
import { stencilRole } from "../stencils/roles";
import { cacheHarmed } from "../live/cacheHerd";
import { freePlaySimulation, THREAD_FIX_LIMITS, THREAD_FIX_WORK, threadFixWork } from "../live/threadFixPlan";

export type CacheWork = { work: number; messages: { remaining: number } };
export const cacheWork = (): CacheWork => ({
  work: THREAD_FIX_WORK,
  messages: { remaining: THREAD_FIX_LIMITS.messages },
});
export const coldCacheSimulation = (diagram: DiagramFile, node: string, freePlay?: () => Simulation): Simulation => ({
  ...(freePlay ? freePlay() : freePlaySimulation(diagram)),
  title: "Cold cache probe",
  durationMs: 20000,
  timeline: [
    { atMs: 5000, action: { do: "fault", fault: { kind: "purge", node, mode: "hard" }, drill: "cold-cache" } },
  ],
});

export interface CacheOriginProbe {
  harmed: boolean;
  recovered: boolean;
  herdTime: number;
}
export interface CacheProbe {
  origins: Record<string, CacheOriginProbe>;
  hitRatio: number;
}

/** One replay per caching node serves both warnings. A refused/incomplete replay proves nothing. */
export function probeCache(
  diagram: DiagramFile,
  simulation: Simulation | (() => Simulation),
  node: string,
  origins: string[],
  work: CacheWork,
  durationMs = 20000,
): CacheProbe | undefined {
  const horizon = typeof simulation === "function" ? durationMs : simulation.durationMs!;
  const cost = threadFixWork(diagram.nodes.length, diagram.edges.length, horizon);
  if (cost > work.work || work.messages.remaining <= 0) return;
  simulation = typeof simulation === "function" ? simulation() : simulation;
  if (startWork(diagram, simulation) > THREAD_FIX_LIMITS.startWork) return;
  work.work -= cost;
  try {
    const context = { revision: 0, origin: { diagram, simulation, initialTraffic: true }, controls: [] };
    const run = createHeadlessRun(diagram, simulation, work.messages, context);
    const incoming = new Map<string, string[]>();
    for (const edge of diagram.edges) {
      if (edge.relation && edge.relation !== "flow") continue;
      const list = incoming.get(edge.to) ?? [];
      list.push(edge.from);
      incoming.set(edge.to, list);
    }
    const ancestors = new Set([node]),
      queue = [node];
    for (let i = 0; i < queue.length; i++)
      for (const id of incoming.get(queue[i]) ?? [])
        if (!ancestors.has(id)) {
          ancestors.add(id);
          queue.push(id);
        }
    const sources = diagram.nodes.filter((n) => ancestors.has(n.id) && stencilRole(n.stencil) === "source");
    const before = new Map<string, number>();
    const evidence: CacheProbe["origins"] = Object.create(null);
    const preP95 = new Map<string, number>();
    for (const id of origins) evidence[id] = { harmed: false, recovered: false, herdTime: 5000 };
    advanceHeadless(
      run,
      horizon,
      () => {
        const snapshot = realSnapshot(run.engine.snapshot());
        for (const id of origins) {
          const state = snapshot.nodes[id];
          // End-to-end latency is useful for one origin; with several, another route's
          // slow replies must not count as harm at this origin.
          const p95 =
            origins.length === 1
              ? Math.max(0, ...sources.map((n) => snapshot.nodes[n.id]?.latency?.p95 ?? 0))
              : (state?.latency?.p95 ?? 0);
          if (snapshot.time < 5000) {
            before.set(id, state?.backlog ?? 0);
            preP95.set(id, p95);
            continue;
          }
          const slots =
            state?.threads?.slots ?? (state?.replicas ?? 1) * Number(run.engine.effectiveProps(id).concurrency ?? 4);
          const harmedNow = cacheHarmed(state?.backlog ?? 0, before.get(id) ?? 0, p95, preP95.get(id) ?? 0);
          const result = evidence[id];
          if (snapshot.time <= 15000 && harmedNow) {
            if (!result.harmed) result.herdTime = snapshot.time;
            result.harmed = true;
          }
          if (snapshot.time === 15000) result.recovered = (state?.backlog ?? 0) <= (before.get(id) ?? 0) + slots;
        }
      },
      10,
    );
    if (run.state().time < horizon) return;
    const state = run.engine.snapshot().nodes[node]?.cache;
    return { origins: evidence, hitRatio: state?.hitRatio ?? 0 };
  } catch {
    return;
  }
}
