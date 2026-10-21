import { createCpuPartBudget, type CpuPartBudget } from "./resourceWork";
import type { SampledWork } from "./sampledResources";
import type { ComputeResources, HpaController, ScalingMetric } from "../model/autoscaling";
import type { CloudState } from "./cloudScalers";
import { replicaRange, unmeasured } from "../model/autoscaling";
import { mulberry32 } from "./rng";

export interface ScalingDecision {
  /** Ownership of the winning metric; independent of optional display metadata. */
  source: "resource" | "pods" | "broker";
  at: number;
  raw: number;
  desired: number;
  reason:
    | "target"
    | "tolerance"
    | "missing"
    | "stabilization"
    | "policy"
    | "max"
    | "override"
    | "activation"
    | "inactive"
    | "cooldown"
    | "partitions"
    | "fallback"
    // A3 cloud adapters
    | "alarm"
    | "step"
    | "rule"
    | "flapping"
    | "request"
    | "default";
  nextAt: number;
  /** A3: which cloud adapter decided, its metric and the policy/rule index that acted. */
  adapter?: "ecs" | "aca" | "appService" | "cloudRun";
  metricKind?:
    | "cpu"
    | "memory"
    | "albRequestCountPerTarget"
    | "albRequestCount"
    | "httpQueue"
    | "concurrency"
    | "httpRate"
    | "busyThreads"
    | "busyThreadsPerPod";
  policy?: number;
  /** Consecutive breaching periods counted so far and the periods the alarm needs. */
  periods?: number;
  periodsNeeded?: number;
  metric?: number;
  target?: number;
  resource?: "cpu" | "memory";
  targetKind?: "utilization" | "averageValue";
  windowMs?: number;
  metricDelayMs?: number;
  broker?: string;
  group?: string;
  active?: boolean;
  cooldownUntil?: number;
  pollingMs?: number;
}
/** Public explanation contract; metric ownership stays inside controller evaluation. */
export type ScalingDecisionReadout = Omit<ScalingDecision, "source">;
export interface FleetPoint {
  time: number;
  desired: number;
  starting: number;
  ready: number;
  draining: number;
}
export interface FleetReadout extends Omit<FleetPoint, "time"> {
  decision?: ScalingDecisionReadout;
  history: readonly FleetPoint[];
}
export interface ResourceReadout {
  unmeasured?: true;
  /** All resource values already describe real work, irrespective of dot weight. */
  units: "real";
  cpuRequestPct?: number;
  /** A3 adapters: CPU as a percent of the task or instance allocation (limit, else what the node has), with or
   *  without a request. */
  cpuAllocatedPct?: number;
  memoryRequestPct?: number;
  memoryLimitPct?: number;
  memoryMiB: number;
  executedCpuMs: number;
  unsafe: boolean;
  estimated: boolean;
}
export interface ReplicaRow extends ResourceReadout {
  id: number;
  state: "ready" | "starting" | "draining";
}
export interface Cohort {
  first: number;
  last: number;
  at: number;
}
interface Sample {
  at: number;
  cpu: number;
  occupancy: number;
  ready: number;
  /** A3 request metrics (real units): average in-flight work, average waiting pushed requests, pushed arrivals. */
  inFlight?: number;
  waiting?: number;
  arrivals?: number;
}
interface BusyReplica {
  count: number;
  cpu: number;
  samples: { at: number; cpu: number }[];
  drainAt?: number;
}
/** No idle-pod objects: ranges describe identical ready/starting replicas. Only admitted identities expand. */
export interface Fleet {
  keda?: import("./keda").KedaState;
  cloud?: CloudState;
  /** Time integrals and a cumulative arrival counter for the A3 request metrics (real units). */
  inFlight: number;
  waiting: number;
  arrivals: number;
  publishedArrivals: number;
  partBudget: CpuPartBudget;
  desired: number;
  ready: number;
  starting: number;
  nextId: number;
  assignmentChanged: boolean;
  lastReadyAt: number;
  active: number;
  unsafe: boolean;
  memoryCredit: number;
  ranges: Cohort[];
  rangeHead: number;
  starts: Cohort[];
  replicaIndex: (Cohort & { state: ReplicaRow["state"] })[];
  replicaRanks: number[];
  replicaIndexDirty: boolean;
  sampledDrains: Cohort[];
  free: number[];
  partial: Set<number>;
  busy: Map<number, BusyReplica>;
  samples: Sample[];
  cpu: number;
  occupancy: number;
  totalCpu: number;
  lastPublish: number;
  nextSync: number;
  paused: boolean;
  pausedAt?: number;
  override: boolean;
  recommendations: { at: number; count: number }[];
  changes: { at: number; delta: number }[];
  decision?: ScalingDecision;
  history: FleetPoint[];
  concurrency: number;
  draining: number;
  busyIds: number[];
  rangesDirty: boolean;
  startupHash?: number;
}
export function createFleet(
  count: number,
  {
    concurrency,
    syncMs = 15_000,
    partBudget = createCpuPartBudget(),
  }: { concurrency: number; syncMs?: number; partBudget?: CpuPartBudget },
): Fleet {
  count = Number.isFinite(count) ? Math.max(0, Math.min(10_000, Math.round(count))) : 0;
  return {
    concurrency,
    partBudget,
    inFlight: 0,
    waiting: 0,
    arrivals: 0,
    publishedArrivals: 0,
    desired: count,
    ready: count,
    starting: 0,
    nextId: count + 1,
    assignmentChanged: false,
    lastReadyAt: -600_000,
    active: 0,
    unsafe: false,
    memoryCredit: 0,
    ranges: count ? [{ first: 1, last: count, at: 0 }] : [],
    rangeHead: 0,
    starts: [],
    replicaIndex: count ? [{ first: 1, last: count, at: 0, state: "ready" }] : [],
    replicaRanks: count ? [count] : [],
    replicaIndexDirty: false,
    sampledDrains: [],
    free: [],
    partial: new Set(),
    busy: new Map(),
    samples: [],
    cpu: 0,
    occupancy: 0,
    totalCpu: 0,
    lastPublish: 0,
    nextSync: syncMs,
    paused: false,
    override: false,
    recommendations: [],
    changes: [],
    history: [],
    draining: 0,
    busyIds: [],
    rangesDirty: false,
  };
}
const before = (a: Cohort, b: Cohort) => a.at < b.at || (a.at === b.at && a.first < b.first);
function pushDue(heap: Cohort[], item: Cohort) {
  let i = heap.length;
  heap.push(item);
  while (i > 0) {
    const p = (i - 1) >>> 1;
    if (!before(item, heap[p])) break;
    heap[i] = heap[p];
    i = p;
  }
  heap[i] = item;
}
function popDue(heap: Cohort[]): Cohort {
  const first = heap[0],
    last = heap.pop()!;
  if (heap.length) {
    let i = 0;
    while (i * 2 + 1 < heap.length) {
      let c = i * 2 + 1;
      if (c + 1 < heap.length && before(heap[c + 1], heap[c])) c++;
      if (!before(heap[c], last)) break;
      heap[i] = heap[c];
      i = c;
    }
    heap[i] = last;
  }
  return first;
}
/** Reconfiguration is the only place that rebuilds reservation eligibility. */
export function configureConcurrency(f: Fleet, concurrency: number): void {
  if (f.concurrency === concurrency) return;
  f.concurrency = concurrency;
  f.partial.clear();
  for (const [id, p] of f.busy) if (p.drainAt === undefined && p.count > 0 && p.count < concurrency) f.partial.add(id);
}
function upperBound(ids: number[], id: number): number {
  let lo = 0,
    hi = ids.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (ids[mid] <= id) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
function forgetReplica(f: Fleet, id: number) {
  f.replicaIndexDirty = true;
  f.busy.delete(id);
  f.busyIds.splice(upperBound(f.busyIds, id) - 1, 1);
}
export function acquireReplica(f: Fleet, concurrency: number): number | undefined {
  configureConcurrency(f, concurrency);
  const partial = f.partial.values().next().value as number | undefined;
  let id = partial ?? f.free.pop();
  if (id === undefined) {
    while (f.rangeHead < f.ranges.length && f.ranges[f.rangeHead].first > f.ranges[f.rangeHead].last) f.rangeHead++;
    if (f.rangeHead > 512 && f.rangeHead * 2 > f.ranges.length) {
      f.ranges.splice(0, f.rangeHead);
      f.rangeHead = 0;
    }
    const range = f.ranges[f.rangeHead];
    if (!range) return undefined;
    id = range.first++;
  }
  if (!f.busy.has(id)) f.busyIds.splice(upperBound(f.busyIds, id), 0, id);
  const busy = f.busy.get(id) ?? { count: 0, cpu: 0, samples: [] };
  busy.count++;
  f.active++;
  f.busy.set(id, busy);
  if (busy.count < concurrency) f.partial.add(id);
  else f.partial.delete(id);
  return id;
}
export function releaseReplica(f: Fleet, id: number | undefined, concurrency: number): void {
  if (id === undefined) return;
  const busy = f.busy.get(id);
  if (!busy) return;
  busy.count--;
  if (busy.drainAt === undefined) f.active--;
  if (busy.drainAt !== undefined) {
    if (!busy.count) {
      forgetReplica(f, id);
      f.draining--;
      f.assignmentChanged = true;
    }
  } else if (!busy.count) {
    f.partial.delete(id);
    f.free.push(id);
  } else if (busy.count < concurrency) f.partial.add(id);
}
/** A scale-1 owner finishes on its original identity before sampled work may reuse it. */
export function recycleIdleReplicas(f: Fleet): void {
  if (!f.free.length) return;
  for (const id of f.free) {
    const replica = f.busy.get(id);
    if (!replica || replica.count) continue;
    forgetReplica(f, id);
    f.partial.delete(id);
    f.ranges.push({ first: id, last: id, at: 0 });
  }
  f.free = [];
  f.ranges = f.ranges
    .slice(f.rangeHead)
    .filter((c) => c.first <= c.last)
    .sort((a, b) => a.first - b.first);
  f.rangeHead = 0;
  f.rangesDirty = true;
}
export function drainingCount(f: Fleet): number {
  return f.draining;
}
function startupSeed(f: Fleet, seed: number, node: string, id: number) {
  if (f.startupHash === undefined) {
    let hash = seed;
    // Hash once, including the complete identity; replica expansion never repeats string work.
    for (let i = 0; i < node.length; i++) hash = Math.imul(hash ^ node.charCodeAt(i), 16777619);
    f.startupHash = hash;
  }
  return mulberry32(f.startupHash ^ id)();
}
/** All identities, including reservations: acquisition changes ownership, never this index's membership.
 * Rebuild at lifecycle transitions; a drain released between transitions marks it dirty once. */
function indexReplicas(f: Fleet) {
  const intervals = [
    ...f.ranges
      .slice(f.rangeHead)
      .filter((c) => c.first <= c.last)
      .map((c) => ({ ...c, state: "ready" as const })),
    ...f.sampledDrains.map((c) => ({ ...c, state: "draining" as const })),
    ...f.starts.map((c) => ({ ...c, state: "starting" as const })),
    ...f.busyIds.map((id) => ({
      first: id,
      last: id,
      at: 0,
      state: f.busy.get(id)?.drainAt === undefined ? ("ready" as const) : ("draining" as const),
    })),
  ].sort((a, b) => a.first - b.first);
  const index: Fleet["replicaIndex"] = [];
  for (const c of intervals) {
    const previous = index.at(-1);
    if (previous && previous.state === c.state && previous.last + 1 === c.first) previous.last = c.last;
    else index.push(c);
  }
  f.replicaIndex = index;
  let count = 0;
  f.replicaRanks = index.map((c) => {
    count += c.last - c.first + 1;
    return count;
  });
  f.replicaIndexDirty = false;
}
export function reconcileFleet(
  f: Fleet,
  desired: number,
  r: ComputeResources,
  now: number,
  seed: number,
  node: string,
): void {
  desired = Number.isFinite(desired) ? Math.max(0, Math.min(10_000, Math.round(desired))) : f.desired;
  f.desired = desired;
  let delta = desired - f.ready - f.starting;
  const lifecycleChanged = delta !== 0;
  if (delta > 0) {
    const first = f.nextId;
    f.nextId += delta;
    f.starting += delta;
    if (!r.startup.jitterFraction) pushDue(f.starts, { first, last: first + delta - 1, at: now + r.startup.delayMs });
    else
      for (let id = first; id < first + delta; id++)
        pushDue(f.starts, {
          first: id,
          last: id,
          at:
            now +
            Math.ceil(
              (r.startup.delayMs * (1 + (startupSeed(f, seed, node, id) * 2 - 1) * r.startup.jitterFraction)) / 10,
            ) *
              10,
        });
  }
  // Cancel the latest unready requests before terminating ready work.
  if (delta < 0 && f.starting) {
    const sorted = f.starts.sort((a, b) => b.first - a.first);
    f.starts = [];
    for (const c of sorted) {
      const remove = Math.min(-delta, c.last - c.first + 1);
      delta += remove;
      f.starting -= remove;
      c.last -= remove;
      if (c.last >= c.first) pushDue(f.starts, c);
    }
  }
  // Empty identities first, then the stable highest busy ID. Counted idle ranges shrink in one operation.
  for (let i = f.ranges.length - 1; delta < 0 && i >= f.rangeHead; i--) {
    const range = f.ranges[i];
    const remove = Math.min(-delta, Math.max(0, range.last - range.first + 1));
    range.last -= remove;
    f.ready -= remove;
    delta += remove;
    if (range.last < range.first) f.ranges.splice(i, 1);
  }
  f.rangeHead = Math.min(f.rangeHead, f.ranges.length);
  while (delta < 0 && f.free.length) {
    const id = f.free.pop()!;
    forgetReplica(f, id);
    f.ready--;
    delta++;
  }
  if (delta < 0)
    for (const [id, busy] of [...f.busy].sort((a, b) => b[0] - a[0])) {
      if (delta >= 0) break;
      if (busy.drainAt !== undefined || !busy.count) continue;
      busy.drainAt = now + r.terminationGraceMs;
      f.draining++;
      f.active -= busy.count;
      f.partial.delete(id);
      f.ready--;
      delta++;
    }
  if (lifecycleChanged) f.replicaIndexDirty = true;
}
/** Readiness jitter stops fragmenting idle work; active sampled boundaries keep their CPU budgets. */
export function compactReadyRanges(f: Fleet, working: readonly SampledWork[] | (() => readonly SampledWork[])) {
  if (!f.rangesDirty) return;
  f.rangesDirty = false;
  if (f.ranges.length - f.rangeHead < 2) return;
  const owners = typeof working === "function" ? working() : working;
  const boundaries = new Set(owners.flatMap((w) => (w.cpuParts ?? []).flatMap((p) => [p.first, p.last + 1])));
  const ranges = f.ranges
    .slice(f.rangeHead)
    .filter((c) => c.first <= c.last)
    .sort((a, b) => a.first - b.first);
  const next: Cohort[] = [];
  for (const range of ranges) {
    const previous = next.at(-1);
    if (previous && previous.last + 1 === range.first && !boundaries.has(range.first)) previous.last = range.last;
    else next.push({ ...range });
  }
  f.ranges = next;
  f.rangeHead = 0;
}
/** Constant idle-tick work. Startup heaps are visited only at due deadlines. Grace checks visit busy identities only. */
export function advanceFleet(
  f: Fleet,
  now: number,
  working: readonly SampledWork[] | (() => readonly SampledWork[]) = [],
): boolean {
  let changed = false;
  while (f.starts.length && f.starts[0].at <= now) {
    const c = popDue(f.starts);
    f.ranges.push(c);
    const count = c.last - c.first + 1;
    f.ready += count;
    f.starting -= count;
    f.lastReadyAt = now;
    changed = true;
  }
  if (changed) {
    f.rangesDirty = true;
    if (!f.starts.length) compactReadyRanges(f, working);
    f.replicaIndexDirty = true;
  }
  return changed;
}
export function chargeCpu(f: Fleet, id: number | undefined, amount: number, ready = true, now = 0) {
  f.totalCpu += amount;
  const replica = id === undefined ? undefined : f.busy.get(id);
  if (replica) {
    replica.cpu += amount;
    const at = Math.ceil(now / 1000) * 1000;
    const last = replica.samples.at(-1);
    if (last?.at === at) last.cpu += amount;
    else replica.samples.push({ at, cpu: amount });
    // Fifteen complete seconds plus the current, unpublished second.
    while (replica.samples.length > 16) replica.samples.shift();
  }
  if (ready && replica?.drainAt === undefined) f.cpu += amount;
}
export function integrateResources(
  f: Fleet,
  occupancy: number,
  now: number,
  step: number,
  requests: { inFlight: number; waiting: number } = { inFlight: 0, waiting: 0 },
) {
  f.occupancy += occupancy * step;
  f.inFlight += requests.inFlight * step;
  f.waiting += requests.waiting * step;
  if (now - f.lastPublish < 1000) return;
  const span = now - f.lastPublish;
  f.samples.push({
    at: now,
    cpu: f.cpu,
    occupancy: f.occupancy / span,
    ready: f.ready,
    inFlight: f.inFlight / span,
    waiting: f.waiting / span,
    arrivals: f.arrivals - f.publishedArrivals,
  });
  if (f.samples.length > 600) f.samples.shift();
  f.cpu = 0;
  f.occupancy = 0;
  f.inFlight = 0;
  f.waiting = 0;
  f.publishedArrivals = f.arrivals;
  f.lastPublish = now;
  f.history.push({ time: now, desired: f.desired, ready: f.ready, starting: f.starting, draining: drainingCount(f) });
  if (f.history.length > 600) f.history.shift();
}
interface WindowSums {
  count: number;
  cpu: number;
  occupancy: number;
  lastOccupancy: number;
  /** Sums of per-replica in-flight and waiting averages (samples with ready replicas), and of arrivals. */
  inFlightPerReady: number;
  waitingPerReady: number;
  readySamples: number;
  arrivals: number;
  from: number;
  until: number;
}
// Window membership changes only at a published-second boundary. Keep live occupancy/CPU outside.
const metricCache = new WeakMap<
  Fleet,
  {
    first?: Sample;
    last?: Sample;
    length: number;
    windows: Map<string, WindowSums>;
  }
>();
export function metricWindow(f: Fleet, end: number, windowMs: number): WindowSums {
  let cache = metricCache.get(f);
  if (!cache || cache.first !== f.samples[0] || cache.last !== f.samples.at(-1) || cache.length !== f.samples.length) {
    cache = { first: f.samples[0], last: f.samples.at(-1), length: f.samples.length, windows: new Map() };
    metricCache.set(f, cache);
  }
  const key = String(windowMs);
  let value = cache.windows.get(key);
  if (!value || end < value.from || end >= value.until) {
    value = {
      count: 0,
      cpu: 0,
      occupancy: 0,
      lastOccupancy: 0,
      inFlightPerReady: 0,
      waitingPerReady: 0,
      readySamples: 0,
      arrivals: 0,
      from: end,
      until: Infinity,
    };
    for (const sample of f.samples) {
      if (sample.at > end) value.until = Math.min(value.until, sample.at);
      if (sample.at + windowMs > end) value.until = Math.min(value.until, sample.at + windowMs);
      if (sample.at > end - windowMs && sample.at <= end) {
        value.count++;
        value.cpu += sample.cpu;
        value.occupancy += sample.occupancy;
        value.lastOccupancy = sample.occupancy;
        value.arrivals += sample.arrivals ?? 0;
        if (sample.ready > 0) {
          value.readySamples++;
          value.inFlightPerReady += (sample.inFlight ?? 0) / sample.ready;
          value.waitingPerReady += (sample.waiting ?? 0) / sample.ready;
        }
      }
    }
    if (cache.windows.size >= 32) cache.windows.clear();
    cache.windows.set(key, value);
  }
  return value;
}
export function metricValue(
  f: Fleet,
  r: ComputeResources,
  m: ScalingMetric,
  now: number,
  scale: number,
): number | undefined {
  const end = now - m.metricDelayMs;
  if (end < m.windowMs || !f.ready) return undefined;
  const window = metricWindow(f, end, m.windowMs);
  if (!window.count) return undefined;
  if (m.source.kind === "pods") {
    if (!window.readySamples) return undefined;
    const absolute = window.inFlightPerReady / window.readySamples;
    return m.target.kind === "averageValue" ? absolute : (absolute / f.concurrency) * 100;
  }
  const cpu = window.cpu / (window.count * 1000);
  const occupancy = scale > 1 ? window.occupancy / window.count : window.lastOccupancy;
  const absolute =
    m.source.resource === "cpu"
      ? (cpu * 1000) / f.ready
      : r.baselineMemoryMiB + (occupancy / f.ready) * r.memoryMiBPerMessage;
  if (m.target.kind === "averageValue") return absolute;
  const denominator = m.source.resource === "cpu" ? r.cpuRequestMilli : r.memoryRequestMiB;
  return denominator ? (absolute / denominator) * 100 : undefined;
}
/** Pure recommendation pipeline, shared by playback and numerical explanation tests. */
export function evaluateHpa(
  f: Fleet,
  c: HpaController,
  r: ComputeResources,
  now: number,
  multiplier = 1,
  scale = 1,
  external:
    | { source: ScalingDecision["source"]; raw: number; missing: boolean; metric?: number; target?: number }
    | undefined = undefined,
  /** Cloud Run's pipeline may idle at zero; HPA and KEDA's generated HPA keep at least one. */
  rangeOverride?: { min: number; max: number },
): ScalingDecision {
  const range = rangeOverride ?? replicaRange(c, multiplier);
  let raw = external?.raw ?? 0,
    missing = external?.missing ?? false,
    metric: number | undefined = external?.metric,
    target: number | undefined = external?.target;
  let binding: ScalingMetric | undefined;
  for (const m of c.settings.metrics) {
    const value = metricValue(f, r, m, now, scale);
    const t = m.target.kind === "utilization" ? m.target.percentOfRequest : m.target.value;
    if (value === undefined) {
      missing = true;
      continue;
    }
    const ratio = value / t;
    const wanted = Math.abs(ratio - 1) <= c.settings.tolerance ? f.desired : Math.ceil(f.ready * ratio);
    // Starting pods are missing samples, conservatively zero for growth and target for shrink.
    const recommendation = wanted < f.desired ? Math.min(f.desired, wanted + f.starting) : wanted;
    if (recommendation >= raw) {
      raw = recommendation;
      metric = value;
      target = t;
      binding = m;
    }
  }
  let reason: ScalingDecision["reason"] = raw === f.desired ? "tolerance" : "target";
  if (
    (missing ||
      f.starting > 0 ||
      now - f.lastReadyAt < Math.max(...c.settings.metrics.map((m) => m.windowMs + m.metricDelayMs))) &&
    raw < f.desired
  ) {
    raw = f.desired;
    reason = "missing";
  }
  raw = Math.max(range.min, raw);
  f.recommendations.push({ at: now, count: raw });
  const historyMs = Math.max(c.settings.up.stabilizationMs, c.settings.down.stabilizationMs);
  f.recommendations = f.recommendations.filter((h) => h.at >= now - historyMs);
  let desired = raw;
  const up = desired > f.desired;
  const behaviour = up ? c.settings.up : c.settings.down;
  const history = f.recommendations.filter((h) => h.at >= now - behaviour.stabilizationMs).map((h) => h.count);
  const stable = up ? Math.max(f.desired, Math.min(...history)) : Math.min(f.desired, Math.max(...history));
  if (stable !== desired) {
    desired = stable;
    reason = "stabilization";
  }
  const period = Math.max(...c.settings.up.policies.concat(c.settings.down.policies).map((p) => p.periodMs));
  f.changes = f.changes.filter((h) => h.at > now - period);
  if (behaviour.selectPolicy === "Disabled") {
    desired = f.desired;
    reason = "policy";
  } else if (desired !== f.desired) {
    const bounds = behaviour.policies.map((p) => {
      const changes = f.changes.filter((h) => h.at > now - p.periodMs);
      const base = f.desired - changes.reduce((sum, h) => sum + h.delta, 0);
      const count = p.type === "Pods" ? p.value : Math.ceil((base * p.value) / 100);
      return up ? base + count : Math.max(0, base - count);
    });
    const bound =
      behaviour.selectPolicy === "Max"
        ? up
          ? Math.max(...bounds)
          : Math.min(...bounds)
        : up
          ? Math.min(...bounds)
          : Math.max(...bounds);
    const limited = up ? Math.max(f.desired, Math.min(desired, bound)) : Math.min(f.desired, Math.max(desired, bound));
    if (limited !== desired) reason = "policy";
    desired = limited;
  }
  if (raw > range.max) reason = "max";
  desired = Math.max(range.min, Math.min(range.max, desired));
  f.nextSync = now + c.settings.syncMs;
  return (f.decision = {
    at: now,
    source: binding?.source.kind ?? external?.source ?? "resource",
    raw,
    desired,
    reason,
    metric,
    target,
    resource: binding?.source.kind === "resource" ? binding.source.resource : undefined,
    ...(binding?.source.kind === "pods"
      ? {
          metricKind:
            binding.target.kind === "averageValue" ? ("busyThreadsPerPod" as const) : ("busyThreads" as const),
        }
      : {}),
    targetKind: binding?.target.kind,
    windowMs: binding?.windowMs,
    metricDelayMs: binding?.metricDelayMs,
    nextAt: f.nextSync,
  });
}
/** Only successfully reconciled proposals consume the controller's scaling policy budget. */
export function commitScalingChange(f: Fleet, previous: number, now: number): void {
  if (f.desired !== previous) f.changes.push({ at: now, delta: f.desired - previous });
}
export function resourceReadout(
  f: Fleet,
  r: ComputeResources,
  occupancy: number,
  now: number,
  scale: number,
): ResourceReadout {
  const metric = (resource: "cpu" | "memory") =>
    metricValue(
      f,
      r,
      {
        source: { kind: "resource", resource },
        target: { kind: "averageValue", value: 1 },
        windowMs: Math.min(15_000, Math.max(1000, Math.floor(now / 1000) * 1000)),
        metricDelayMs: 0,
      },
      now,
      scale,
    );
  const cpu = metric("cpu");
  const allocation = r.cpuLimitMilli ?? r.availableCpuMilli;
  const memory =
    r.baselineMemoryMiB +
    (scale > 1
      ? (metric("memory") ?? r.baselineMemoryMiB) - r.baselineMemoryMiB
      : (occupancy / Math.max(1, f.ready + drainingCount(f))) * r.memoryMiBPerMessage);
  const unsafe = f.unsafe || (r.memoryLimitMiB !== undefined && memory > r.memoryLimitMiB);

  return {
    units: "real",
    cpuRequestPct: cpu !== undefined && r.cpuRequestMilli ? (cpu / r.cpuRequestMilli) * 100 : undefined,
    ...(f.cloud && cpu !== undefined && allocation ? { cpuAllocatedPct: (cpu / allocation) * 100 } : {}),
    memoryMiB: memory,
    memoryRequestPct: r.memoryRequestMiB ? (memory / r.memoryRequestMiB) * 100 : undefined,
    memoryLimitPct: r.memoryLimitMiB ? (memory / r.memoryLimitMiB) * 100 : undefined,
    executedCpuMs: f.totalCpu,
    unsafe,
    estimated: scale > 1,
    ...(unmeasured(r)
      ? {
          unmeasured: true as const,
          cpuRequestPct: undefined,
          cpuAllocatedPct: undefined,
          memoryRequestPct: undefined,
          memoryLimitPct: undefined,
        }
      : {}),
  };
}
/** Keep controller provenance out of the stable public explanation shape. */
function decisionReadout({ source: _source, ...decision }: ScalingDecision): ScalingDecisionReadout {
  return decision;
}
const historyCache = new WeakMap<Fleet, { last?: FleetPoint; points: readonly FleetPoint[] }>();
export function fleetReadout(f: Fleet): FleetReadout {
  let cached = historyCache.get(f);
  const last = f.history.at(-1);
  if (!cached || cached.last !== last) {
    cached = { last, points: Object.freeze(f.history.map((p) => Object.freeze({ ...p }))) };
    historyCache.set(f, cached);
  }
  return {
    desired: f.desired,
    ready: f.ready,
    starting: f.starting,
    draining: drainingCount(f),
    decision: f.decision && decisionReadout(f.decision),
    history: cached.points,
  };
}

/** Only the selected inspector requests a page. Idle ranges never expand in live frames. */
export function replicaPage(f: Fleet, r: ComputeResources, now: number, scale: number, page = 0): ReplicaRow[] {
  const start = Math.max(0, Math.floor(page)) * 50;
  if (f.replicaIndexDirty) indexReplicas(f);
  let lo = 0,
    hi = f.replicaRanks.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (f.replicaRanks[mid] <= start) lo = mid + 1;
    else hi = mid;
  }
  const rows: { id: number; state: ReplicaRow["state"] }[] = [];
  let skip = start - (f.replicaRanks[lo - 1] ?? 0);
  for (let i = lo; i < f.replicaIndex.length && rows.length < 50; i++) {
    const cohort = f.replicaIndex[i];
    for (let id = cohort.first + skip; id <= cohort.last && rows.length < 50; id++)
      rows.push({ id, state: cohort.state });
    skip = 0;
  }
  const estimated = scale > 1 ? resourceReadout(f, r, 0, now, scale) : undefined;
  return rows.map(({ id, state }) => {
    const busy = f.busy.get(id);
    const memory = r.baselineMemoryMiB + (busy?.count ?? 0) * r.memoryMiBPerMessage;
    const end = Math.floor(now / 1000) * 1000;
    const window = Math.max(1000, Math.min(end, 15_000));
    const cpu = busy?.samples.reduce((sum, s) => sum + (s.at > end - window && s.at <= end ? s.cpu : 0), 0) ?? 0;
    if (estimated && state !== "starting") return { ...estimated, id, state };
    return {
      id,
      state,
      units: "real",
      estimated: scale > 1,
      executedCpuMs: busy?.cpu ?? 0,
      memoryMiB: memory,
      cpuRequestPct: r.cpuRequestMilli ? (((cpu / window) * 1000) / r.cpuRequestMilli) * 100 : undefined,
      memoryRequestPct: r.memoryRequestMiB ? (memory / r.memoryRequestMiB) * 100 : undefined,
      memoryLimitPct: r.memoryLimitMiB ? (memory / r.memoryLimitMiB) * 100 : undefined,
      unsafe: r.memoryLimitMiB !== undefined && memory > r.memoryLimitMiB,
      ...(unmeasured(r)
        ? {
            unmeasured: true as const,
            cpuRequestPct: undefined,
            memoryRequestPct: undefined,
            memoryLimitPct: undefined,
          }
        : {}),
    };
  });
}
