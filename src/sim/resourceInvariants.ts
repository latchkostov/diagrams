import { replicaRange } from "../model/autoscaling";
import type { AutoscalingConfig, ComputeResources } from "../model/autoscaling";
import { MAX_CPU_PARTS, ownsCpu, type CpuPartBudget } from "./resourceWork";
import type { Fleet } from "./autoscaling";
import type { ResourceWork } from "./resourceWork";
import { occupancyFraction, type LedgerState, type Reservation } from "./ledger";
import { STEP } from "./timing";

export interface LedgerInvariantState {
  time: number;
  ledger: LedgerState;
  nodes: Iterable<{
    id: string;
    activeMs: number;
    threadWeight?: Record<"work" | "wait", number>;
    requestWeight?: number;
  }>;
  edges: Iterable<{
    id: string;
    calls?: { inFlight: number };
    poolUsed: number;
    poolLeases: ReadonlyMap<number, number>;
    poolPending: readonly {
      message?: { width?: number };
      call?: { held?: boolean; work: { thread?: number; message?: { width?: number } } };
    }[];
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
    outcome?: { ok: boolean; code?: number; at: number; cause?: string };
    committed: boolean;
  }>;
}

/** Independent index/ownership oracle. Only tests opt into this traversal. */
export function assertLedgerInvariants({ ledger, nodes, edges, time }: LedgerInvariantState): void {
  const check = (ok: boolean, message: string) => {
    if (!ok) throw new Error(`Ledger @${time}: ${message}`);
  };
  const nodeList = [...nodes];
  const clocks = new Map(nodeList.map((node) => [node.id, node.activeMs]));
  const threads = new Map<string, Record<"work" | "wait", number>>();
  const pools = new Map<string, number>();
  const sent = new Map<string, number>();
  const requests = new Map<string, number>();
  for (const [id, reservation] of ledger.reservations) {
    const owner = ledger.owners.get(reservation.owner);
    check(id === reservation.id && !!owner?.reservations.has(id), "orphan reservation");
    check(
      Number.isFinite(reservation.weight) && reservation.weight > 0 && reservation.weight <= reservation.represented,
      "invalid weight",
    );
    check(clocks.has(reservation.owner), "unknown owner");
    check(reservation.room >= Math.min(1, reservation.represented), "reserved without room");
    check(reservation.weight <= reservation.room && reservation.weight <= reservation.cap, "reservation exceeds gate");
    if (reservation.unscaledWaitMs !== undefined)
      check(
        reservation.scope === "thread" &&
          Number.isFinite(reservation.unscaledWaitMs) &&
          reservation.unscaledWaitMs >= 0 &&
          reservation.unscaledWaitMs <=
            reservation.heldMs +
              Math.max(0, clocks.get(reservation.owner)! - (reservation.segmentActive ?? reservation.startActive)) +
              1e-9,
        "paced queue credit exceeds active thread residence",
      );
    if (reservation.scope === "request")
      requests.set(reservation.owner, (requests.get(reservation.owner) ?? 0) + reservation.weight);
    if (reservation.scope === "thread") {
      check(reservation.weight <= reservation.requestWeight!, "thread exceeds request lease");
      const sums = threads.get(reservation.owner) ?? { work: 0, wait: 0 };
      sums[reservation.phase] += reservation.weight;
      threads.set(reservation.owner, sums);
    }
    if (reservation.releaseAt !== undefined) {
      check(Number.isFinite(reservation.releaseAt), "invalid release time");
      check(reservation.releaseAt >= reservation.retiredActive!, "release precedes retirement");
      check(reservation.weight < reservation.represented, "full-weight reservation retained a release");
      check(owner!.indices.has(id), "retired reservation has no release");
    } else check(!owner!.indices.has(id), "live reservation has a release");
    if (reservation.scope === "pool") {
      check(reservation.edge !== undefined, "pool has no edge");
      pools.set(reservation.edge!, (pools.get(reservation.edge!) ?? 0) + reservation.weight);
      sent.set(reservation.edge!, (sent.get(reservation.edge!) ?? 0) + occupancyFraction(reservation));
    }
  }
  for (const node of nodeList) {
    if (node.requestWeight !== undefined)
      check(Math.abs(node.requestWeight - (requests.get(node.id) ?? 0)) < 1e-8, "request aggregate disagrees");
    if (node.threadWeight) {
      const sums = threads.get(node.id) ?? { work: 0, wait: 0 };
      for (const phase of ["work", "wait"] as const)
        check(Math.abs(sums[phase] - node.threadWeight[phase]) < 1e-8, "thread aggregate disagrees");
    }
  }
  for (const [ownerId, owner] of ledger.owners) {
    check(owner.reservations.size > 0 || owner.credits.size > 0, "empty owner retained");
    for (const credits of owner.credits.values()) {
      check(credits.length > 0, "empty credits retained");
      for (const credit of credits) {
        check(Number.isFinite(credit.weight) && credit.weight > 0, "invalid credit weight");
        check(Number.isFinite(credit.freeAt) && credit.freeAt > clocks.get(ownerId)!, "expired credit retained");
      }
    }
    for (const id of owner.reservations)
      check(ledger.reservations.get(id)?.owner === ownerId, "owner points to missing reservation");
    check(owner.heap.length === owner.indices.size, "heap index size disagrees");
    owner.heap.forEach((due, index) => {
      const reservation = ledger.reservations.get(due.id);
      check(
        reservation?.owner === ownerId && reservation.releaseAt! + (reservation.admissionLagMs ?? 0) === due.end,
        "orphan release",
      );
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
    // Calls in flight are dots: a lease's share of its cohort, a partial dot's counted at its own size.
    if (edge.calls)
      check(
        Math.abs(edge.calls.inFlight - (sent.get(edge.id) ?? 0)) < 1e-8,
        "calls in flight disagree with pool leases",
      );
    // Width never increases along a path: a branch is no wider than its caller's
    // incoming cohort, nor than the caller thread a blocking call still holds.
    for (const { message, call } of edge.poolPending) {
      const width = message?.width ?? Infinity;
      check(width <= (call?.work.message?.width ?? Infinity) + 1e-9, "branch widens its cohort");
      const thread =
        call?.held && call.work.thread !== undefined ? ledger.reservations.get(call.work.thread) : undefined;
      check(!thread || width <= thread.weight + 1e-9, "branch is wider than its caller thread");
    }
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
    // A classified attempt is one write: its cause and ok can never disagree (a stale success on a failure).
    if (attempt.outcome?.cause !== undefined && attempt.outcome.ok !== (attempt.outcome.cause === "success"))
      throw new Error(`Outcome @${state.time}: attempt ${attempt.id} at ${attempt.node} is ${attempt.outcome.cause}`);
    seen.add(attempt.id);
    const before = observedOutcomes.get(attempt);
    const outcome = attempt.outcome && JSON.stringify(attempt.outcome);
    if ((before?.outcome !== undefined && before.outcome !== outcome) || (before?.committed && !attempt.committed))
      throw new Error(`Outcome @${state.time}: attempt ${attempt.id} changed after settlement`);
    observedOutcomes.set(attempt, { outcome, committed: attempt.committed });
  }
}

interface Work extends ResourceWork {
  message?: { width?: number; represented?: number };
  thread?: number;
  executionWeight?: number;
  workSegment?: boolean;
  weight?: number;
  resumeAtAdmission?: boolean;
  slotted?: boolean;
  delivery?: unknown;
  held?: boolean;
  scope?: Reservation["scope"];
  releaseAt?: number;
}
export interface CpuTick {
  before: number;
  capacityMs: number;
  /** Yielding tails' owed CPU before they share the leftover, and the tick's budgets after. */
  tails?: { budgets: ReadonlyMap<number | string, { remaining: number }>; owed: ReadonlyMap<ResourceWork, number> };
  charges: {
    before: number;
    after: number;
    logicalBefore?: number;
    logicalAfter?: number;
    backlogBefore: number;
    backlogAfter?: number;
    eligible: boolean;
    weight?: number;
    cpuMs?: number;
  }[];
}
export interface ResourceState {
  ledger?: LedgerState;
  time: number;
  scale: number;
  capacityMultiplier: number;
  partBudget: CpuPartBudget;
  admission?: {
    inFlight: ReadonlyMap<string, number>;
    limits: ReadonlyMap<string, number>;
    retainedExcess?: ReadonlyMap<string, number>;
    leases: Iterable<{ keys?: string[]; weight: number }>;
  };
  nodes: Iterable<{
    id: string;
    status: string;
    activeReplicas: number;
    fleet?: Fleet;
    cpuTick?: CpuTick;
    executionLedger?: boolean;
    cpuTail?: ReadonlySet<ResourceWork>;
    props: {
      concurrency: number;
      resources?: ComputeResources;
      autoscaling?: AutoscalingConfig;
      admission?: { slots?: number; api: { maxInFlight?: number } };
    };
    working: readonly Work[];
    workQueues?: { working: Iterable<Work>; pending: Iterable<Work>; takeovers: Iterable<Work> };
    /** Dots of the working set, cached so occupancy reads are constant-time. */
    workingUnits?: number;
    /** Dots of the node's queue, continuations and staged deliveries, cached for the prefetch window and backlog. */
    pendingUnits?: number;
    resumeUnits?: number;
    stagedUnits?: number;
    resume?: Iterable<Work>;
    /** Dots on the way to the node, cached, and the messages on the way. */
    incomingUnits?: number;
    arriving?: Iterable<{ represented?: number }>;
    threadTails?: ReadonlyMap<number, Reservation<unknown>>;
    threadWeight?: Record<"work" | "wait", number>;
    pending: Iterable<Work>;
    /** The node's own queue, without staged deliveries. */
    queue?: Iterable<Work>;
    groups?: readonly {
      active: number;
      pending: { length: number } & Partial<Iterable<{ represented?: number }>>;
      /** Dots of the group's queue, cached; staged deliveries by consumer. */
      pendingUnits?: number;
      staged?: ReadonlyMap<string, Iterable<Work>>;
    }[];
  }>;
}
const pausedClocks = new WeakMap<
  Fleet,
  { time: number; pausedAt: number; cpu: number; deadlines: Map<Work, { cpu?: number; admission?: number }> }
>();
const memoryClocks = new WeakMap<
  Fleet,
  {
    published: number;
    occupancy: number;
    retained: Map<Work, { weight: number; thread?: number }>;
    up: boolean;
    capacity: number;
  }
>();
const previousDesired = new WeakMap<Fleet, number>();
/** A3: cooldown clocks as they stood before this step, to judge the step's own decision. */
const previousCloud = new WeakMap<Fleet, { inCooldownUntil?: number[]; lastScaleAt?: number }>();
const reservationAttempts = new WeakMap<Fleet, Map<Work, number>>();
/** Admission ownership oracle shared by the resource and command-model checks. */
export function assertAdmissionInvariants(state: Pick<ResourceState, "time" | "admission">): void {
  const check = (ok: boolean, message: string) => {
    if (!ok) throw new Error(message);
  };
  if (state.admission) {
    const { inFlight, limits, leases, retainedExcess } = state.admission;
    const held = new Map<string, number>();
    for (const lease of leases) for (const key of lease.keys ?? []) held.set(key, (held.get(key) ?? 0) + lease.weight);
    for (const key of new Set([...held.keys(), ...inFlight.keys()])) {
      const occupancy = inFlight.get(key) ?? 0;
      check(
        Math.abs(occupancy - (held.get(key) ?? 0)) < 1e-8,
        `Admission @${state.time}: lease occupancy disagrees for ${key}`,
      );
      check(
        occupancy <= (limits.get(key) ?? Infinity) + (retainedExcess?.get(key) ?? 0) + 1e-8,
        `Admission @${state.time}: capacity exceeded for ${key}`,
      );
    }
  }
}

/** Opt-in diagnostic: independent ownership/counting oracle, never run in ordinary playback. */
export function assertResourceInvariants(state: ResourceState) {
  const check = (ok: boolean, message: string) => {
    if (!ok) throw new Error(message);
  };
  assertAdmissionInvariants(state);
  // Cached dot counters equal a recount at the current scale (a partial dot's share is represented / scale).
  const dotsOf = (message?: { represented?: number }) =>
    message?.represented === undefined ? 1 : message.represented / state.scale;
  const sumDots = (items: Iterable<Work>) => {
    let dots = 0;
    for (const work of items) dots += dotsOf(work.message);
    return dots;
  };
  const stagedDots = new Map<string, number>();
  for (const node of state.nodes)
    for (const group of node.groups ?? []) {
      if (group.pendingUnits !== undefined && group.pending[Symbol.iterator]) {
        let dots = 0;
        for (const message of group.pending as Iterable<{ represented?: number }>) dots += dotsOf(message);
        check(
          Math.abs(group.pendingUnits - dots) <= 1e-9,
          `${node.id} @${state.time}: cached group units ${group.pendingUnits} != ${dots}`,
        );
      }
      for (const [id, queue] of group.staged ?? []) stagedDots.set(id, (stagedDots.get(id) ?? 0) + sumDots(queue));
    }
  for (const node of state.nodes) {
    const cached = (value: number | undefined, items: Iterable<Work> | undefined, what: string) => {
      if (value === undefined || !items) return;
      const dots = sumDots(items);
      check(Math.abs(value - dots) <= 1e-9, `${node.id} @${state.time}: cached ${what} units ${value} != ${dots}`);
    };
    cached(node.pendingUnits, node.queue, "pending");
    cached(node.resumeUnits, node.resume, "resume");
    if (node.incomingUnits !== undefined && node.arriving) {
      let dots = 0;
      for (const message of node.arriving) dots += dotsOf(message);
      check(
        Math.abs(node.incomingUnits - dots) <= 1e-9,
        `${node.id} @${state.time}: cached incoming units ${node.incomingUnits} != ${dots}`,
      );
    }
    if (node.stagedUnits !== undefined) {
      const dots = stagedDots.get(node.id) ?? 0;
      check(
        Math.abs(node.stagedUnits - dots) <= 1e-9,
        `${node.id} @${state.time}: cached staged units ${node.stagedUnits} != ${dots}`,
      );
    }
  }
  let parts = 0;
  for (const node of state.nodes) {
    const f = node.fleet;
    const queued = [...node.pending];
    const all = [...node.working, ...queued];
    const fail = (ok: boolean, message: string) => check(ok, `${node.id} @${state.time}: ${message}`);
    if (node.workQueues && node.workingUnits !== undefined) {
      let dots = 0;
      for (const work of node.workQueues.working)
        dots += work.message?.represented === undefined ? 1 : work.message.represented / state.scale;
      fail(Math.abs(node.workingUnits - dots) <= 1e-9, `cached working units ${node.workingUnits} != ${dots}`);
    }
    if (node.workQueues) {
      const seen = new Set<Work>();
      const takeovers = new Set(node.workQueues.takeovers);
      for (const [path, entries] of Object.entries(node.workQueues))
        for (const work of entries) {
          fail(!seen.has(work), "work has multiple admission paths");
          seen.add(work);
          fail(!!work.resumeAtAdmission === (path === "takeovers"), "takeover scheduling disagrees");
        }
      for (const work of all)
        fail(!work.resumeAtAdmission || takeovers.has(work), "takeover flag has no admission path");
    }
    if (node.executionLedger && node.status === "up") {
      const threads = new Set<number>();
      const running = new Set([
        ...(node.workQueues?.working ?? []),
        ...(node.workQueues?.takeovers ?? []),
        ...node.working.filter((work) => work.slotted),
      ]);
      for (const work of running) {
        const reservation = work.thread === undefined ? undefined : state.ledger?.reservations.get(work.thread);
        fail(
          reservation?.scope === "thread" && reservation.owner === node.id,
          "running work has no live thread reservation",
        );
        fail(!threads.has(work.thread!), "running work shares a thread reservation");
        // A finite pool or held caller thread upstream narrowed this cohort's width.
        fail(reservation!.weight <= (work.message?.width ?? Infinity) + 1e-9, "thread is wider than its cohort");
        // Thread acquisition opens the segment whose completion hands the cohort's CPU to its tail.
        fail(reservation!.phase !== "work" || !!work.workSegment, "running work has no open work segment");
        if (node.props.resources && ownsCpu(work)) {
          fail(work.logicalCpuRemaining !== undefined, "ledger CPU must finish only its first wave before retirement");
          fail(
            work.logicalCpuRemaining! <=
              Math.min((work.cpuPerRequest ?? 0) * reservation!.weight, work.cpuRemaining ?? 0) + 1e-8,
            "ledger logical CPU exceeds first-wave weight or remaining cohort",
          );
          // CPU is sized for the cohort the thread executes; a live scale edit never resizes either.
          const cohortCpu = (work.cpuPerRequest ?? 0) * reservation!.represented;
          fail(
            (work.cpuRemaining ?? 0) - (work.cpuBacklog ?? 0) <= cohortCpu * (1 + 1e-9) + 1e-8,
            "ledger CPU exceeds its thread's represented cohort",
          );
        }
        threads.add(work.thread!);
      }
    }
    let tails = 0;
    for (const tail of node.threadTails?.values() ?? []) tails += tail.weight;
    fail(
      tails <= (node.threadWeight?.work ?? 0) + (node.threadWeight?.wait ?? 0) + 1e-8,
      "thread tail aggregate disagrees",
    );
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
    if (node.cpuTick) {
      for (const [tail, before] of node.cpuTick.tails?.owed ?? [])
        fail(
          (tail.cpuOwed ?? 0) <= before + 1e-9 ||
            (tail.cpuParts ?? [{ key: tail.replica ?? 0 }]).some(
              (part) => (node.cpuTick!.tails!.budgets.get(part.key)?.remaining ?? Infinity) <= 1e-9,
            ),
          "owed CPU grew without an exhausted budget",
        );
      let logical = 0,
        tails = 0;
      for (const charge of node.cpuTick.charges) {
        const spent = charge.before - charge.after;
        fail(Number.isFinite(spent) && spent >= -1e-8, "invalid CPU charge");
        const firstWave = (charge.logicalBefore ?? 0) - (charge.logicalAfter ?? 0);
        if (charge.logicalBefore !== undefined) {
          fail(charge.logicalBefore <= charge.weight! * charge.cpuMs! + 1e-8, "logical CPU exceeds reserved real work");
          const cores =
            (node.props.resources.cpuLimitMilli ?? node.props.resources.availableCpuMilli ?? Infinity) / 1000;
          fail(
            Math.abs(
              firstWave - (charge.eligible ? Math.min(charge.logicalBefore, spent, charge.weight! * cores * STEP) : 0),
            ) < 1e-8,
            "logical CPU share disagrees",
          );
          fail(
            Math.abs(spent - firstWave - charge.backlogBefore + (charge.backlogAfter ?? 0)) < 1e-8,
            "working CPU charged a later wave",
          );
        }
        logical += firstWave;
        tails += spent - firstWave;
      }
      fail(
        Math.abs(f.totalCpu - node.cpuTick.before - logical - tails) < 1e-6,
        "CPU charged differs from work plus tails",
      );
      fail(logical + tails <= node.cpuTick.capacityMs + 1e-8, "CPU exceeds fleet budget");
    }
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
    for (const tail of node.cpuTail ?? []) fail(ownsCpu(tail), "CPU tail has no live owner");
    const reservations = new Map<number, number>();
    const previousAttempts = reservationAttempts.get(f);
    const acquired = new Set<number>();
    for (const work of node.working) {
      if (work.scope) {
        fail(work.scope === "thread" && work.releaseAt !== undefined, "invalid thread tail");
        fail(!!work.cpuParts?.length || work.replica !== undefined, "resource-backed thread tail has no CPU ownership");
      } else if (state.scale === 1)
        fail(work.replica !== undefined || !!work.cpuParts?.length, "working attempt has no reservation");
      if (work.replica !== undefined) {
        reservations.set(work.replica, (reservations.get(work.replica) ?? 0) + 1);
        if (previousAttempts && previousAttempts.get(work) !== work.replica) acquired.add(work.replica);
      }
      fail((work.cpuRemaining ?? 0) >= -1e-8 && Number.isFinite(work.cpuRemaining ?? 0), "invalid CPU remaining");
      fail(
        Number.isFinite(work.cpuOwed ?? 0) &&
          (work.cpuOwed ?? 0) >= 0 &&
          (work.cpuOwed ?? 0) <= (work.cpuRemaining ?? 0) + 1e-8,
        "invalid owed tail CPU",
      );
      fail(!(work.cpuOwed ?? 0) || !!node.cpuTail?.has(work), "first-wave work carries owed CPU");
      fail(!(work.cpuOwed ?? 0) || work.fractionalTail === true, "a whole-request tail owes CPU");
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
      // A partial dot (a broker part or a split) holds its own represented size, as the engine sizes it.
      const weight = (work: Work) => work.weight ?? work.executionWeight ?? work.message?.represented ?? state.scale;
      const retained = new Map(
        node.working
          .filter((w) => w.cpuParts?.length && (w.cpuBackoffUntil !== undefined || (w.memorySlots ?? 0) > capacity))
          .map((work) => [work, { weight: weight(work), thread: work.thread }] as const),
      );
      const allowance = Math.max(
        capacity,
        Math.min(
          node.working.reduce((sum, work) => sum + weight(work), 0),
          node.working.reduce((max, w) => Math.max(max, w.memorySlots ?? 0), 0),
        ),
      );
      if (previous?.up && node.status === "up") {
        let continuous = 0;
        for (const [work, held] of retained) {
          const before = previous.retained.get(work);
          // A same-tick shutdown/reacquisition can reuse Work while replacing its ownership.
          if (before && before.thread === held.thread) continuous += Math.min(held.weight, before.weight);
        }
        const occupancy = Math.min(continuous, allowance, previous.capacity);
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
              node.working.filter((w) => w.replica !== undefined).length * r.memoryMiBPerMessage),
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
