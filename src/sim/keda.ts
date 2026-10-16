import type { ComputeResources, KedaController, KedaTrigger } from "../model/autoscaling";
import { replicaRange } from "../model/autoscaling";
import { evaluateHpa, type Fleet, type ScalingDecision } from "./autoscaling";

/** Real messages, including outstanding deliveries exactly once. Unknown is never an empty broker. */
export interface BrokerMetric {
  pending: number;
  outstanding: number;
  partitions?: number;
}
/** Container Apps' HTTP rule as a KEDA-style trigger: its metric is requests per second over the last 15 s. */
export interface HttpTrigger {
  type: "http";
  source: { node: string; group?: undefined };
  target: number;
  activation: number;
  useCachedMetrics: false;
}
export type ScalerTrigger = KedaTrigger | HttpTrigger;
/** The pipeline's input: a KEDA ScaledObject, or Container Apps rules mapped onto it. */
export type KedaLike<T extends ScalerTrigger = ScalerTrigger> = Omit<KedaController, "triggers" | "kind"> & {
  kind: "keda" | "aca";
  triggers: readonly T[];
};
export interface KedaState {
  createdAt: number;
  nextPoll: number;
  lastActive?: number;
  active: boolean;
  failures: number[];
  cached: (BrokerMetric | undefined)[];
}
export function resetKeda(f: Fleet, c: { pollingMs: number; triggers: readonly unknown[] }, now: number): void {
  f.keda = {
    createdAt: now,
    nextPoll: now + c.pollingMs,
    active: false,
    failures: c.triggers.map(() => 0),
    cached: [],
  };
}
export function triggerValue(t: ScalerTrigger, metric: BrokerMetric): number {
  const includeOutstanding =
    t.type === "kafka" ||
    (t.type === "aws-sqs-queue" && t.scaleOnInFlight) ||
    (t.type === "rabbitmq" && t.protocol === "http" && !t.excludeUnacknowledged);
  return metric.pending + (includeOutstanding ? metric.outstanding : 0);
}
/** One KEDA activation branch followed by, at most, one generated-HPA evaluation. */
export function evaluateKeda<T extends ScalerTrigger>(
  f: Fleet,
  c: KedaLike<T>,
  r: ComputeResources,
  now: number,
  read: (t: T) => BrokerMetric | undefined,
  multiplier = 1,
  scale = 1,
): ScalingDecision | undefined {
  if (!f.keda) resetKeda(f, c, now);
  const state = f.keda!;
  const poll = now >= state.nextPoll,
    sync = now >= f.nextSync;
  if (!poll && (!sync || f.desired === 0)) return;
  const range = replicaRange(c, multiplier);
  let active = false,
    missing = false,
    fallback = false,
    selectedFallback = false;
  let raw = 0,
    uncapped = 0,
    selected: T | undefined,
    value: number | undefined;
  for (let i = 0; i < c.triggers.length; i++) {
    const t = c.triggers[i];
    const metric = poll || !t.useCachedMetrics ? read(t) : state.cached[i];
    if (poll) state.cached[i] = metric;
    // A cached HPA read is not another source failure.
    if (poll || !t.useCachedMetrics) state.failures[i] = metric ? 0 : state.failures[i] + 1;
    let wanted: number, beforeCap: number, measured: number | undefined;
    if (!metric) {
      const fb = c.fallback;
      if (!fb || state.failures[i] <= fb.failureThreshold) {
        missing = true;
        continue;
      }
      fallback = true;
      wanted =
        fb.behavior === "currentReplicas"
          ? f.desired
          : fb.behavior === "currentReplicasIfHigher"
            ? Math.max(f.desired, fb.replicas)
            : fb.behavior === "currentReplicasIfLower"
              ? Math.min(f.desired, fb.replicas)
              : fb.replicas;
      beforeCap = wanted;
    } else {
      const count = triggerValue(t, metric);
      active ||= count > t.activation;
      beforeCap = Math.ceil(count / t.target);
      const ratio = count / (Math.max(1, f.desired) * t.target);
      wanted = Math.abs(ratio - 1) <= c.settings.tolerance ? f.desired : beforeCap;
      if (t.type === "kafka" && !t.allowIdleConsumers) wanted = Math.min(wanted, metric.partitions ?? 0);
      measured = count;
    }
    if (wanted >= raw) {
      raw = wanted;
      uncapped = beforeCap;
      selected = t;
      value = measured;
      selectedFallback = !metric;
    }
  }
  if (poll) {
    state.nextPoll = now + c.pollingMs;
    state.active = active;
    if (active) state.lastActive = now;
  }
  const zeroAllowed = range.min === 0 || c.idleReplicas === 0;
  const cooldownUntil =
    state.lastActive === undefined ? state.createdAt + c.initialCooldownMs : state.lastActive + c.cooldownMs;
  const decision = (desired: number, reason: ScalingDecision["reason"]) =>
    (f.decision = {
      at: now,
      raw: desired,
      desired,
      reason,
      nextAt: state.nextPoll,
      metric: value,
      target: selected?.target,
      broker: selected?.source.node,
      group: selected?.source.group,
      active: state.active,
      cooldownUntil,
      pollingMs: c.pollingMs,
    });
  if (poll && f.desired === 0) {
    // An unavailable trigger cannot establish a zero-wake signal. Fallback feeds an already active HPA.
    if (active) {
      f.nextSync = now + c.settings.syncMs;
      return decision(Math.max(1, range.min), "activation");
    }
    return decision(0, missing || fallback ? "missing" : "inactive");
  }
  if (poll && zeroAllowed && !active && !missing && !fallback && now >= cooldownUntil) {
    f.nextSync = now + c.settings.syncMs;
    return decision(0, "inactive");
  }
  if (!sync || f.desired === 0) return;
  const hpa = evaluateHpa(f, { ...c, kind: "hpa" }, r, now, multiplier, scale, {
    raw,
    missing,
    metric: value,
    target: selected?.target,
  });
  // Preserve the limiting trigger's unbounded arithmetic for Why; history uses its executable recommendation.
  if (selected && hpa.resource === undefined) {
    hpa.raw = Math.max(hpa.raw, uncapped);
    hpa.broker = selected.source.node;
    hpa.group = selected.source.group;
    if (raw < uncapped && hpa.reason === "target") hpa.reason = "partitions";
  }
  if (selectedFallback && hpa.resource === undefined && hpa.reason !== "max" && hpa.reason !== "missing")
    hpa.reason = "fallback";
  else if (zeroAllowed && !state.active && hpa.desired === 1 && now < cooldownUntil && hpa.reason === "tolerance")
    hpa.reason = "cooldown";
  hpa.active = state.active;
  hpa.cooldownUntil = cooldownUntil;
  hpa.pollingMs = c.pollingMs;
  hpa.nextAt = Math.min(f.nextSync, state.nextPoll);
  return hpa;
}
