import { revisionAtLeast } from "../model/revisions";
import type { DiagramEdge, DiagramFile, Simulation } from "../model/types";
import type { AutoscalingConfig, ExecutableController } from "../model/autoscaling";
import { replicaRange } from "../model/autoscaling";
import { stencilRole } from "../stencils/roles";
import { brokerRole } from "../model/brokerRoutes";
import { createSimulationRun, estimateTotalMs } from "./simulation";
import { FaultTimelineError } from "../model/faultRuntime";
import { resolveMultiplier, resolveScale } from "./units";
import { resolveNodeProps } from "./defaults";
import type { ScalingDecision } from "./autoscaling";
import { WorkBudgetError } from "./engine";
import { LifecycleBudgetError, resourceBudgetExceeded } from "../model/resourceBudget";
import { simulationContent } from "./simulationContent";
import { offThreadPlans } from "../lib/scenarioPlanner";

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
  /** Sampled messages a simulation may start, each times what one arrival can become downstream (every copy). */
  startWork: 10_000_000,
  /** Sampled messages (sent and copied) every run of one diagram's plans may create together (a few seconds of work;
   *  eight times the busiest frozen plan). Over it: unavailable. */
  messages: 1_000_000,
  /** Sampling interval of the observations. */
  sampleMs: 1000,
} as const;

export type PlanAdapter = ExecutableController["kind"];
export interface PlanSuggestion {
  node: string;
  adapter: PlanAdapter;
  /** max: raise the maximum; min: keep instances warm for the burst; partitions: the input caps useful readers;
   *  quota: an admission quota binds, more instances can't help; target: the backlog grew while the scaler's metric
   *  stayed under its target, so lower the target. */
  kind: "max" | "min" | "partitions" | "quota" | "target" | "busyThreads";
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
  processed: number;
  /** The scaler's own desired count when the startup backlog peaked. */
  startupDesired?: number;
  /** The simulation's backlog goals about this node or its inputs that failed. */
  goalsFailed: string[];
  working?: number;
  waiting?: number;
  /** The highest metric seen under its target while the backlog grew and the scaler held its count. */
  below?: { metric: number; target: number; metricKind?: string; waitingMajority: boolean };
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
  // Broker connections into each node, indexed once: O(nodes + edges), however many scalers.
  const incoming = new Map<string, DiagramEdge[]>();
  for (const e of d.edges) {
    const from = nodes.get(e.from);
    if (!from || (e.relation && e.relation !== "flow") || !brokerRole(stencilRole(from.stencil))) continue;
    const list = incoming.get(e.to);
    if (list) list.push(e);
    else incoming.set(e.to, [e]);
  }
  const partitionedBroker = new Map<string, boolean>();
  return d.nodes.flatMap((n) => {
    const p = resolveNodeProps(d, n);
    const a = p.autoscaling;
    if (!p.resources || a?.mode !== "on") return [];
    // One input per distinct broker group: parallel connections from the same group are one reader's lag.
    const inputs = new Map<string, [string, string]>();
    const partitioned = new Set<string>();
    for (const e of incoming.get(n.id) ?? []) {
      const from = nodes.get(e.from)!;
      const group =
        stencilRole(from.stencil) === "queue" ? "queue" : typeof e.props?.group === "string" ? e.props.group : e.id;
      inputs.set(JSON.stringify([from.id, group]), [from.id, group]);
      let isPartitioned = partitionedBroker.get(from.id);
      if (isPartitioned === undefined)
        partitionedBroker.set(from.id, (isPartitioned = !!resolveNodeProps(d, from).broker?.partitioned));
      if (isPartitioned) partitioned.add(from.id);
    }
    return [
      {
        id: n.id,
        controller: a.controller,
        inputs: [...inputs.values()],
        partitioned: [...partitioned],
        slots: p.concurrency,
      },
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
function startWork(d: DiagramFile, sim: Simulation): number {
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

/** The metric a decision read, in the planner's vocabulary (the UI translates each kind with its unit). */
function kindOf(decision: ScalingDecision): string | undefined {
  return (
    decision.metricKind ??
    (decision.resource
      ? `${decision.resource}${decision.targetKind === "averageValue" ? (decision.resource === "cpu" ? "Milli" : "MiB") : "Request"}`
      : decision.broker
        ? "backlog"
        : undefined)
  );
}
/** The policy with its primary target set to `value`, when `metricKind` is what that target measures. */
function withTarget(
  a: AutoscalingConfig,
  metricKind: string | undefined,
  value: number,
): AutoscalingConfig | undefined {
  if (a.mode !== "on") return undefined;
  const next = structuredClone(a);
  const c = next.controller;
  if (c.kind === "hpa" || (c.kind === "keda" && !c.triggers.length)) {
    const m = c.settings.metrics[0];
    if (!m || m.source.kind !== "resource" || !metricKind?.startsWith(m.source.resource)) return undefined;
    m.target =
      m.target.kind === "utilization"
        ? { kind: "utilization", percentOfRequest: value }
        : { kind: "averageValue", value };
  } else if (c.kind === "keda" || (c.kind === "aca" && !c.http)) {
    if (metricKind !== "backlog" || !c.triggers[0]) return undefined;
    c.triggers[0].target = value;
  } else if (c.kind === "aca") {
    if (metricKind !== "httpRate" || !c.http) return undefined;
    c.http.concurrentRequests = value;
  } else if (c.kind === "ecs") {
    const tt = c.targetTracking[0];
    if (tt && tt.metric === metricKind) tt.target = value;
    else if (!tt && c.stepScaling[0]?.metric === metricKind) c.stepScaling[0].threshold = value;
    else return undefined;
  } else if (c.kind === "appService") {
    const rule = c.rules.find((r) => r.direction === "increase");
    if (!rule || rule.metric !== metricKind) return undefined;
    rule.threshold = value;
  } else if (metricKind === "cpu") c.targetCpuPct = Math.max(1, Math.min(100, value));
  else if (metricKind === "concurrency") c.targetConcurrencyPct = Math.max(1, Math.min(100, value));
  else return undefined;
  return next;
}

/** Plays one run and records, once per simulated second, what each watched scaler did. */
function observe(
  d: DiagramFile,
  sim: Simulation,
  watched: Watched[],
  counter: { ticks: number; messages: { remaining: number } },
) {
  const run = createSimulationRun(d, sim, { messageBudget: counter.messages });
  run.setTraceActions(false);
  const engine = run.engine;
  const scale = resolveScale(sim.scale);
  const multiplier = resolveMultiplier(sim.multipliers?.capacity);
  const horizon = Math.min(estimateTotalMs(sim), PLANNER_LIMITS.horizonMs);
  const seen = new Map<string, Observation>(
    watched.map((w) => [
      w.id,
      {
        maxed: false,
        wanted: 0,
        backlog: 0,
        startupBacklog: 0,
        endBacklog: 0,
        peakDesired: 0,
        rejected: 0,
        processed: 0,
        goalsFailed: [] as string[],
      },
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
      o.processed = (engine.measure({ node: w.id, field: "processed" }) ?? 0) * scale;
      if (!f) continue;
      if (revisionAtLeast(d.planning?.revision, "p3-w1")) {
        const threads = engine.threadUsage(w.id);
        o.working = (o.working ?? 0) + (threads?.working ?? 0);
        o.waiting = (o.waiting ?? 0) + (threads?.waiting ?? 0);
      }
      if (f.starting > 0 && backlog > o.startupBacklog) {
        o.startupBacklog = backlog;
        o.startupDesired = f.desired;
      }
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
            metricKind: kindOf(decision),
          });
      }
      if (decision?.reason === "partitions" && decision.broker) o.partitions = decision.broker;
      // The backlog grew over 15 s, the scaler held its count below the maximum, and its metric sat under target:
      // the target, not the range, keeps it from scaling (a slot-bound service whose CPU never reaches it).
      const growing = history.length >= 15 && backlog > history[0] && backlog > f.ready * w.slots;
      if (
        growing &&
        decision &&
        decision.metric !== undefined &&
        decision.target &&
        decision.metric < decision.target &&
        decision.desired === f.desired &&
        f.desired < max &&
        decision.reason !== "override" &&
        decision.metric > (o.below?.metric ?? 0)
      ) {
        o.below = {
          metric: decision.metric,
          target: decision.target,
          metricKind: kindOf(decision),
          waitingMajority: (o.waiting ?? 0) > (o.working ?? 0),
        };
      }
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
  // Goals: the simulation's own backlog/lag/in-flight expectations about each scaler or its input brokers.
  const failed = new Set(
    run
      .state()
      .expectations.filter((e) => e.status === "fail")
      .map((e) => e.id),
  );
  for (const w of watched) {
    const about = new Set([w.id, ...w.inputs.map(([broker]) => broker)]);
    seen.get(w.id)!.goalsFailed = (sim.expectations ?? [])
      .filter(
        (e) =>
          "node" in e.metric &&
          about.has(e.metric.node) &&
          ["backlog", "lag", "inFlight"].includes(e.metric.field) &&
          (e.op === "<" || e.op === "<=") &&
          failed.has(e.id),
      )
      .map((e) => e.id);
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

type Counter = { ticks: number; runs: number; messages: { remaining: number } };
function unavailable(sim: Simulation, reason: NonNullable<ScalingPlan["reason"]>): ScalingPlan {
  return {
    simulation: sim.id,
    title: sim.title,
    traffic: resolveMultiplier(sim.multipliers?.traffic),
    horizonMs: Math.min(estimateTotalMs(sim), PLANNER_LIMITS.horizonMs),
    status: "unavailable",
    reason,
    suggestions: [],
    runs: 0,
    ticks: 0,
  };
}
/** A run over the message budget, or a candidate over the lifecycle budget, makes the plan unavailable. */
function planSimulation(d: DiagramFile, sim: Simulation, counter: Counter): ScalingPlan {
  try {
    return planBounded(d, sim, counter);
  } catch (error) {
    if (
      error instanceof WorkBudgetError ||
      error instanceof LifecycleBudgetError ||
      error instanceof FaultTimelineError
    )
      return unavailable(sim, "budget");
    throw error;
  }
}
function planBounded(d: DiagramFile, sim: Simulation, counter: Counter): ScalingPlan {
  const horizonMs = Math.min(estimateTotalMs(sim), PLANNER_LIMITS.horizonMs);
  const base = {
    simulation: sim.id,
    title: sim.title,
    traffic: resolveMultiplier(sim.multipliers?.traffic),
    horizonMs,
    suggestions: [] as PlanSuggestion[],
  };
  const watched = scalers(d).filter((w) => !ownsPolicy(sim, w.id));
  // A diagram past its lifecycle budget doesn’t play at all; say so instead of failing the checks.
  if (resourceBudgetExceeded(d)) throw new LifecycleBudgetError("The diagram exceeds the lifecycle budget");
  if (!watched.length) return { ...base, status: "unavailable", reason: "policy", runs: 0, ticks: 0 };
  if (startWork(d, sim) > PLANNER_LIMITS.startWork)
    return { ...base, status: "unavailable", reason: "start", runs: 0, ticks: 0 };
  const multiplier = resolveMultiplier(sim.multipliers?.capacity);
  const local = { ticks: 0, messages: counter.messages };
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
  const waitingCallers = revisionAtLeast(d.planning?.revision, "p3-w1")
    ? new Set(d.edges.filter((e) => e.kind === "sync" && (!e.relation || e.relation === "flow")).map((e) => e.from))
    : new Set<string>();
  for (const w of watched) {
    const o = first.get(w.id)!;
    // Busy-thread growth while catching up is not a range problem once the scenario has drained.
    if (o.maxed && o.metricKind?.startsWith("busyThreads") && o.endBacklog === 0) continue;
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
    } else if (
      !o.maxed &&
      o.below?.waitingMajority &&
      (c.kind === "hpa" || c.kind === "keda") &&
      o.below.metricKind?.startsWith("cpu") &&
      // A metric change cannot help this scenario if its first new pod is ready only at its end.
      horizonMs >
        Math.max(c.settings.syncMs, ...c.settings.metrics.map((m) => m.windowMs + m.metricDelayMs)) +
          (resolveNodeProps(d, nodes.get(w.id)!).resources?.startup.delayMs ?? 0)
    ) {
      const autoscaling = structuredClone(a);
      if (autoscaling.mode === "on" && "settings" in autoscaling.controller) {
        const metric = autoscaling.controller.settings.metrics.find(
          (m) => m.source.kind === "resource" && m.source.resource === "cpu",
        )!;
        metric.source = { kind: "pods", metric: "busyThreads" };
        metric.target = { kind: "utilization", percentOfRequest: 70 };
        suggestions.push({
          ...common,
          kind: "busyThreads",
          from: o.below.target,
          to: 70,
          fix: [{ node: w.id, props: { autoscaling } }],
        });
      }
    } else if (!o.maxed && o.below && !o.below.waitingMajority && !waitingCallers.has(w.id)) {
      // Lower the target under what the backlog-bound fleet showed, so the controller acts on it.
      const to = Math.max(1, Math.floor(o.below.metric * 0.9));
      const autoscaling = to < o.below.target ? withTarget(a, o.below.metricKind, to) : undefined;
      if (autoscaling)
        suggestions.push({
          ...common,
          kind: "target",
          metric: o.below.metric,
          target: o.below.target,
          metricKind: o.below.metricKind,
          from: o.below.target,
          to,
          fix: [{ node: w.id, props: { autoscaling } }],
        });
    } else if (
      !o.maxed &&
      o.goalsFailed.length &&
      o.startupBacklog > 0 &&
      (o.startupDesired ?? 0) > replicaRange(c, multiplier).min
    ) {
      // A backlog goal failed while replicas started: keep what the scaler wanted then warm from the start.
      const to = Math.min(c.maxReplicas, authored(o.startupDesired ?? 0));
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
    // A fix that would take the diagram past its lifecycle budget can't be played, so it isn't offered.
    const candidate = apply(d, suggestions);
    if (resourceBudgetExceeded(candidate)) throw new LifecycleBudgetError("Scenario sizing exceeds the budget");
    const rerun = observe(candidate, sim, watched, local);
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
          ? after.goalsFailed.length < before.goalsFailed.length
          : s.kind === "busyThreads"
            ? after.backlog < before.backlog && after.processed > before.processed
            : s.kind === "target"
              ? after.backlog < before.backlog
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
  // A fix the runs couldn't verify is offered only as words. A lower target or a warm minimum is a
  // speculative remedy: unless a rerun bears it out it isn't reported at all.
  suggestions = suggestions
    .filter((s) => !((s.kind === "target" || s.kind === "busyThreads" || s.kind === "min") && !(s.fix && s.verified)))
    .map((s) => (s.fix && !s.verified ? { ...s, fix: undefined } : s));
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
/**
 * Plans for every saved simulation with a scaler, played here. Memoized on what a simulation sees of the diagram
 * (src/sim/simulationContent.ts): moving things or renaming a connection reuses the result; renaming a node doesn't.
 */
export function planScaling(
  d: DiagramFile,
  counter: { ticks: number; runs: number; messages?: number } = { ticks: 0, runs: 0 },
): ScalingPlan[] {
  if (!revisionAtLeast(d.planning?.revision, "p3-a1") || !d.simulations?.length) return [];
  const key = simulationContent(d);
  const hit = cache.get(key);
  if (hit) return hit;
  if (!scalers(d).length) return [];
  const sims = d.simulations.slice(0, PLANNER_LIMITS.simulations);
  const messages = { remaining: PLANNER_LIMITS.messages };
  const run = { ticks: 0, runs: 0, messages };
  const plans =
    planWork(d) > PLANNER_LIMITS.work
      ? sims.map((sim) => unavailable(sim, "budget"))
      : sims.map((sim) => planSimulation(d, sim, run));
  counter.ticks += run.ticks;
  counter.runs += run.runs;
  counter.messages = (counter.messages ?? 0) + PLANNER_LIMITS.messages - messages.remaining;
  if (cache.size >= 4) cache.delete(cache.keys().next().value!);
  cache.set(key, plans);
  return plans;
}

/**
 * Plans to read without blocking. In the editor (an off-thread planner registered, src/lib/scenarioPlanner.ts) only
 * what the checks worker already worked out for exactly this content: undefined until then. Anywhere else (headless
 * tools, the worker itself) planned here. Checks and agent descriptions read this; never a simulation on the UI thread.
 */
export function scenarioPlans(d: DiagramFile): ScalingPlan[] | undefined {
  const editor = offThreadPlans(d);
  return editor ? editor.plans : planScaling(d);
}
