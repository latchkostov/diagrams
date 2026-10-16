import type { DiagramFile, Simulation } from "../model/types";
import type { AutoscalingConfig, ExecutableController } from "../model/autoscaling";
import { replicaRange } from "../model/autoscaling";
import { stencilRole } from "../stencils/roles";
import { brokerRole } from "../model/brokerRoutes";
import { createSimulationRun, estimateTotalMs } from "./simulation";
import { resolveMultiplier, resolveScale } from "./units";
import { resolveNodeProps } from "./defaults";
import type { ScalingDecision } from "./autoscaling";

// Scenario sizing (docs/SIMULATION.md § A3 planner). For each saved simulation, play it headless with the same
// engine, controllers and lifecycle as playback; watch every executable scaler; suggest the authored min or max
// that the scenario needed; then rerun with the suggestions, same seed, and keep only what the rerun bears out.
// Deterministic and bounded: a fixed number of runs, a work estimate checked before any run, simulated time capped
// at the scenario bound. Checks, agent analysis and live playback all read this one function's result.

export const PLANNER_LIMITS = {
  /** Simulated time each run plays, at most (the scenario bound). */
  horizonMs: 600_000,
  /** Runs per simulation: the scenario, then at most three reruns that verify and refine. */
  runs: 4,
  /** Simulations planned per diagram, in file order. */
  simulations: 8,
  /** Estimated engine work (ticks × elements × runs) across a diagram's plans. Over it: unavailable. */
  work: 60_000_000,
  /** Sampled messages × widest fan-out a simulation may start (as Run simulations). */
  startWork: 10_000_000,
  /** Sampling interval of the observations. */
  sampleMs: 1000,
} as const;

export type PlanAdapter = ExecutableController["kind"];
export interface PlanSuggestion {
  node: string;
  adapter: PlanAdapter;
  /** max: raise the maximum; min: keep instances warm for the burst; partitions: the input caps useful readers;
   *  quota: an admission quota binds, more instances can't help. */
  kind: "max" | "min" | "partitions" | "quota";
  /** Authored values (before Capacity ×). */
  from: number;
  to: number;
  /** What the scaler wanted at its peak (effective replicas). */
  wanted: number;
  metric?: number;
  target?: number;
  metricKind?: string;
  /** The broker whose partitions cap useful readers. */
  broker?: string;
  /** Real messages waiting at the node and its input groups: worst, while replicas were starting, at the end. */
  backlog: number;
  startupBacklog: number;
  endBacklog: number;
  /** The same-seed rerun with every suggestion applied. */
  verified?: { backlog: number; startupBacklog: number; endBacklog: number; maxed: boolean; rejected: number };
  /** One undoable fix: complete replacement policies and/or broker partitions. Absent unless a rerun verified it. */
  fix?: { node: string; props: Record<string, unknown> }[];
}
export interface ScalingPlan {
  simulation: string;
  title: string;
  traffic: number;
  horizonMs: number;
  status: "planned" | "unavailable";
  reason?: "budget" | "start" | "policy";
  suggestions: PlanSuggestion[];
  /** Operation counts: runs played and engine ticks, for bounded-work guarantees. */
  runs: number;
  ticks: number;
}

interface Observation {
  maxed: boolean;
  wanted: number;
  metric?: number;
  target?: number;
  metricKind?: string;
  partitions?: string;
  backlog: number;
  startupBacklog: number;
  endBacklog: number;
  peakDesired: number;
  rejected: number;
}
interface Watched {
  id: string;
  controller: ExecutableController;
  /** Input broker groups: [broker, group]. */
  inputs: [string, string][];
  /** Brokers whose partitions bound useful readers of this node. */
  partitioned: string[];
  /** Work one replica holds at once (its concurrency). */
  slots: number;
}

function scalers(d: DiagramFile): Watched[] {
  const nodes = new Map(d.nodes.map((n) => [n.id, n]));
  return d.nodes.flatMap((n) => {
    const p = resolveNodeProps(d, n);
    const a = p.autoscaling;
    if (!p.resources || a?.mode !== "on") return [];
    const inputs: [string, string][] = [];
    const partitioned: string[] = [];
    for (const e of d.edges) {
      const from = nodes.get(e.from);
      if (e.to !== n.id || !from || (e.relation && e.relation !== "flow") || !brokerRole(stencilRole(from.stencil)))
        continue;
      const role = stencilRole(from.stencil);
      inputs.push([from.id, role === "queue" ? "queue" : typeof e.props?.group === "string" ? e.props.group : e.id]);
      if (resolveNodeProps(d, from).broker?.partitioned) partitioned.push(from.id);
    }
    return [
      { id: n.id, controller: a.controller, inputs, partitioned: [...new Set(partitioned)], slots: p.concurrency },
    ];
  });
}
/** A simulation that sets its own policy for a node: its fix wouldn't be what playback runs. */
function ownsPolicy(sim: Simulation, node: string): boolean {
  return (
    sim.setup?.props?.[node]?.autoscaling !== undefined ||
    (sim.timeline ?? []).some(
      (s) => s.action.do === "props" && s.action.node === node && "autoscaling" in s.action.props,
    )
  );
}
function startWork(d: DiagramFile, sim: Simulation): number {
  const fanOut = new Map<string, number>();
  for (const e of d.edges) fanOut.set(e.from, (fanOut.get(e.from) ?? 0) + 1);
  const widest = Math.max(1, ...fanOut.values());
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0);
  let sent = 0;
  for (const p of sim.traffic) {
    const s = p.shape;
    sent +=
      s.kind === "burst"
        ? n(s.count)
        : s.kind === "constant"
          ? (n(s.ratePerSec) * n(s.durationMs)) / 1000
          : s.kind === "spike"
            ? (Math.max(n(s.baseRate), n(s.peakRate)) * n(s.durationMs)) / 1000
            : s.stages.reduce((sum, st) => sum + (n(st.targetRate) * n(st.durationMs)) / 1000, n(s.startRate));
  }
  for (const { action } of sim.timeline ?? []) if (action.do === "inject") sent += n(action.count);
  return ((sent * resolveMultiplier(sim.multipliers?.traffic)) / resolveScale(sim.scale)) * widest;
}

/** Plays one run and records, once per simulated second, what each watched scaler did. */
function observe(d: DiagramFile, sim: Simulation, watched: Watched[], counter: { ticks: number }) {
  const run = createSimulationRun(d, sim);
  run.setTraceActions(false);
  const engine = run.engine;
  const scale = resolveScale(sim.scale);
  const multiplier = resolveMultiplier(sim.multipliers?.capacity);
  const horizon = Math.min(estimateTotalMs(sim), PLANNER_LIMITS.horizonMs);
  const seen = new Map<string, Observation>(
    watched.map((w) => [
      w.id,
      { maxed: false, wanted: 0, backlog: 0, startupBacklog: 0, endBacklog: 0, peakDesired: 0, rejected: 0 },
    ]),
  );
  const recent = new Map(watched.map((w) => [w.id, [] as number[]]));
  // The run's own policies: a verification rerun plays the suggested ranges.
  const maxOf = new Map(scalers(d).map((x) => [x.id, replicaRange(x.controller, multiplier).max]));
  const since = new Map<string, number>(),
    fullSince = new Map<string, number>();
  const backlogOf = (w: Watched) =>
    ((engine.measure({ node: w.id, field: "backlog" }) ?? 0) +
      w.inputs.reduce(
        (sum, [broker, group]) => sum + (engine.measure({ node: broker, field: "lag", group }) ?? 0),
        0,
      )) *
    scale;
  const sample = () => {
    for (const w of watched) {
      const o = seen.get(w.id)!,
        f = engine.fleet(w.id);
      const backlog = backlogOf(w);
      // Size for demand, not catch-up: a sample counts when nothing more than the fleet's own slots waits, or
      // when the backlog grew over the last 15 s. While a backlog drains, the scaler's extra want is catch-up.
      const history = recent.get(w.id)!;
      const sustained = backlog <= (f?.ready ?? 0) * w.slots || (history.length >= 15 && backlog > history[0]);
      history.push(backlog);
      if (history.length > 15) history.shift();
      const now = engine.metrics().time;
      if (!sustained) since.delete(w.id);
      else if (!since.has(w.id)) since.set(w.id, now);
      o.backlog = Math.max(o.backlog, backlog);
      o.endBacklog = backlog;
      o.rejected = (engine.measure({ node: w.id, field: "rejected" }) ?? 0) * scale;
      if (!f) continue;
      if (f.starting > 0) o.startupBacklog = Math.max(o.startupBacklog, backlog);
      o.peakDesired = Math.max(o.peakDesired, f.desired);
      const decision: ScalingDecision | undefined = f.decision;
      const max = maxOf.get(w.id) ?? replicaRange(w.controller, multiplier).max;
      // Steady state at the maximum: every replica ready, so the metric is per replica of a full fleet.
      // …and the decision's own metric window lies inside that stretch, with the whole maximum fleet ready.
      const full = f.desired >= max && f.ready >= max && !f.starting;
      if (!full) fullSince.delete(w.id);
      else if (!fullSince.has(w.id)) fullSince.set(w.id, now);
      const from = (decision?.at ?? -Infinity) - (decision?.windowMs ?? 0);
      const steady = since.has(w.id) && fullSince.has(w.id) && from >= since.get(w.id)! && from >= fullSince.get(w.id)!;
      if (decision && steady && decision.reason !== "override") {
        // What the scaler wanted beyond its maximum: its own unclamped recommendation, or (rule and step
        // controllers, whose raw is one step) the count that brings the observed metric to its target.
        const proportional =
          decision.metric !== undefined && decision.target
            ? Math.ceil((f.ready * decision.metric) / decision.target)
            : 0;
        const wanted = Math.max(decision.raw, proportional);
        if (wanted > max && wanted >= o.wanted)
          Object.assign(o, {
            maxed: true,
            wanted,
            metric: decision.metric,
            target: decision.target,
            metricKind:
              decision.metricKind ??
              (decision.resource
                ? `${decision.resource}${decision.targetKind === "averageValue" ? (decision.resource === "cpu" ? "Milli" : "MiB") : "Request"}`
                : decision.broker
                  ? "backlog"
                  : undefined),
          });
      }
      if (decision?.reason === "partitions" && decision.broker) o.partitions = decision.broker;
    }
  };
  let time = 0;
  while (!run.state().done && time < horizon) {
    if (run.state().waiting) run.resume();
    run.step(PLANNER_LIMITS.sampleMs);
    const now = run.state().time;
    counter.ticks += Math.max(0, (now - time) / 10);
    if (now === time) break;
    time = now;
    sample();
  }
  return seen;
}

function apply(d: DiagramFile, suggestions: PlanSuggestion[]): DiagramFile {
  const fixes = new Map(suggestions.flatMap((s) => (s.fix ?? []).map((f) => [f.node, f.props] as const)));
  return {
    ...d,
    nodes: d.nodes.map((n) => (fixes.has(n.id) ? { ...n, props: { ...n.props, ...fixes.get(n.id) } } : n)),
  };
}
function withRange(a: AutoscalingConfig, key: "maxReplicas" | "minReplicas", value: number): AutoscalingConfig {
  if (a.mode !== "on") return a;
  const next = structuredClone(a);
  next.controller[key] = value;
  next.controller.maxReplicas = Math.max(next.controller.maxReplicas, next.controller.minReplicas);
  next.controller.initialReplicas = Math.max(
    next.controller.minReplicas,
    Math.min(next.controller.maxReplicas, next.controller.initialReplicas),
  );
  return next;
}

function planSimulation(d: DiagramFile, sim: Simulation, counter: { ticks: number; runs: number }): ScalingPlan {
  const horizonMs = Math.min(estimateTotalMs(sim), PLANNER_LIMITS.horizonMs);
  const base = {
    simulation: sim.id,
    title: sim.title,
    traffic: resolveMultiplier(sim.multipliers?.traffic),
    horizonMs,
    suggestions: [] as PlanSuggestion[],
  };
  const watched = scalers(d).filter((w) => !ownsPolicy(sim, w.id));
  if (!watched.length) return { ...base, status: "unavailable", reason: "policy", runs: 0, ticks: 0 };
  if (startWork(d, sim) > PLANNER_LIMITS.startWork)
    return { ...base, status: "unavailable", reason: "start", runs: 0, ticks: 0 };
  const multiplier = resolveMultiplier(sim.multipliers?.capacity);
  const local = { ticks: 0 };
  let runs = 1;
  const first = observe(d, sim, watched, local);
  const nodes = new Map(d.nodes.map((n) => [n.id, n]));
  const authored = (n: number) => Math.min(10_000, Math.max(1, Math.ceil(n / multiplier)));
  let suggestions: PlanSuggestion[] = [];
  /** More partitions, and the maximum to read them, as one fix. */
  const partitionFix = (w: Watched, a: AutoscalingConfig, broker: string, wanted: number) => {
    const partitions = Number(nodes.get(broker)?.props?.partitions ?? 1);
    const to = Math.min(10_000, Math.max(partitions + 1, wanted));
    const max = authored(to);
    return {
      kind: "partitions" as const,
      broker,
      from: partitions,
      to,
      fix: [
        { node: broker, props: { partitions: to } },
        ...(max > w.controller.maxReplicas
          ? [{ node: w.id, props: { autoscaling: withRange(a, "maxReplicas", max) } }]
          : []),
      ],
    };
  };
  for (const w of watched) {
    const o = first.get(w.id)!;
    const a = nodes.get(w.id)!.props!.autoscaling as AutoscalingConfig;
    const c = w.controller;
    const common = {
      node: w.id,
      adapter: c.kind,
      wanted: o.wanted,
      metric: o.metric,
      target: o.target,
      metricKind: o.metricKind,
      backlog: o.backlog,
      startupBacklog: o.startupBacklog,
      endBacklog: o.endBacklog,
    };
    if (o.maxed && o.partitions) suggestions.push({ ...common, ...partitionFix(w, a, o.partitions, o.wanted) });
    else if (o.maxed && c.maxReplicas < 10_000) {
      const to = Math.max(c.maxReplicas + 1, authored(o.wanted));
      suggestions.push({
        ...common,
        kind: "max",
        from: c.maxReplicas,
        to,
        fix: [{ node: w.id, props: { autoscaling: withRange(a, "maxReplicas", to) } }],
      });
    } else if (!o.maxed && o.startupBacklog > 0 && o.peakDesired > replicaRange(c, multiplier).min) {
      const to = Math.min(c.maxReplicas, authored(o.peakDesired));
      if (to > c.minReplicas)
        suggestions.push({
          ...common,
          kind: "min",
          from: c.minReplicas,
          to,
          fix: [{ node: w.id, props: { autoscaling: withRange(a, "minReplicas", to) } }],
        });
    }
  }
  // Verify (and refine) every suggestion together with the same seed. Keep only what the rerun bears out.
  while (suggestions.some((s) => s.fix && !s.verified) && runs < PLANNER_LIMITS.runs) {
    const rerun = observe(apply(d, suggestions), sim, watched, local);
    runs++;
    let refined = false;
    suggestions = suggestions.map((s) => {
      if (!s.fix || s.verified) return s;
      const after = rerun.get(s.node)!;
      const verified = {
        backlog: after.backlog,
        startupBacklog: after.startupBacklog,
        endBacklog: after.endBacklog,
        maxed: after.maxed,
        rejected: after.rejected,
      };
      const before = first.get(s.node)!;
      if (s.kind === "max" && after.maxed && after.wanted > s.wanted && runs < PLANNER_LIMITS.runs) {
        // Still at the new maximum wanting more: refine once more from the rerun's own peak.
        refined = true;
        const to = Math.max(s.to + 1, authored(after.wanted));
        const a = nodes.get(s.node)!.props!.autoscaling as AutoscalingConfig;
        return {
          ...s,
          wanted: after.wanted,
          to,
          fix: [{ node: s.node, props: { autoscaling: withRange(a, "maxReplicas", to) } }],
        };
      }
      // An admission quota that still refuses as much: more instances can't add allocation.
      if (s.kind === "max" && after.rejected > 0 && after.rejected >= before.rejected)
        return { ...s, kind: "quota" as const, verified, fix: undefined };
      // Sizing is judged on what still waits at the end; startup backlog is the minimum's concern.
      const improved =
        s.kind === "min"
          ? after.startupBacklog < before.startupBacklog
          : s.kind === "partitions" || before.endBacklog > 0
            ? after.endBacklog < before.endBacklog
            : !after.maxed;
      if (improved) return { ...s, verified };
      // Raising the maximum didn't drain the backlog: the input's partitions bound its useful readers.
      const w = watched.find((x) => x.id === s.node)!;
      if (s.kind === "max" && w.partitioned.length) {
        refined = true;
        const a = nodes.get(s.node)!.props!.autoscaling as AutoscalingConfig;
        return { ...s, ...partitionFix(w, a, w.partitioned[0], s.wanted) };
      }
      return { ...s, verified, fix: undefined };
    });
    if (!refined) break;
  }
  // A fix the runs couldn't verify is offered only as words.
  suggestions = suggestions.map((s) => (s.fix && !s.verified ? { ...s, fix: undefined } : s));
  counter.ticks += local.ticks;
  counter.runs += runs;
  return { ...base, status: "planned", suggestions, runs, ticks: local.ticks };
}

/** Estimated work of planning `d`, before allocating an engine: runs × ticks × diagram elements. */
export function planWork(d: DiagramFile): number {
  const elements = d.nodes.length + d.edges.length;
  return (d.simulations ?? [])
    .slice(0, PLANNER_LIMITS.simulations)
    .reduce(
      (sum, sim) =>
        sum + PLANNER_LIMITS.runs * (Math.min(estimateTotalMs(sim), PLANNER_LIMITS.horizonMs) / 10) * elements,
      0,
    );
}

const cache = new Map<string, ScalingPlan[]>();
/** Plans for every saved simulation with a scaler. Memoized on the diagram's simulation-relevant content. */
export function planScaling(d: DiagramFile, counter = { ticks: 0, runs: 0 }): ScalingPlan[] {
  if (d.planning?.revision !== "p3-a1" || !d.simulations?.length || !scalers(d).length) return [];
  const key = JSON.stringify([d.planning, d.nodes.map((n) => [n.id, n.stencil, n.props]), d.edges, d.simulations]);
  const hit = cache.get(key);
  if (hit) return hit;
  const sims = d.simulations.slice(0, PLANNER_LIMITS.simulations);
  const plans =
    planWork(d) > PLANNER_LIMITS.work
      ? sims.map((sim) => ({
          simulation: sim.id,
          title: sim.title,
          traffic: resolveMultiplier(sim.multipliers?.traffic),
          horizonMs: Math.min(estimateTotalMs(sim), PLANNER_LIMITS.horizonMs),
          status: "unavailable" as const,
          reason: "budget" as const,
          suggestions: [],
          runs: 0,
          ticks: 0,
        }))
      : sims.map((sim) => planSimulation(d, sim, counter));
  if (cache.size >= 4) cache.delete(cache.keys().next().value!);
  cache.set(key, plans);
  return plans;
}
