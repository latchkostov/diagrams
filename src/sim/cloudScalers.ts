import type {
  AcaController,
  AppServiceController,
  CloudController,
  CloudRunController,
  ComputeResources,
  EcsController,
  EcsMetric,
  EcsOperator,
  EcsStepScaling,
  HpaController,
  KedaTrigger,
  MonitorOperator,
  MonitorRule,
} from "../model/autoscaling";
import { replicaRange } from "../model/resourceRuntime";
import { evaluateHpa, metricValue, metricWindow, type Fleet, type ScalingDecision } from "./autoscaling";
import { evaluateKeda, resetKeda, type BrokerMetric, type KedaLike, type ScalerTrigger } from "./keda";

// A3 cloud adapters (docs/SIMULATION.md § A3). Each is a thin policy over the shared fleet lifecycle, metric windows
// and decision record: Container Apps maps onto the KEDA/HPA pipeline, Cloud Run onto the HPA pipeline, and ECS and
// App Service evaluate their own alarm/rule semantics over the same metric windows. None owns replicas: the engine
// reconciles every decision through the one fleet path, so startup, drain, pause, override and checkpoints are shared.

/** What an adapter may read from the engine, in real units. Indexed reads: no message or replica scans. */
export interface CloudReads {
  /** Cumulative requests a load balancer node delivered to this node; undefined when it can't be read. */
  routed(source: string): number | undefined;
  /** Pushed requests waiting at the node now (not broker deliveries). */
  waiting(): number;
  /** Work in flight at the node now. */
  inFlight(): number;
  broker(t: KedaTrigger): BrokerMetric | undefined;
}
export interface EcsState {
  kind: "ecs";
  /** Cumulative routed requests per load balancer at the previous period's end (a Map: node ids are untrusted). */
  routed: Map<string, number>;
  /** When those counts were read: a rate divides by the actual span, never less than one period. */
  routedAt: number;
  /** Consecutive periods over / under each target-tracking policy's alarm thresholds. */
  out: number[];
  in: number[];
  /** Consecutive breaching periods of each step policy's alarm. */
  steps: number[];
  /** Per policy (target tracking first, then step): an active scale-out cooldown and its starting capacity. */
  outCooldown: ({ until: number; base: number } | null)[];
  inCooldownUntil: number[];
}
export interface AppServiceState {
  kind: "appService";
  /** The most recent scale action: every rule's own cooldown counts from it. */
  lastScaleAt?: number;
}
export type CloudState = EcsState | AppServiceState | { kind: "aca" | "cloudRun" };

export function resetCloud(f: Fleet, c: CloudController, now: number, node: string, reads: CloudReads): void {
  if (c.kind === "aca") {
    f.cloud = { kind: "aca" };
    resetKeda(f, acaPipeline(c, node), now);
  } else if (c.kind === "ecs") {
    const policies = c.targetTracking.length + c.stepScaling.length;
    const routed = new Map<string, number>();
    for (const p of [...c.targetTracking, ...c.stepScaling])
      if (p.source) routed.set(p.source.node, reads.routed(p.source.node) ?? 0);
    f.cloud = {
      kind: "ecs",
      routed,
      routedAt: now,
      out: c.targetTracking.map(() => 0),
      in: c.targetTracking.map(() => 0),
      steps: c.stepScaling.map(() => 0),
      outCooldown: Array.from({ length: policies }, () => null),
      inCooldownUntil: Array.from({ length: policies }, () => -1),
    };
  } else f.cloud = c.kind === "appService" ? { kind: "appService" } : { kind: "cloudRun" };
}
/** Pause freezes cooldown clocks with the rest of the lifecycle; no missed evaluation is replayed. */
export function shiftCloud(f: Fleet, duration: number): void {
  const s = f.cloud;
  if (s?.kind === "ecs") {
    s.routedAt += duration;
    for (const cd of s.outCooldown) if (cd) cd.until += duration;
    s.inCooldownUntil = s.inCooldownUntil.map((until) => (until < 0 ? until : until + duration));
  } else if (s?.kind === "appService" && s.lastScaleAt !== undefined) s.lastScaleAt += duration;
}
/** Container Apps rules on the KEDA pipeline: HTTP is one more trigger, read on every 15 s sync. */
export function acaPipeline(c: AcaController, node: string): KedaLike {
  return {
    kind: "aca",
    minReplicas: c.minReplicas,
    maxReplicas: c.maxReplicas,
    initialReplicas: c.initialReplicas,
    pollingMs: c.pollingMs,
    cooldownMs: c.cooldownMs,
    initialCooldownMs: 0,
    settings: c.settings,
    triggers: [
      ...c.triggers,
      ...(c.http
        ? [
            {
              type: "http" as const,
              source: { node },
              target: c.http.concurrentRequests,
              activation: 0,
              useCachedMetrics: false as const,
            },
          ]
        : []),
    ],
  };
}
/** ACA's documented HTTP metric: requests that arrived in the past 15 s, divided by 15 (per second). */
export function httpRate(f: Fleet, now: number): number {
  return metricWindow(f, now, 15_000).arrivals / 15;
}
/** Per-instance in-flight work as a percent of the instance's maximum concurrency, over one window. */
function concurrencyPct(f: Fleet, now: number, windowMs: number, concurrency: number): number | undefined {
  const w = metricWindow(f, now, windowMs);
  if (!w.readySamples || !(concurrency > 0)) return undefined;
  return (w.inFlightPerReady / w.readySamples / concurrency) * 100;
}

/**
 * Requests waiting with no instance free start instances on demand (Cloud Run's on-demand scaling; Container Apps'
 * HTTP activation from zero). Evaluated every tick from two O(1) counters; never more than the demand needs.
 */
export function onDemand(
  f: Fleet,
  c: CloudController,
  now: number,
  reads: CloudReads,
  multiplier: number,
  concurrency: number,
): ScalingDecision | undefined {
  if (c.kind !== "cloudRun" && !(c.kind === "aca" && c.http)) return undefined;
  if (c.kind === "aca" && f.desired > 0) return undefined;
  const waiting = reads.waiting();
  if (!(waiting > 0)) return undefined;
  const range = replicaRange(c, multiplier);
  let wanted: number;
  if (c.kind === "aca") wanted = Math.max(1, range.min);
  else {
    const demand = reads.inFlight() + waiting;
    if (!(concurrency > 0) || demand <= f.desired * concurrency) return undefined;
    wanted = Math.ceil(demand / concurrency);
  }
  const desired = Math.min(range.max, Math.max(f.desired, wanted));
  if (desired <= f.desired) return undefined;
  if (c.kind === "aca" && f.keda) {
    // An arriving request is activity: final-zero cooldown counts from it.
    f.keda.active = true;
    f.keda.lastActive = now;
    f.nextSync = now + c.settings.syncMs;
  }
  // Down stabilization remembers what the requests needed.
  f.recommendations.push({ at: now, count: desired });
  return (f.decision = {
    at: now,
    source: "pods",
    raw: wanted,
    desired,
    reason: wanted > range.max ? "max" : "request",
    adapter: c.kind,
    // Waiting requests, not a target metric: the reason says so; no percent is implied.
    nextAt: f.nextSync,
  });
}

export function evaluateCloud(
  f: Fleet,
  c: CloudController,
  r: ComputeResources,
  now: number,
  reads: CloudReads,
  node: string,
  multiplier: number,
  scale: number,
  concurrency: number,
): ScalingDecision | undefined {
  if (!f.cloud || f.cloud.kind !== c.kind) resetCloud(f, c, now, node, reads);
  if (c.kind === "aca") {
    const decision = evaluateKeda(
      f,
      acaPipeline(c, node),
      r,
      now,
      (t: ScalerTrigger) =>
        t.type === "http" ? { pending: httpRate(f, now), outstanding: 0 } : reads.broker(t as KedaTrigger),
      multiplier,
      scale,
    );
    if (decision) {
      decision.adapter = "aca";
      if (decision.broker === node && decision.source === "broker") {
        decision.metricKind = "httpRate";
        decision.windowMs = 15_000;
        decision.broker = undefined;
      }
    }
    return decision;
  }
  if (now < f.nextSync) return undefined;
  if (c.kind === "cloudRun") return evaluateCloudRun(f, c, r, now, multiplier, scale, concurrency);
  if (c.kind === "appService") return evaluateAppService(f, c, r, now, multiplier, scale);
  return evaluateEcs(f, c, r, now, reads, multiplier, scale);
}

// ---------------------------------------------------------------- Google Cloud Run
function evaluateCloudRun(
  f: Fleet,
  c: CloudRunController,
  r: ComputeResources,
  now: number,
  multiplier: number,
  scale: number,
  concurrency: number,
): ScalingDecision {
  const range = replicaRange(c, multiplier);
  // Documented: the higher of the 1-minute and 10-minute concurrency averages, 10% relative tolerance.
  const values = c.concurrencyWindowsMs
    .map((w) => concurrencyPct(f, now, w, concurrency))
    .filter((v): v is number => v !== undefined);
  const metric = values.length ? Math.max(...values) : undefined;
  let external: { source: "pods"; raw: number; missing: boolean; metric?: number; target?: number };
  if (metric === undefined || !f.ready) external = { source: "pods", raw: 0, missing: f.desired > 0 };
  else {
    const ratio = metric / c.targetConcurrencyPct;
    const wanted = Math.abs(ratio - 1) <= 0.1 ? f.desired : Math.ceil(f.ready * ratio);
    external = {
      source: "pods",
      raw: wanted < f.desired ? Math.min(f.desired, wanted + f.starting) : wanted,
      missing: false,
      metric,
      target: c.targetConcurrencyPct,
    };
  }
  const cpu = r.cpuLimitMilli;
  const hpa: HpaController = {
    kind: "hpa",
    minReplicas: c.minReplicas,
    maxReplicas: c.maxReplicas,
    initialReplicas: c.initialReplicas,
    settings: {
      syncMs: c.evaluationMs,
      tolerance: 0.1,
      initialReadinessDelayMs: 0,
      cpuInitializationPeriodMs: 0,
      metrics: cpu
        ? [
            {
              source: { kind: "resource", resource: "cpu" },
              target: { kind: "averageValue", value: (cpu * c.targetCpuPct) / 100 },
              windowMs: c.cpuWindowMs,
              metricDelayMs: 0,
            },
          ]
        : [],
      // No documented scale-out rate limit: on-demand requests and this pipeline grow as needed.
      up: { stabilizationMs: 0, selectPolicy: "Max", policies: [{ type: "Percent", value: 10_000, periodMs: 1000 }] },
      down: {
        stabilizationMs: c.scaleInDelayMs,
        selectPolicy: "Max",
        policies: [{ type: "Percent", value: 100, periodMs: 1000 }],
      },
    },
  };
  const decision = evaluateHpa(f, hpa, r, now, multiplier, scale, external, range);
  decision.adapter = "cloudRun";
  if (decision.resource === "cpu" && cpu) {
    decision.metricKind = "cpu";
    decision.metric = decision.metric === undefined ? undefined : (decision.metric / cpu) * 100;
    decision.target = c.targetCpuPct;
    decision.resource = undefined;
    decision.targetKind = undefined;
  } else if (decision.metric !== undefined) {
    decision.metricKind = "concurrency";
    // The concurrency recommendation reads its longest window.
    decision.windowMs = Math.max(...c.concurrencyWindowsMs);
  }
  return decision;
}

// ---------------------------------------------------------------- Azure App Service (Azure Monitor autoscale)
const compareMonitor = (op: MonitorOperator, v: number, threshold: number) =>
  op === "GreaterThan"
    ? v > threshold
    : op === "GreaterThanOrEqual"
      ? v >= threshold
      : op === "LessThan"
        ? v < threshold
        : v <= threshold;
function monitorValue(f: Fleet, r: ComputeResources, rule: MonitorRule, now: number, scale: number) {
  if (rule.metric === "httpQueue") {
    const w = metricWindow(f, now, rule.windowMs);
    return now >= rule.windowMs && w.readySamples ? w.waitingPerReady / w.readySamples : undefined;
  }
  const absolute = metricValue(
    f,
    r,
    {
      source: { kind: "resource", resource: rule.metric },
      target: { kind: "averageValue", value: 1 },
      windowMs: rule.windowMs,
      metricDelayMs: 0,
    },
    now,
    scale,
  );
  const size = rule.metric === "cpu" ? (r.cpuLimitMilli ?? r.availableCpuMilli) : r.memoryLimitMiB;
  return absolute === undefined || !size ? undefined : (absolute / size) * 100;
}
function monitorCapacity(rule: MonitorRule, current: number): number {
  if (rule.changeType === "ExactCount") return rule.value;
  const change =
    rule.changeType === "ChangeCount" ? rule.value : Math.max(1, Math.ceil((current * rule.value) / 100) || 0);
  return rule.direction === "increase" ? current + change : Math.max(0, current - change);
}
/**
 * The fewest instances in [floor, current) at which no scale-out rule would fire on its projected per-instance
 * value (`value × current / n`), or undefined when every count flaps. Each rule bounds n on one side, so this is
 * an interval intersection: constant work in the instance count, at most ten rules.
 */
export function leastWithoutFlapping(
  rules: readonly MonitorRule[],
  values: readonly (number | undefined)[],
  current: number,
  floor: number,
): number | undefined {
  let low = Math.max(1, floor),
    high = current - 1;
  rules.forEach((rule, i) => {
    const v = values[i];
    if (rule.direction !== "increase" || v === undefined) return;
    const load = v * current;
    if (rule.operator === "GreaterThan" || rule.operator === "GreaterThanOrEqual") {
      // Safe when load / n stays at or under (strictly under, for ≥) the threshold.
      if (rule.threshold <= 0) {
        if (load > 0 || rule.operator === "GreaterThanOrEqual") high = -1;
        return;
      }
      const bound = load / rule.threshold;
      low = Math.max(low, rule.operator === "GreaterThan" ? Math.ceil(bound) : Math.floor(bound) + 1);
    } else {
      // Safe when load / n stays at or over (strictly over, for ≤) the threshold.
      if (rule.threshold <= 0) {
        if (rule.operator === "LessThanOrEqual" && load <= 0) high = -1;
        return;
      }
      const bound = load / rule.threshold;
      high = Math.min(high, rule.operator === "LessThan" ? Math.floor(bound) : Math.ceil(bound) - 1);
    }
  });
  return low <= high ? low : undefined;
}
function evaluateAppService(
  f: Fleet,
  c: AppServiceController,
  r: ComputeResources,
  now: number,
  multiplier: number,
  scale: number,
): ScalingDecision {
  const s = f.cloud as AppServiceState;
  const range = replicaRange(c, multiplier);
  const values = c.rules.map((rule) => monitorValue(f, r, rule, now, scale));
  const eligible = (rule: MonitorRule) => s.lastScaleAt === undefined || now >= s.lastScaleAt + rule.cooldownMs;
  const triggered = c.rules.map(
    (rule, i) => values[i] !== undefined && compareMonitor(rule.operator, values[i]!, rule.threshold),
  );
  f.nextSync = now + c.evaluationMs;
  const decide = (
    desired: number,
    reason: ScalingDecision["reason"],
    policy?: number,
    raw = desired,
  ): ScalingDecision => {
    const clamped = Math.max(range.min, Math.min(range.max, desired));
    if (clamped !== f.desired) s.lastScaleAt = now;
    return (f.decision = {
      at: now,
      source: policy !== undefined && c.rules[policy].metric === "httpQueue" ? "pods" : "resource",
      raw,
      desired: clamped,
      reason: raw > range.max && clamped === range.max ? "max" : reason,
      adapter: "appService",
      ...(policy !== undefined
        ? {
            policy,
            metricKind: c.rules[policy].metric,
            metric: values[policy],
            target: c.rules[policy].threshold,
            windowMs: c.rules[policy].windowMs,
            cooldownUntil: (s.lastScaleAt ?? now) + c.rules[policy].cooldownMs,
          }
        : {}),
      nextAt: f.nextSync,
    });
  };
  // A metric that can't be read restores the profile's default capacity, and never scales in.
  const missing = values.some((v) => v === undefined);
  const outs = c.rules.flatMap((rule, i) =>
    rule.direction === "increase" && triggered[i] && eligible(rule)
      ? [{ i, capacity: monitorCapacity(rule, f.desired) }]
      : [],
  );
  if (outs.length) {
    // Several scale-out rules: the highest capacity.
    const best = outs.reduce((a, b) => (b.capacity > a.capacity ? b : a));
    if (best.capacity > f.desired) return decide(best.capacity, "rule", best.i, best.capacity);
  }
  if (missing) {
    const fallback = range.initial;
    return f.desired < fallback ? decide(fallback, "default") : decide(f.desired, "missing");
  }
  const ins = c.rules.map((rule, i) => ({ rule, i })).filter(({ rule }) => rule.direction === "decrease");
  // Holding steady still reports the first scale-out rule's metric against its threshold.
  const watch = c.rules.findIndex((rule, i) => rule.direction === "increase" && values[i] !== undefined);
  if (!ins.length || !ins.every(({ i }) => triggered[i]))
    return decide(f.desired, "tolerance", watch < 0 ? undefined : watch);
  const waiting = ins.find(({ rule }) => !eligible(rule));
  if (waiting) return decide(f.desired, "cooldown", waiting.i);
  // All scale-in rules agree: the fewest removed. Then defer or shrink less where it would flap.
  const target = ins.reduce(
    (best, { rule, i }) => {
      const capacity = monitorCapacity(rule, f.desired);
      return capacity > best.capacity ? { capacity, i } : best;
    },
    { capacity: -1, i: ins[0].i },
  );
  if (target.capacity >= f.desired) return decide(f.desired, "tolerance", watch < 0 ? undefined : watch);
  const n = leastWithoutFlapping(c.rules, values, f.desired, Math.max(range.min, target.capacity, 1));
  if (n !== undefined) return decide(n, "rule", target.i, target.capacity);
  return decide(f.desired, "flapping", target.i, target.capacity);
}

// ---------------------------------------------------------------- AWS ECS Service Auto Scaling
const compareCloudWatch = (op: EcsOperator, v: number, threshold: number) =>
  op === "GreaterThanOrEqualToThreshold"
    ? v >= threshold
    : op === "GreaterThanThreshold"
      ? v > threshold
      : op === "LessThanThreshold"
        ? v < threshold
        : v <= threshold;
/** PercentChangeInCapacity rounding, as documented: >1 down, (0,1) to 1, (−1,0) to −1, <−1 up. */
export function percentChange(current: number, percent: number, minMagnitude = 0): number {
  const exact = (current * percent) / 100;
  let change = exact > 1 ? Math.floor(exact) : exact > 0 ? 1 : exact === 0 ? 0 : exact > -1 ? -1 : Math.ceil(exact);
  if (change !== 0 && Math.abs(change) < minMagnitude) change = Math.sign(change) * minMagnitude;
  return change;
}
export function stepFor(p: EcsStepScaling, value: number) {
  const d = value - p.threshold;
  const above = p.operator.startsWith("Greater");
  return p.steps.find((s) =>
    above
      ? (s.lower === undefined || d >= s.lower) && (s.upper === undefined || d < s.upper)
      : (s.lower === undefined || d > s.lower) && (s.upper === undefined || d <= s.upper),
  );
}
function evaluateEcs(
  f: Fleet,
  c: EcsController,
  r: ComputeResources,
  now: number,
  reads: CloudReads,
  multiplier: number,
  scale: number,
): ScalingDecision {
  const s = f.cloud as EcsState;
  const range = replicaRange(c, multiplier);
  const period = c.metricPeriodMs;
  // One read per load balancer per period; every policy on it sees the same delta.
  const routed = new Map<string, number | undefined>();
  const span = Math.max(period, now - s.routedAt);
  s.routedAt = now;
  for (const p of [...c.targetTracking, ...c.stepScaling])
    if (p.source && !routed.has(p.source.node)) {
      const now = reads.routed(p.source.node);
      routed.set(p.source.node, now === undefined ? undefined : now - (s.routed.get(p.source.node) ?? 0));
      if (now !== undefined) s.routed.set(p.source.node, now);
    }
  const value = (metric: EcsMetric, source?: { node: string }): number | undefined => {
    if (metric === "albRequestCount" || metric === "albRequestCountPerTarget") {
      const delta = source && routed.get(source.node);
      if (delta === undefined) return undefined;
      const perMinute = (delta * 60_000) / span;
      // Per target: no running task, no datapoint (insufficient data, never zero).
      return metric === "albRequestCount" ? perMinute : f.ready ? perMinute / f.ready : undefined;
    }
    const absolute = metricValue(
      f,
      r,
      {
        source: { kind: "resource", resource: metric },
        target: { kind: "averageValue", value: 1 },
        windowMs: period,
        metricDelayMs: 0,
      },
      now,
      scale,
    );
    const size = metric === "cpu" ? r.cpuLimitMilli : r.memoryLimitMiB;
    return absolute === undefined || !size ? undefined : (absolute / size) * 100;
  };
  f.nextSync = now + period;
  const cooling = (k: number) => {
    const cd = s.outCooldown[k];
    return cd && now < cd.until ? cd : null;
  };
  type Candidate = { k: number; capacity: number; metric: number; target: number; kind: EcsMetric; step: boolean };
  const outs: Candidate[] = [],
    stepIns: Candidate[] = [];
  let missing = false,
    pending:
      { k: number; periods: number; needed: number; metric: number; target: number; kind: EcsMetric } | undefined;
  const tt = c.targetTracking.map((p, i) => {
    const v = value(p.metric, p.source);
    if (v === undefined) {
      s.out[i] = 0;
      s.in[i] = 0;
      missing = true;
      return undefined;
    }
    s.out[i] = v > p.target ? s.out[i] + 1 : 0;
    s.in[i] = v < p.target * (1 - c.alarm.inMargin) ? s.in[i] + 1 : 0;
    // The metric is averaged over the running tasks, so it asks for running × metric ÷ target. Tasks a scale-out
    // (or its cooldown) added that are still starting count in the desired count it's compared with, not again.
    const wanted = Math.ceil((f.ready * v) / p.target);
    if (s.out[i] >= c.alarm.outPeriods && wanted > f.desired)
      outs.push({ k: i, capacity: wanted, metric: v, target: p.target, kind: p.metric, step: false });
    else if (s.out[i] > 0 && s.out[i] < c.alarm.outPeriods)
      pending ??= { k: i, periods: s.out[i], needed: c.alarm.outPeriods, metric: v, target: p.target, kind: p.metric };
    // Scale-in is proportional to the current desired count; it never removes what keeps the metric under target.
    const inWanted = Math.ceil((f.desired * v) / p.target);
    return { v, wanted: inWanted, readyIn: s.in[i] >= c.alarm.inPeriods && inWanted < f.desired };
  });
  c.stepScaling.forEach((p, j) => {
    const k = c.targetTracking.length + j;
    const v = value(p.metric, p.source);
    if (v === undefined) {
      // INSUFFICIENT_DATA: the alarm can't be in ALARM and invokes nothing.
      s.steps[j] = 0;
      missing = true;
      return;
    }
    s.steps[j] = compareCloudWatch(p.operator, v, p.threshold) ? s.steps[j] + 1 : 0;
    if (s.steps[j] < p.evaluationPeriods) {
      if (s.steps[j] > 0)
        pending ??= {
          k,
          periods: s.steps[j],
          needed: p.evaluationPeriods,
          metric: v,
          target: p.threshold,
          kind: p.metric,
        };
      return;
    }
    // In ALARM: the policy is invoked again every period until the alarm returns to OK.
    const step = stepFor(p, v);
    if (!step) return;
    const base = cooling(k)?.base ?? f.desired;
    const capacity = Math.max(
      0,
      p.adjustmentType === "ExactCapacity"
        ? step.adjustment
        : p.adjustmentType === "ChangeInCapacity"
          ? base + step.adjustment
          : base + percentChange(base, step.adjustment, p.minAdjustmentMagnitude),
    );
    const candidate = { k, capacity, metric: v, target: p.threshold, kind: p.metric, step: true };
    if (capacity > f.desired) outs.push(candidate);
    else if (capacity < f.desired) stepIns.push(candidate);
  });
  const decide = (
    desired: number,
    reason: ScalingDecision["reason"],
    by?: { k: number; metric: number; target: number; kind: EcsMetric },
    raw = desired,
  ): ScalingDecision =>
    (f.decision = {
      at: now,
      source: by?.kind === "cpu" || by?.kind === "memory" || !by ? "resource" : "pods",
      raw,
      desired: Math.max(range.min, Math.min(range.max, desired)),
      reason: raw > range.max ? "max" : reason,
      adapter: "ecs",
      ...(by ? { policy: by.k, metric: by.metric, target: by.target, metricKind: by.kind } : {}),
      ...(pending && reason === "alarm" ? { periods: pending.periods, periodsNeeded: pending.needed } : {}),
      windowMs: period,
      nextAt: f.nextSync,
    });
  if (outs.length) {
    // Scale out when any policy asks: the largest capacity.
    const best = outs.reduce((a, b) => (b.capacity > a.capacity ? b : a));
    const clamped = Math.min(range.max, best.capacity);
    if (clamped > f.desired) {
      const p = best.step ? c.stepScaling[best.k - c.targetTracking.length] : c.targetTracking[best.k];
      const cooldown = "cooldownMs" in p ? p.cooldownMs : p.scaleOutCooldownMs;
      s.outCooldown[best.k] = cooling(best.k) ?? { until: now + cooldown, base: f.desired };
      // A scale-out interrupts every scale-in cooldown.
      s.inCooldownUntil = s.inCooldownUntil.map(() => -1);
      return decide(best.capacity, best.step ? "step" : "target", best, best.capacity);
    }
    return decide(f.desired, "max", best, best.capacity);
  }
  const ins: Candidate[] = [];
  const enabled = c.targetTracking.map((p, i) => ({ p, i, x: tt[i] })).filter(({ p }) => !p.disableScaleIn);
  let blocked: { k: number; metric: number; target: number; kind: EcsMetric } | undefined;
  // Target tracking scales in only when every policy with scale-in enabled agrees and none lacks data.
  if (enabled.length && enabled.every(({ x }) => x?.readyIn)) {
    const wait = enabled.find(({ i }) => now < s.inCooldownUntil[i]);
    const best = enabled.reduce((a, b) => (b.x!.wanted > a.x!.wanted ? b : a));
    const by = { k: best.i, metric: best.x!.v, target: best.p.target, kind: best.p.metric };
    if (wait) blocked = by;
    else ins.push({ ...by, capacity: best.x!.wanted, step: false });
  }
  for (const candidate of stepIns)
    if (now < s.inCooldownUntil[candidate.k]) blocked ??= candidate;
    else ins.push(candidate);
  if (ins.length) {
    // Several scale-in policies: the largest remaining capacity.
    const best = ins.reduce((a, b) => (b.capacity > a.capacity ? b : a));
    const desired = Math.max(range.min, best.capacity);
    if (desired < f.desired) {
      const started = best.step ? [best.k] : enabled.map(({ i }) => i);
      for (const k of started) {
        const p = k < c.targetTracking.length ? c.targetTracking[k] : c.stepScaling[k - c.targetTracking.length];
        s.inCooldownUntil[k] = now + ("cooldownMs" in p ? p.cooldownMs : p.scaleInCooldownMs);
      }
      return decide(desired, best.step ? "step" : "target", best);
    }
  }
  if (blocked) return decide(f.desired, "cooldown", blocked);
  if (pending) return decide(f.desired, "alarm", pending);
  return decide(f.desired, missing ? "missing" : "tolerance");
}
