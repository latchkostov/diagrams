import { replicaRange } from "../model/autoscaling";
import type { AutoscalingConfig, ComputeResources } from "../model/autoscaling";
import { MAX_CPU_PARTS, type CpuPartBudget } from "./resourceWork";
import type { Fleet } from "./autoscaling";
import type { ResourceWork } from "./resourceWork";
import type { LedgerState, ThreadTail } from "./ledger";

export interface LedgerInvariantState {
  time: number;
  ledger: LedgerState;
  nodes: Iterable<{ id: string; activeMs: number }>;
  edges: Iterable<{
    id: string;
    poolUsed: number;
    poolLeases: ReadonlyMap<number, number>;
    poolPending: readonly unknown[];
  }>;
  inSystem: number;
  admissionInFlight: ReadonlyMap<string, number>;
  partBudget: CpuPartBudget;
  logical: readonly { id: number; end: number }[];
}
export interface OutcomeInvariantState {
  time: number;
  attempts: Iterable<{
    id: number;
    node: string;
    outcome?: { ok: boolean; code?: number; at: number };
    committed: boolean;
  }>;
}

/** Independent index/ownership oracle. Only tests opt into this traversal. */
export function assertLedgerInvariants({ ledger, nodes, edges, time }: LedgerInvariantState): void {
  const check = (ok: boolean, message: string) => {
    if (!ok) throw new Error(`Ledger @${time}: ${message}`);
  };
  const clocks = new Map([...nodes].map((node) => [node.id, node.activeMs]));
  const pools = new Map<string, number>();
  for (const [id, reservation] of ledger.reservations) {
    const owner = ledger.owners.get(reservation.owner);
    check(id === reservation.id && !!owner?.reservations.has(id), "orphan reservation");
    check(
      Number.isFinite(reservation.weight) && reservation.weight > 0 && reservation.weight <= reservation.represented,
      "invalid weight",
    );
    check(clocks.has(reservation.owner), "unknown owner");
    if (reservation.releaseAt !== undefined) {
      check(Number.isFinite(reservation.releaseAt), "invalid release time");
      check(reservation.weight < reservation.represented, "full-weight reservation retained a release");
      check(owner!.indices.has(id), "retired reservation has no release");
    } else check(!owner!.indices.has(id), "live reservation has a release");
    if (reservation.scope === "pool") {
      check(reservation.edge !== undefined, "pool has no edge");
      pools.set(reservation.edge!, (pools.get(reservation.edge!) ?? 0) + reservation.weight);
    }
  }
  for (const [ownerId, owner] of ledger.owners) {
    check(owner.reservations.size > 0, "empty owner retained");
    for (const id of owner.reservations)
      check(ledger.reservations.get(id)?.owner === ownerId, "owner points to missing reservation");
    check(owner.heap.length === owner.indices.size, "heap index size disagrees");
    owner.heap.forEach((due, index) => {
      const reservation = ledger.reservations.get(due.id);
      check(reservation?.owner === ownerId && reservation.releaseAt === due.end, "orphan release");
      check(owner.indices.get(due.id) === index, "heap index disagrees");
      check(due.end > clocks.get(ownerId)! + 1e-9, "due release retained");
      if (index) {
        const parent = owner.heap[(index - 1) >>> 1];
        check(parent.end < due.end || (parent.end === due.end && parent.id < due.id), "heap order disagrees");
      }
    });
  }
  for (const edge of edges) {
    check(Math.abs(edge.poolUsed - (pools.get(edge.id) ?? 0)) < 1e-8, "pool occupancy disagrees");
    for (const id of edge.poolLeases.values())
      check(ledger.reservations.get(id)?.edge === edge.id, "pool points to missing reservation");
    pools.delete(edge.id);
  }
  check(pools.size === 0, "unknown pool edge");
}

/** R2's attempt oracle: an outcome can be committed only after it is decided, once per attempt. */
const observedOutcomes = new WeakMap<object, { outcome?: string; committed: boolean }>();
export function assertOutcomeInvariants(state: OutcomeInvariantState): void {
  const seen = new Set<number>();
  for (const attempt of state.attempts) {
    if (seen.has(attempt.id) || (attempt.committed && !attempt.outcome) || (attempt.outcome?.at ?? 0) > state.time)
      throw new Error(`Outcome @${state.time}: invalid attempt ${attempt.id} at ${attempt.node}`);
    seen.add(attempt.id);
    const before = observedOutcomes.get(attempt);
    const outcome = attempt.outcome && JSON.stringify(attempt.outcome);
    if ((before?.outcome !== undefined && before.outcome !== outcome) || (before?.committed && !attempt.committed))
      throw new Error(`Outcome @${state.time}: attempt ${attempt.id} changed after settlement`);
    observedOutcomes.set(attempt, { outcome, committed: attempt.committed });
  }
}

interface Work extends ResourceWork {
  slotted?: boolean;
  delivery?: unknown;
  held?: boolean;
  reservation?: ThreadTail<unknown>["reservation"];
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
    /** The node's own queue, without staged deliveries. */
    queue?: Iterable<Work>;
    groups?: readonly { active: number; pending: { length: number } }[];
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
const previousDesired = new WeakMap<Fleet, number>();
/** A3: cooldown clocks as they stood before this step, to judge the step's own decision. */
const previousCloud = new WeakMap<Fleet, { inCooldownUntil?: number[]; lastScaleAt?: number }>();
const reservationAttempts = new WeakMap<Fleet, Map<Work, number>>();
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
    for (const g of node.groups ?? []) fail(g.pending.length >= 0 && g.active >= 0, "negative broker lag");
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
    const previousCount = previousDesired.get(f);
    previousDesired.set(f, f.desired);
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
    // Pushed requests and broker deliveries share the queue: every queued delivery holds its group slot, which is
    // what lets request-rate scalers count waiting requests without scanning the queue.
    fail(
      [...(node.queue ?? [])].every((w) => !w.delivery || w.held === true),
      "queued delivery holds no group slot",
    );
    const before = previousCloud.get(f);
    const cloudState = f.cloud;
    previousCloud.set(f, {
      inCooldownUntil: cloudState?.kind === "ecs" ? [...cloudState.inCooldownUntil] : undefined,
      lastScaleAt: cloudState?.kind === "appService" ? cloudState.lastScaleAt : undefined,
    });
    const decided = f.decision?.at === state.time ? f.decision : undefined;
    if (a?.mode === "on" && !f.override && decided && previousCount !== undefined && f.desired !== previousCount) {
      const c = a.controller;
      // A count outside the range (an override just resumed, or a lowered maximum) is clamped to the bound
      // without a metric or rule: that move is the range's, not the policy's.
      const bounds = replicaRange(c, state.capacityMultiplier);
      const clamped =
        (previousCount > bounds.max && f.desired === bounds.max) ||
        (previousCount < bounds.min && f.desired === bounds.min);
      if (c.kind === "ecs" && decided.adapter === "ecs" && f.desired < previousCount && !clamped) {
        fail(decided.metric !== undefined && Number.isFinite(decided.metric), "ECS scaled in on missing data");
        fail(
          decided.policy === undefined || (before?.inCooldownUntil?.[decided.policy] ?? -1) <= state.time,
          "ECS scaled in during its scale-in cooldown",
        );
      }
      if (c.kind === "appService" && decided.adapter === "appService" && decided.policy !== undefined && !clamped) {
        const rule = c.rules[decided.policy];
        fail(
          before?.lastScaleAt === undefined || before.lastScaleAt + rule.cooldownMs <= state.time,
          "Monitor rule acted inside its cooldown",
        );
        fail(
          f.desired > previousCount === (rule.direction === "increase"),
          "Monitor rule scaled against its direction",
        );
      }
      if (decided.reason === "request")
        fail(
          f.desired > previousCount && (c.kind === "cloudRun" || c.kind === "aca"),
          "request wake on a non-request scaler",
        );
    }
    if (a?.mode === "on" && !f.override) {
      const range = replicaRange(a.controller, state.capacityMultiplier);
      const idle =
        f.desired === 0 && (range.min === 0 || (a.controller.kind === "keda" && a.controller.idleReplicas === 0));
      // A resumed controller owns the count from its first evaluation; until then the override stands.
      const resumed = !f.decision || f.decision.reason === "override";
      fail(resumed || ((f.desired >= range.min || idle) && f.desired <= range.max), "desired outside HPA bounds");
      if (idle && f.decision?.reason === "inactive" && f.decision.at === state.time && f.keda) {
        fail(!f.keda.active, "zero while activation is true");
        // An initially sleeping fleet may remain asleep before it has ever activated.
        if ((previousCount ?? 0) > 0)
          fail(
            f.decision.at >=
              (f.keda.lastActive === undefined
                ? f.keda.createdAt + (a.controller.kind === "keda" ? a.controller.initialCooldownMs : 0)
                : f.keda.lastActive + ("cooldownMs" in a.controller ? a.controller.cooldownMs : 0)),
            "zero before cooldown elapsed",
          );
      }
    }
    fail(
      queued.every((w) => w.replica === undefined && w.cpuParts === undefined),
      "queued work owns a reservation",
    );
    const reservations = new Map<number, number>();
    const previousAttempts = reservationAttempts.get(f);
    const acquired = new Set<number>();
    for (const work of node.working) {
      if (work.reservation) {
        fail(work.reservation.scope === "thread" && work.reservation.releaseAt !== undefined, "invalid thread tail");
        fail(!!work.cpuParts?.length, "resource-backed thread tail has no CPU ownership");
      } else if (state.scale === 1) fail(work.replica !== undefined, "working attempt has no reservation");
      if (work.replica !== undefined) {
        reservations.set(work.replica, (reservations.get(work.replica) ?? 0) + 1);
        if (previousAttempts && previousAttempts.get(work) !== work.replica) acquired.add(work.replica);
      }
      fail((work.cpuRemaining ?? 0) >= -1e-8 && Number.isFinite(work.cpuRemaining ?? 0), "invalid CPU remaining");
      parts += work.cpuParts?.length ?? 0;
      for (const p of work.cpuParts ?? [])
        fail(p.first <= p.last && p.cpu >= -1e-8 && Number.isFinite(p.cpu), "invalid sampled CPU part");
    }
    if (state.scale > 1) {
      const previous = memoryClocks.get(f);
      const capacity = Math.min(
        node.activeReplicas * node.props.concurrency,
        node.props.admission?.slots ?? Infinity,
        node.props.admission?.api.maxInFlight ?? Infinity,
      );
      const retained = new Set(
        node.working.filter(
          (w) => w.cpuParts?.length && (w.cpuBackoffUntil !== undefined || (w.memorySlots ?? 0) > capacity),
        ),
      );
      const allowance = Math.max(
        capacity,
        Math.min(
          node.working.length * state.scale,
          node.working.reduce((max, w) => Math.max(max, w.memorySlots ?? 0), 0),
        ),
      );
      if (previous?.up && node.status === "up") {
        const continuous = [...retained].filter((w) => previous.retained.has(w)).length;
        const occupancy = Math.min(continuous * state.scale, allowance, previous.capacity);
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
        capacity: allowance,
      });
    }
    let active = 0,
      memory = 0;
    const r = node.props.resources;
    for (const [id, p] of f.busy) {
      fail(p.count >= 0 && p.count === (reservations.get(id) ?? 0), "orphan or negative reservation");
      // Lowering concurrency may leave existing attempts draining naturally; no new acquisition may overbook.
      if (acquired.has(id)) fail(p.count <= node.props.concurrency, "new reservation exceeds replica concurrency");
      if (p.drainAt === undefined) active += p.count;
      memory += r.baselineMemoryMiB + p.count * r.memoryMiBPerMessage;
    }
    reservationAttempts.set(
      f,
      new Map(node.working.flatMap((w) => (w.replica === undefined ? [] : [[w, w.replica] as const]))),
    );
    fail(active === f.active && active >= 0, "active reservation count disagrees");
    if (state.scale === 1) {
      fail(
        [...reservations.keys()].every((id) => f.busy.has(id)),
        "reservation has no live replica",
      );
      memory += (f.ready + f.draining - f.busy.size) * r.baselineMemoryMiB;
      fail(
        Math.abs(
          memory -
            ((f.ready + f.draining) * r.baselineMemoryMiB +
              node.working.filter((w) => !w.reservation).length * r.memoryMiBPerMessage),
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
