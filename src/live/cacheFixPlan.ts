import type { Simulation } from "../model/types";
import type { CacheTable } from "../model/caching";
import { stencilRole } from "../stencils/roles";
import { simulationEdges } from "../sim/topology";
import { advanceHeadless, createHeadlessRun, startWork, type VerificationContext } from "../sim/headless";
import { estimateTotalMs } from "../sim/simulation";
import { realSnapshot } from "../sim/units";
import { coalesceRule } from "../sim/cachePresets";
import { THREAD_FIX_LIMITS, THREAD_FIX_WORK, threadFixWork } from "./threadFixPlan";
import type { TroubleAction } from "./observedTrouble";
import { herdThreshold } from "./cacheHerd";

export function cacheLadder(table: CacheTable, rule: string) {
  const policy = rule === "" ? table.default : table.rules.find((r) => r.id === rule)?.policy;
  return !policy || policy.noStore || policy.coalesce
    ? []
    : [{ step: "coalesce" as const, cache: coalesceRule(table, rule) }];
}

export interface CacheFixEvidence {
  preBacklog: number;
  preP95: number;
  threads: number;
  maxFetches: number;
  maxBacklog: number;
  maxP95: number;
  expiries: number;
  herd: boolean;
}
export function cacheRecovers(before: CacheFixEvidence, after: CacheFixEvidence): boolean {
  return (
    before.herd &&
    before.preP95 > 0 &&
    after.expiries >= 2 &&
    after.maxFetches <= 1 &&
    after.maxBacklog <= before.preBacklog + before.threads &&
    after.maxP95 <= 1.2 * before.preP95
  );
}

/** Shared evidence for the callout and future Checks/planner. A refused rerun proves nothing. */
export function confirmedCacheFix({
  context,
  node,
  rule,
  item = 1,
  edge,
  time,
  budget,
  proven,
}: {
  context: VerificationContext;
  node: string;
  rule: string;
  item?: number;
  edge?: string;
  time: number;
  budget?: { work: number; messages: { remaining: number } };
  proven?: (before: CacheFixEvidence, after: CacheFixEvidence) => void;
}): Extract<TroubleAction, { kind: "cache" }> | undefined {
  const d = context.origin.diagram,
    base = context.origin.simulation;
  const horizon = Math.min(60000, estimateTotalMs(base));
  const cost = threadFixWork(d.nodes.length, d.edges.length, horizon);
  if (time > horizon || 2 * cost > THREAD_FIX_WORK) return;
  const effective = simulationEdges(d, base);
  const table = effective.nodes.find((n) => n.id === node)?.props?.cache as CacheTable | undefined;
  if (!table) return;
  const ladder = cacheLadder(table, rule);
  if (!ladder.length) return;
  const origin = effective.edges.find((e) => e.from === node && e.kind === "sync" && (!edge || e.id === edge))?.to;
  if (!origin) return;
  const ancestors = new Set([node]);
  for (let changed = true; changed;) {
    changed = false;
    for (const edge of effective.edges)
      if (ancestors.has(edge.to) && !ancestors.has(edge.from)) {
        ancestors.add(edge.from);
        changed = true;
      }
  }
  const sources = effective.nodes.filter((n) => ancestors.has(n.id) && stencilRole(n.stencil) === "source");
  const sim = { ...base, durationMs: horizon };
  if (startWork(d, sim) > THREAD_FIX_LIMITS.startWork) return;
  const work = budget ?? { work: THREAD_FIX_WORK, messages: { remaining: THREAD_FIX_LIMITS.messages } };
  const measure = (candidate: Simulation): CacheFixEvidence | undefined => {
    if (cost > work.work) return;
    work.work -= cost;
    const run = createHeadlessRun(d, candidate, work.messages, context);
    const out: CacheFixEvidence = {
      preBacklog: 0,
      preP95: 0,
      threads: 0,
      maxFetches: 0,
      maxBacklog: 0,
      maxP95: 0,
      expiries: 0,
      herd: false,
    };
    const expiries = new Set<number>();
    let previousFlight = 0,
      lastBacklog = 0,
      lastP95 = 0,
      measured = false;
    advanceHeadless(
      run,
      horizon,
      () => {
        const s = realSnapshot(run.engine.snapshot()),
          cache = s.nodes[node],
          target = s.nodes[origin];
        const herd = cache?.cacheDetails?.herd;
        const flight = herd?.rule === rule && herd.item === item ? herd.fetches : 0;
        const p95 = Math.max(0, ...sources.map((source) => s.nodes[source.id]?.latency?.p95 ?? 0));
        if (s.time <= time && flight >= herdThreshold(s.scale) && previousFlight < herdThreshold(s.scale)) {
          out.preBacklog = lastBacklog;
          out.preP95 = lastP95;
        }
        if (s.time <= time && flight >= herdThreshold(s.scale)) out.herd = true;
        out.threads =
          target?.threads?.slots ??
          (target?.replicas ?? 1) * Number(run.engine.effectiveProps(origin).concurrency ?? 4);
        if (s.time >= time && !measured) {
          if (flight > 0 && herd!.expiredAt >= time) expiries.add(herd!.expiredAt);
          out.expiries = expiries.size;
          out.maxFetches = Math.max(out.maxFetches, flight);
          out.maxBacklog = Math.max(out.maxBacklog, target?.backlog ?? 0);
          out.maxP95 = Math.max(out.maxP95, p95);
          if (out.expiries >= 2 && previousFlight > 0 && flight === 0) measured = true;
        }
        previousFlight = flight;
        lastBacklog = target?.backlog ?? 0;
        lastP95 = p95;
      },
      10,
    );
    return run.state().time >= horizon ? out : undefined;
  };
  try {
    const before = measure(sim);
    if (!before) return;
    for (const candidate of ladder) {
      const next = structuredClone(sim);
      next.setup = {
        ...next.setup,
        props: { ...next.setup?.props, [node]: { ...next.setup?.props?.[node], cache: candidate.cache } },
      };
      const after = measure(next);
      if (!after) return;
      if (cacheRecovers(before, after)) {
        proven?.(before, after);
        return { kind: "cache", node, rule, item, edge, ...candidate };
      }
    }
  } catch {
    // Same work/message budgets as thread fixes; incomplete or refused playback offers Events.
  }
}
