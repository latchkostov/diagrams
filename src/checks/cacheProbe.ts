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
export const coldCacheSimulation = (diagram: DiagramFile, node: string): Simulation => ({
  ...freePlaySimulation(diagram),
  title: "Cold cache probe",
  durationMs: 20000,
  timeline: [
    { atMs: 5000, action: { do: "fault", fault: { kind: "purge", node, mode: "hard" }, drill: "cold-cache" } },
  ],
});

export interface CacheProbe {
  harmed: boolean;
  recovered: boolean;
  herdTime: number;
  hitRatio: number;
}

/** One replay per caching node serves both warnings. A refused/incomplete replay proves nothing. */
export function probeCache(
  diagram: DiagramFile,
  simulation: Simulation,
  node: string,
  origins: string[],
  work: CacheWork,
): CacheProbe | undefined {
  const horizon = simulation.durationMs!;
  const cost = threadFixWork(diagram.nodes.length, diagram.edges.length, horizon);
  if (cost > work.work || startWork(diagram, simulation) > THREAD_FIX_LIMITS.startWork) return;
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
    let harmed = false,
      recovered = false,
      herdTime = 5000,
      preP95 = 0;
    advanceHeadless(
      run,
      horizon,
      () => {
        const snapshot = realSnapshot(run.engine.snapshot());
        const p95 = Math.max(0, ...sources.map((n) => snapshot.nodes[n.id]?.latency?.p95 ?? 0));
        if (snapshot.time < 5000) {
          for (const id of origins) before.set(id, snapshot.nodes[id]?.backlog ?? 0);
          preP95 = p95;
          return;
        }
        const overloaded = origins.some((id) => {
          const state = snapshot.nodes[id];
          const slots =
            state?.threads?.slots ?? (state?.replicas ?? 1) * Number(run.engine.effectiveProps(id).concurrency ?? 4);
          return (state?.backlog ?? 0) > (before.get(id) ?? 0) + slots;
        });
        const harmedNow = origins.some((id) =>
          cacheHarmed(snapshot.nodes[id]?.backlog ?? 0, before.get(id) ?? 0, p95, preP95),
        );
        if (snapshot.time <= 15000 && harmedNow) {
          if (!harmed) herdTime = snapshot.time;
          harmed = true;
        }
        if (snapshot.time === 15000) recovered = !overloaded;
      },
      10,
    );
    if (run.state().time < horizon) return;
    const state = run.engine.snapshot().nodes[node]?.cache;
    return { harmed, recovered, herdTime, hitRatio: state?.hitRatio ?? 0 };
  } catch {
    return;
  }
}
