import { replicaRange } from "../model/autoscaling";
import type { AutoscalingConfig, ComputeResources } from "../model/autoscaling";
import { MAX_CPU_PARTS, type CpuPartBudget } from "./resourceWork";
import type { Fleet } from "./autoscaling";
import type { ResourceWork } from "./resourceWork";

interface Work extends ResourceWork {
  slotted?: boolean;
}
export interface ResourceState {
  time: number;
  scale: number;
  capacityMultiplier: number;
  partBudget: CpuPartBudget;
  nodes: Iterable<{
    id: string;
    status: string;
    activeReplicas: number;
    fleet?: Fleet;
    props: {
      concurrency: number;
      resources?: ComputeResources;
      autoscaling?: AutoscalingConfig;
      admission?: { slots?: number; api: { maxInFlight?: number } };
    };
    working: readonly Work[];
    pending: Iterable<Work>;
  }>;
}
const pausedClocks = new WeakMap<
  Fleet,
  { time: number; pausedAt: number; cpu: number; deadlines: Map<Work, { cpu?: number; admission?: number }> }
>();
const memoryClocks = new WeakMap<
  Fleet,
  { published: number; occupancy: number; retained: Set<Work>; up: boolean; capacity: number }
>();
const reservationCounts = new WeakMap<Fleet, Map<number, number>>();
/** Opt-in diagnostic: independent ownership/counting oracle, never run in ordinary playback. */
export function assertResourceInvariants(state: ResourceState) {
  const check = (ok: boolean, message: string) => {
    if (!ok) throw new Error(message);
  };
  let parts = 0;
  for (const node of state.nodes) {
    const f = node.fleet;
    const queued = [...node.pending];
    const all = [...node.working, ...queued];
    const fail = (ok: boolean, message: string) => check(ok, `${node.id} @${state.time}: ${message}`);
    if (!node.props.resources) {
      fail(
        !f &&
          all.every(
            (w) =>
              w.replica === undefined &&
              w.cpuRemaining === undefined &&
              w.cpuParts === undefined &&
              w.cpuBackoffUntil === undefined,
          ),
        "disabled resources own work",
      );
      continue;
    }
    fail(!!f, "enabled resources have no fleet");
    if (!f) continue;
    fail(
      f.paused === (node.status === "paused") && (node.status !== "paused" || f.pausedAt !== undefined),
      "fleet pause clock disagrees with node",
    );
    const frozen = pausedClocks.get(f);
    if (frozen && node.status === "paused") fail(f.totalCpu === frozen.cpu, "CPU advanced while paused");
    if (frozen && node.status !== "paused") {
      const duration = frozen.time - frozen.pausedAt;
      for (const work of node.working) {
        const old = frozen.deadlines.get(work);
        if (old?.cpu !== undefined && old.cpu > frozen.pausedAt + 10)
          fail(work.cpuBackoffUntil === old.cpu + duration, "CPU backoff lost paused time");
        if (old?.admission !== undefined && old.admission > frozen.pausedAt + 10)
          fail(work.retryAdmissionAt === old.admission + duration, "retry admission lost paused time");
      }
    }
    if (node.status === "paused")
      pausedClocks.set(f, {
        time: state.time,
        pausedAt: f.pausedAt!,
        cpu: f.totalCpu,
        deadlines: new Map(
          node.working.map((work) => [work, { cpu: work.cpuBackoffUntil, admission: work.retryAdmissionAt }]),
        ),
      });
    else pausedClocks.delete(f);
    const size = (c: { first: number; last: number }) => Math.max(0, c.last - c.first + 1);
    const busy = [...f.busy.values()];
    const ready =
      f.ranges.slice(f.rangeHead).reduce((sum, c) => sum + size(c), 0) +
      busy.filter((p) => p.drainAt === undefined).length;
    const starting = f.starts.reduce((sum, c) => sum + size(c), 0);
    const draining =
      f.sampledDrains.reduce((sum, c) => sum + size(c), 0) + busy.filter((p) => p.drainAt !== undefined).length;
    const identities = [
      ...f.ranges.slice(f.rangeHead).filter((c) => size(c) > 0),
      ...f.starts,
      ...f.sampledDrains,
      ...[...f.busy.keys()].map((id) => ({ first: id, last: id })),
    ].sort((a, b) => a.first - b.first);
    fail(
      identities.every((c, i) => size(c) > 0 && (!i || identities[i - 1].last < c.first)),
      "replica identities overlap",
    );
    fail(ready === f.ready && starting === f.starting && draining === f.draining, "replica state totals disagree");
    fail(ready + starting === f.desired, "desired differs from ready + starting");
    const a = node.props.autoscaling;
    if (a?.mode === "on" && !f.override) {
      const range = replicaRange(a.controller, state.capacityMultiplier);
      fail(f.desired >= range.min && f.desired <= range.max, "desired outside HPA bounds");
    }
    fail(
      queued.every((w) => w.replica === undefined && w.cpuParts === undefined),
      "queued work owns a reservation",
    );
    const reservations = new Map<number, number>();
    for (const work of node.working) {
      if (state.scale === 1) fail(work.replica !== undefined, "working attempt has no reservation");
      if (work.replica !== undefined) reservations.set(work.replica, (reservations.get(work.replica) ?? 0) + 1);
      fail((work.cpuRemaining ?? 0) >= -1e-8 && Number.isFinite(work.cpuRemaining ?? 0), "invalid CPU remaining");
      parts += work.cpuParts?.length ?? 0;
      for (const p of work.cpuParts ?? [])
        fail(p.first <= p.last && p.cpu >= -1e-8 && Number.isFinite(p.cpu), "invalid sampled CPU part");
    }
    if (state.scale > 1) {
      const retained = new Set(node.working.filter((w) => w.cpuParts?.length && w.cpuBackoffUntil !== undefined));
      const previous = memoryClocks.get(f);
      const capacity = Math.min(
        node.activeReplicas * node.props.concurrency,
        node.props.admission?.slots ?? Infinity,
        node.props.admission?.api.maxInFlight ?? Infinity,
      );
      if (previous?.up && node.status === "up") {
        const continuous = [...retained].filter((w) => previous.retained.has(w)).length;
        const occupancy = Math.min(continuous * state.scale, capacity, previous.capacity);
        const integrated =
          f.lastPublish === previous.published
            ? f.occupancy - previous.occupancy
            : (f.samples.at(-1)?.occupancy ?? 0) * (f.lastPublish - previous.published) -
              previous.occupancy +
              f.occupancy;
        fail(integrated + 1e-6 >= occupancy * 10, "retained retry lost sampled memory residence");
      }
      memoryClocks.set(f, {
        published: f.lastPublish,
        occupancy: f.occupancy,
        retained,
        up: node.status === "up",
        capacity,
      });
    }
    let active = 0,
      memory = 0;
    const r = node.props.resources;
    const previousCounts = reservationCounts.get(f);
    for (const [id, p] of f.busy) {
      fail(p.count >= 0 && p.count === (reservations.get(id) ?? 0), "orphan or negative reservation");
      // Lowering concurrency may leave existing attempts draining naturally; no new acquisition may overbook.
      if (previousCounts && p.count > (previousCounts.get(id) ?? 0))
        fail(p.count <= node.props.concurrency, "new reservation exceeds replica concurrency");
      if (p.drainAt === undefined) active += p.count;
      memory += r.baselineMemoryMiB + p.count * r.memoryMiBPerMessage;
    }
    reservationCounts.set(f, new Map([...f.busy].map(([id, p]) => [id, p.count])));
    fail(active === f.active && active >= 0, "active reservation count disagrees");
    if (state.scale === 1) {
      fail(
        [...reservations.keys()].every((id) => f.busy.has(id)),
        "reservation has no live replica",
      );
      memory += (f.ready + f.draining - f.busy.size) * r.baselineMemoryMiB;
      fail(
        Math.abs(
          memory - ((f.ready + f.draining) * r.baselineMemoryMiB + node.working.length * r.memoryMiBPerMessage),
        ) < 1e-6,
        "memory differs from baseline + in-flight work",
      );
    }
    for (const value of [
      f.desired,
      f.ready,
      f.starting,
      f.draining,
      f.active,
      f.cpu,
      f.occupancy,
      f.memoryCredit,
      f.totalCpu,
    ])
      fail(Number.isFinite(value) && value >= -1e-8, "nonfinite/negative fleet metric");
    for (const sample of f.samples) fail(Object.values(sample).every(Number.isFinite), "nonfinite sample");
    for (const value of Object.values(f.decision ?? {}))
      if (typeof value === "number") fail(Number.isFinite(value), "nonfinite decision");
    if (node.status === "up") {
      for (const c of f.starts) fail(c.at >= state.time, "startup deadline in the past after resume");
      for (const p of f.busy.values())
        if (p.drainAt !== undefined) fail(p.drainAt >= state.time, "drain deadline in the past after resume");
    }
  }
  check(
    parts === state.partBudget.used && parts <= MAX_CPU_PARTS && parts >= 0,
    `CPU part budget disagrees: ${parts}/${state.partBudget.used}`,
  );
}
