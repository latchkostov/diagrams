import { createResources } from "./engine/resources";
import { createBroker } from "./engine/broker";
import { createExecutionReservations } from "./executionReservations";
import { revisionAtLeast } from "../model/revisions";
import { faultProblem, type Fault } from "../model/faults";
import { faultTopology, faultActive, faultKey } from "../model/faultRuntime";
import { shiftWorkDeadlines, createCpuPartBudget, ownsCpu, cancelCpu } from "./resourceWork";
import { resourceBudgetExceeded, MAX_LIFECYCLE_REPLICAS } from "../model/resourceBudget";
import { validateAllocationActions } from "./allocation";
import { t } from "../i18n/core";
import { createFleet, configureConcurrency, fleetReadout, resourceReadout, replicaPage } from "./autoscaling";
import { controllerSyncMs, replicaRange } from "../model/resourceRuntime";
import { shiftCloud } from "./cloudScalers";
import type { DiagramFile } from "../model/types";
import { stencilRole } from "../stencils/roles";
import { resolveProps, type ResolvedProps } from "./defaults";
import { pushDue, popDue, removeDue } from "./dueHeap";
import { SampledLedger, type Reservation } from "./ledger";
import { raceReply, settleOnce, type Attempt, type LogicalBranch } from "./attempt";
import { ShedQueue } from "./shedQueue";
import { Deque } from "./deque";
import { createLineage } from "./lineage";
import { createLatencyBudget, createLatencyRecorder, recordLatency, latencyMetrics } from "./latency";
import { mulberry32 } from "./rng";
import { outputType, callEligible, compileTopology, deadLetterRoutes, type CompiledTopology } from "./topology";
import { resolveScale, resolveMultiplier, representedOf, unitsOf, roundDots, roundCounts, roundRoute } from "./units";
import {
  type AdmissionPolicy,
  reconfigureAdmission,
  emptyAdmission,
  releaseAdmission,
  type AdmissionLease,
} from "./admission";
import {
  compileFilter,
  compileMix,
  compileRoutes,
  compileTable,
  drawStream,
  streamSeed,
  type CompiledRoute,
} from "./routeMatching";
import { routeTableCapable } from "../model/requestRouting";
import {
  quotaRequirements,
  reconfigureQuotas,
  admissionLimits,
  restoreAdmission,
  type QuotaRequirement,
} from "./admission";
import { occupancyFraction } from "./ledger";
import { callPolicy, replyCpuMs } from "./callPolicy";
import {
  retryDisposition,
  backoffDelay,
  classifyOutcome,
  createRetryWindow,
  recordRetryWindow,
  retryWindow,
  type RetryDisposition,
  type ClassifiedOutcome,
  type OutcomeKind,
} from "./retryPolicy";
import { retryBudgetPermits } from "./admission";
import { createBreaker, breakerPermits, breakerRecord, breakerView, type BreakerState } from "./breaker";
import { STEP } from "./timing";
import type {
  RouteCounts,
  EngineOptions,
  NodeSimProps,
  NodeStatus,
  Particle,
  NodeSimState,
  SimFrame,
  SimEngine,
  SimEvent,
} from "./types";
import { createCheckpoints } from "./engine/checkpoint";
import { createAccounting } from "./engine/accounting";
import {
  isBroker,
  liveWork,
  nodeWork,
  queuedWork,
  resourceWork,
  type Message,
  type Group,
  type Work,
  type Node,
  type Call,
  type Logical,
  type Edge,
  type Trip,
  type EchoExpiry,
  type Injection,
} from "./engine/model";
import { createAdmission } from "./engine/admission";
import { createTransport, SOURCE_VOLUME_CAP } from "./engine/transport";

/** A headless run created more messages than its shared budget (EngineOptions.messageBudget). */
export class WorkBudgetError extends Error {}

declare const __TEST_ORACLES__: boolean | undefined;
/** Test-only engine options (the verify hooks, sameArrivals) fold out of shipped builds (vite.config.ts). */
const TEST_ORACLES = typeof __TEST_ORACLES__ === "boolean" && __TEST_ORACLES__;

export const SOURCE_RATE_CAP = 10_000;
export { SOURCE_VOLUME_CAP } from "./engine/transport";

// Runner seed configuration for reused native engines, without widening the public contract.
const eventObservers = new WeakMap<SimEngine, (event: SimEvent) => void>();
/** Test-only lossless event tap; the shipped UI keeps its bounded ring. */
export function observeEngineEvents(engine: SimEngine, observer: (event: SimEvent) => void): () => void {
  if (!TEST_ORACLES) throw new Error("Event observation is test-only");
  eventObservers.set(engine, observer);
  return () => eventObservers.delete(engine);
}

const seedSetters = new WeakMap<SimEngine, (seed: number) => void>();
export function seedEngine(engine: SimEngine, seed: number): void {
  seedSetters.get(engine)?.(seed);
}
// How many numbers the engine's generator has drawn this run (its state is part of a run digest, src/sim/digest.ts).
const drawCounters = new WeakMap<SimEngine, () => number>();
export function randomDraws(engine: SimEngine): number {
  return drawCounters.get(engine)?.() ?? 0;
}

/** Fixed-step, DOM-free engine. Drawing limits never affect message delivery. */
export function createEngine(opts: EngineOptions = {}): SimEngine {
  let partBudget = createCpuPartBudget();
  let latencyBudget = createLatencyBudget();
  let latencySinceFault = false;
  let sinceFault: import("./types").LatencyMetrics["sinceFault"];
  let seed = opts.seed ?? Math.floor(Math.random() * 4294967296);
  const roleOf = opts.roleOf ?? stencilRole;
  const maxParticles = Number.isFinite(opts.maxParticles) ? Math.max(0, Math.floor(opts.maxParticles!)) : 1500;
  let randomState = mulberry32(seed);
  let randomCalls = 0;
  const random = () => {
    randomCalls++;
    return randomState();
  };
  const nodes = new Map<string, Node>();
  let planning: DiagramFile["planning"];
  /** Retries execute in this diagram (p3-w2 and a call with a retry policy). Only then are attempts classified
   * and replies carry w2 codes; elsewhere outcome tracking costs nothing and codes stay as they were. */
  let classifies = false;
  /** Request routing: the document's compiled routes (absent: routing is off and every setting dormant). */
  let routes: Map<string, CompiledRoute> | undefined;
  let routeCounts = new Map<string, RouteCounts>();
  let admission = emptyAdmission();
  let configuration: Record<string, Record<string, unknown>> | undefined;
  const edges: Edge[] = [];
  let faults = new Map<string, Fault>();
  let faultIndex: ReturnType<typeof faultTopology>;
  const faultEdges = new Map<string, Edge>();
  // Thread releases precede local work; a pool wake keeps the established
  // post-reply dispatch phase so a callee cannot start one tick early.
  let earlyPoolWakes: Set<Edge> | undefined;
  /** Admissions must not mutate a working array while its tick pass compacts it. */
  let advancingWork: Node | undefined;
  let releasingEarly = false;
  const ledger = new SampledLedger((reservation) => {
    if (reservation.keys) releaseAdmission(admission, { ...reservation, keys: reservation.keys });
    if (reservation.scope === "thread") {
      const node = nodes.get(reservation.owner)!;
      node.threadWeight[reservation.phase] = --node.threadCount[reservation.phase]
        ? node.threadWeight[reservation.phase] - reservation.weight
        : 0;
      if (node.threadTails.delete(reservation.id)) {
        endResources(node, reservation as Reservation<Group>);
        if (reservation.phase === "work" && node.status === "up" && !node.fleet) admitPending(node);
      }
      return;
    }
    if (reservation.scope === "request") {
      const node = nodes.get(reservation.owner)!;
      node.requestWeight = --node.requestCount ? node.requestWeight - reservation.weight : 0;
      return;
    }
    if (reservation.scope !== "pool") return;
    const edge = faultEdges.get(reservation.edge!)!;
    const fraction = occupancyFraction(reservation);
    edge.calls.inFlight = Math.max(0, edge.calls.inFlight - fraction);
    const remaining = edge.poolUsed - reservation.weight;
    edge.poolUsed = remaining > 1e-9 ? remaining : 0;
    if (!edge.policy?.blocking) edge.from.freeFlight = Math.max(0, edge.from.freeFlight - fraction);
    if (edge.from.status !== "down") {
      if (releasingEarly) earlyPoolWakes!.add(edge);
      else dispatchCalls(edge);
    }
  });
  let trips: Trip[] = [];
  let echoExpiries: EchoExpiry[] = [];
  let echoByTime = new Map<number, EchoExpiry>();
  let logical: Logical[] = [];
  let logicalIndices = new Map<number, number>();
  function scheduleLogical(event: Logical): void {
    pushDue(logical, event, logicalIndices);
  }
  let calls = new Map<number, Call>();
  let nextCall = 1;
  let nextAttempt = 1;
  // Diagnostics keep only the current step's completions plus live holds. Ordinary
  // playback has no history map and drained checkpoints retain no attempt history.
  let outcomeChecks = new Map<number, Attempt<Message>>();
  let nextLogical = 1;
  const queuedChecks = TEST_ORACLES ? new WeakMap<ShedQueue<Work>, { revision: number; units: number }>() : undefined;
  let breakerDispatches: import("./resilienceInvariants").ResilienceState["breakerDispatches"][number][] = [];
  let budgetDecisions: import("./resilienceInvariants").ResilienceState["budgetDecisions"][number][] = [];
  const waits = () => revisionAtLeast(planning?.revision, "p3-w1");
  const retries = () => revisionAtLeast(planning?.revision, "p3-w2");
  /** A message's represented size and the dots its counters add (units.ts). */
  const sizeOf = (m?: { represented?: number }) => representedOf(m, scale);
  const dotsOf = (m?: { represented?: number }) => unitsOf(m, scale);
  /** Sums of fractional dots return to exactly zero once their last part leaves. */
  const settled = (n: number) => (Math.abs(n) <= 1e-9 ? 0 : n);
  const callerReservations = (node: Node) => (node.waits || node.callTarget) && node.role === "processor";
  /** Dots in work, a partial dot counting its share (unitsOf). */
  const workingDots = (node: Node) => node.workingUnits + node.heldCalls;
  const threadOccupancy = (node: Node) =>
    callerReservations(node) ? (node.threadWeight.work + node.threadWeight.wait) / scale : workingDots(node);
  function threadPhase(node: Node, reservation: Reservation | undefined, phase: "work" | "wait"): void {
    if (!reservation || reservation.phase === phase) return;
    node.threadWeight[reservation.phase] = --node.threadCount[reservation.phase]
      ? node.threadWeight[reservation.phase] - reservation.weight
      : 0;
    reservation.phase = phase;
    node.threadWeight[phase] += reservation.weight;
    node.threadCount[phase]++;
  }
  const executionOccupancy = (node: Node): number =>
    usesLedger(node)
      ? node.threadWeight.work + node.threadWeight.wait
      : node.fleet && scale === 1 && !node.sampledExecution
        ? node.fleet.active
        : threadOccupancy(node) * scale;
  const memoryRequests = (node: Node) => (callerReservations(node) ? node.requestWeight : residentRequests(node));

  const [
    executionAdmissibleActive,
    usesLedger,
    executionCohort,
    reacquireCapacity,
    startResources,
    attachIdleResources,
    endResources,
    retireThread,
    releaseThread,
    takeoverThread,
    shutdown,
    disableResources,
  ] = createExecutionReservations<Group, Node>(
    ledger,
    () => admission,
    () => scale,
    () => time,
    waits,
    callerReservations,
    // A settled wait's lag to its node's next admission phase. Ordinary-clock arrivals admit
    // in the tick's arrival phase, ahead of its node loop, so only a cohort's N/w - 1 inner
    // turnarounds wait for a later phase; its final release settles before the next arrivals.
    (node, reservation) =>
      node.admittedAt !== time || (node.props.admission && incomingAt !== time)
        ? 0
        : node.props.admission && incomingBeforeReleases
          ? STEP * (1 - reservation.weight / reservation.represented)
          : STEP,
    (node) => slots(node),
    resourceWork,
    scheduleThreadGrace,
    () => TEST_ORACLES && opts.ledgerHold === "none",
  );

  /** Each represented request lives in work, a call, or the continuation queue, never in a tail. */
  function residentRequests(node: Node): number {
    return waits() ? node.residentWeight : workingDots(node) * scale;
  }
  /** Terminal request cleanup is independent of any retained thread/lease capacity. */
  function finishResident(node: Node, work: Work): void {
    if (work.residentWeight === undefined) return;
    // Fractional scales can leave subtraction roundoff. The last owner releases
    // the whole aggregate, so a drained node is exactly empty at every scale.
    node.residentWeight = --node.residentCount ? node.residentWeight - work.residentWeight : 0;
    work.residentWeight = undefined;
  }

  let drawn = 0;
  let drawnTrips = new Map<number, Trip>();
  let sourceRate = 0;
  let sourceEmitted = 0;
  let time = 0;
  let incomingAt: number | undefined;
  /** The last arrival phase ran ahead of the tick's node loop (no resource clock); due releases settle before both. */
  let incomingBeforeReleases = false;
  let accumulator = 0;
  let speed = 1;
  let traffic = false;
  let scale = resolveScale(opts.scale);
  /** Same-arrivals oracle (opts.sameArrivals): the scale whose arrival instants this scale-1 run replays. */
  let cohort = 1;
  let cohortDots = new Map<Node, number>();
  let capacityMultiplier = 1;
  let nextMessage = 1;
  let nextParticle = 1;
  let nextInjection = 1;
  let inSystem = 0;
  const events: SimEvent[] = [];
  let eventHead = 0;
  let topology = 0;
  let compiled: CompiledTopology = { edges: [], outgoing: new Map(), groups: new Map(), restricted: new Set() };
  const groupsByConsumer = new Map<string, Group[]>();
  const metricGroups = new Map<string, Map<string, Group>>();
  const lineage = createLineage({
    time: () => time,
    find(test) {
      for (const trip of trips)
        if (test(trip.message))
          return {
            message: trip.message,
            node: trip.kind === "reply" || trip.kind === "retry" ? trip.edge.to.id : trip.edge.from.id,
          };
      for (const node of nodes.values()) {
        for (const work of liveWork(node, groupsByConsumer))
          if (test(work.message)) return { message: work.message, node: node.id };
        for (const group of node.groups) {
          const queued = group.pending.find(test);
          if (queued) return { message: queued, node: node.id };
        }
      }
      return undefined;
    },
  });
  // Min-heap contains one entry per spread batch, not one per future message.
  const injections: Injection[] = [];

  /** Headless planning's shared message budget: refuses the message before it is allocated. */
  function spend(): void {
    const budget = opts.messageBudget;
    if (budget && --budget.remaining < 0) throw new WorkBudgetError("The run created more messages than its budget");
  }

  function countRoute(route: CompiledRoute): RouteCounts {
    let counts = routeCounts.get(route.id);
    if (!counts) routeCounts.set(route.id, (counts = { sent: 0, rejected: 0, completed: 0 }));
    return counts;
  }

  // Positional wiring lets the minifier rename internal ports and results.
  const [
    log,
    step,
    creditRoute,
    addressed,
    copy,
    fanOut,
    processed,
    gone,
    drop,
    block,
    finishTickMetrics,
    accountingSnapshot,
  ] = createAccounting(
    edges,
    events,
    lineage,
    opts,
    (event) => {
      if (TEST_ORACLES) eventObservers.get(engine)?.(event);
      if (events.length < 200) events.push(event);
      else {
        events[eventHead] = event;
        eventHead = (eventHead + 1) % 200;
      }
    },
    (message) => {
      spend();
      const next = { ...message, id: nextMessage++, attempts: 0 };
      inSystem++;
      return next;
    },
    () => {
      inSystem--;
    },
    countRoute,
    () => time,
    () => latencyBudget,
    dotsOf,
    waits,
  );

  function boundaryDown(node: Node): boolean {
    return node.outages.size > 0;
  }

  function changeStatus(node: Node, status: NodeStatus): void {
    if (node.status === status) return;
    if (node.fleet) {
      const f = node.fleet;
      if (node.status === "paused") {
        const duration = time - (f.pausedAt ?? 0);
        for (const c of f.starts) c.at += duration;
        for (const c of f.sampledDrains) c.at += duration;
        for (const busy of f.busy.values()) if (busy.drainAt !== undefined) busy.drainAt += duration;
        for (const work of nodeWork(node, groupsByConsumer)) shiftWorkDeadlines(work, duration);
        f.pausedAt = undefined;
        if (f.keda) {
          f.keda.createdAt += duration;
          if (f.keda.lastActive !== undefined) f.keda.lastActive += duration;
        }
        shiftCloud(f, duration);
        scheduleController(node);
      }
      f.paused = status === "paused";
      if (f.paused) f.pausedAt = time;
    }
    node.status = status;
    if (status === "down") {
      for (const call of [...node.calls.values()]) settleAttempt(call, "callee-down", true);
      shutdownOwner(node);
    }
    if (status === "up")
      for (const call of [...node.calls.values()]) {
        if (call.attempt.outcome) settleAttempt(call);
        else if (call.held && !call.blockingRemaining && call.outstanding.size) detachCallThread(call);
        else if (node.fleet) {
          const at = executionGraceDeadline(node, call.work);
          if (Number.isFinite(at)) scheduleLogical({ id: nextLogical++, end: at, call: call.id, grace: at });
        }
      }
    if (status === "up" && usesLedger(node) && !callerReservations(node)) {
      const retained = node.working;
      node.working = [];
      node.workingUnits = 0;
      for (const work of retained) {
        if (reacquireCapacity(node, work)) {
          node.working.push(work);
          node.workingUnits += dotsOf(work.message);
        } else {
          work.slotted = false;
          endResources(node, work);
          admit(node, work);
        }
      }
    }
    if (status === "up") for (const [id, work] of node.threadTails) scheduleThreadGrace(id, work);
    log("status", node, undefined, status);
  }

  /** Owner shutdown invalidates every logical reference alongside ledger ownership. */
  function shutdownOwner(node: Node): void {
    shutdown(node, liveWork(node, groupsByConsumer));
    // A continuation that lost request admission must rejoin the admission
    // queue. It cannot block resumed work that still owns request capacity and
    // needs to finish before that capacity can be reacquired.
    const resume = node.resume;
    node.resume = new Deque();
    node.resumeUnits = 0;
    for (const work of resume) {
      if (work.recoveryCapacity) {
        wakeDelivery(work);
        admit(node, work);
      } else resumeLater(node, work);
    }
    for (const edge of node.outgoing) edge.poolLeases.clear();
  }

  const cut = (edge: Edge): boolean => edge.cut === true;

  function faultProps(node: Node, props: ResolvedProps): ResolvedProps {
    const slow = faults.get(faultKey({ kind: "slow", node: node.id, factor: 1 }));
    if (slow?.kind !== "slow") return props;
    return {
      ...props,
      latencyMs: props.latencyMs * slow.factor,
      ...(props.resources
        ? { resources: { ...props.resources, cpuMsPerMessage: props.resources.cpuMsPerMessage * slow.factor } }
        : {}),
    };
  }

  function startAttempt(node: Node, work: Work): void {
    if (waits()) {
      if (work.residentWeight === undefined) {
        work.residentWeight = sizeOf(work.message);
        node.residentWeight += work.residentWeight;
        node.residentCount++;
      }
      attempt(node, work);
    }
    if (node.status === "down") return;
    work.workSegment = true;
    if (!callerReservations(node)) {
      if (!reacquireCapacity(node, work)) throw new Error("Processor admitted without thread capacity");
      return;
    }
    const retainedThread = ledger.get<Group>(work.thread);
    if (retainedThread) {
      for (const r of [retainedThread, ledger.get(work.requestLease)])
        if (r) {
          // A takeover already carries the preceding thread's unexpired hold.
          // Waiting for the continuation's admission phase is not another work slice.
          if (!work.continuation || r.scope !== "thread")
            r.heldMs += node.activeMs - (r.segmentActive ?? r.startActive);
          r.segmentActive = node.activeMs;
        }
      threadPhase(node, retainedThread, "work");
      attempt(node, work).res = { thread: work.thread, request: work.requestLease };
      return;
    }
    if (!reacquireCapacity(node, work)) throw new Error("Caller admitted without thread capacity");
    attempt(node, work).res = { thread: work.thread, request: work.requestLease };
  }

  function setNodePropsBatch(patches: Record<string, NodeSimProps>, multiplier?: number): void {
    const next = resolveMultiplier(multiplier, capacityMultiplier);
    const multiplierChanged = next !== capacityMultiplier;
    if (revisionAtLeast(planning?.revision, "p3-a1"))
      validateAllocationActions(
        nodes.values(),
        Object.entries(patches).map(([node, props]) => ({ node, props })),
        next,
        {
          sequential: false,
          multiplierChanged,
        },
      );
    capacityMultiplier = next;
    const reconcile = new Set<Node>();
    const initialized = new Set<Node>();
    const changed = new Set<string>(),
      limits = new Set<Group>();
    const units = new Map<Node, number>();
    const admissionChanges: { id: string; policy?: AdmissionPolicy }[] = [];
    for (const [id, patch] of Object.entries(patches)) {
      const node = nodes.get(id);
      if (!node) continue;
      if (patch.resumeAutoscaling && node.fleet) {
        node.fleet.override = false;
        scheduleController(node);
        node.fleet.decision = undefined;
        Reflect.deleteProperty(node.rawProps, "resumeAutoscaling");
        configuration = undefined;
      }
      if ("failureRate" in patch) node.scriptedFailure = typeof patch.failureRate === "number" && patch.failureRate > 0;
      if (
        !(node.fleet && patch.replicas !== undefined) &&
        Object.entries(patch).every(
          ([key, value]) => key === "resumeAutoscaling" || Object.is(node.rawProps[key], value),
        )
      )
        continue;
      configuration = undefined;
      if ("replicas" in patch) units.set(node, node.props.replicas);
      if (node.fleet && patch.replicas !== undefined) {
        node.fleet.override = true;
        reconcile.add(node);
        changed.add(id);
      }
      if (node.fleet && patch.resumeAutoscaling) {
        node.fleet.override = false;
        scheduleController(node);
      }
      const previous = node.props;
      const memorySlots = node.fleet
        ? Math.min(slots(node), (node.fleet.ready + node.fleet.draining) * previous.concurrency)
        : 0;
      for (const [key, value] of Object.entries(patch)) {
        if (key === "resumeAutoscaling") continue;
        if (value === undefined) Reflect.deleteProperty(node.rawProps, key);
        else node.rawProps[key] = structuredClone(value);
      }
      const admissionChanged = ["api", "endpoints", "preset", "presetRevision"].some((key) => key in patch);
      node.props = faultProps(
        node,
        resolveProps(
          node.role,
          node.label,
          node.rawProps,
          node.stencil,
          planning,
          admissionChanged ? undefined : previous.admission,
        ),
      );
      if (node.props.queue) classifies = true;
      if ("queue" in patch || (previous.queue && !node.props.queue)) configureShedQueue(node);
      if (node.fleet) {
        if (scale > 1 && node.props.concurrency < previous.concurrency)
          for (const work of [...node.working, ...node.takeovers])
            if (work.cpuParts) work.memorySlots = Math.max(work.memorySlots ?? 0, memorySlots);
        configureConcurrency(node.fleet, node.props.concurrency);
      }
      if ("resources" in patch || "autoscaling" in patch) {
        if (!node.props.resources) {
          disableResources(node, nodeWork(node, groupsByConsumer));
        } else if (!node.fleet || time === 0) {
          initializeFleet(node);
          initialized.add(node);
          const working = [...node.working, ...node.takeovers];
          node.working = [];
          node.workingUnits = 0;
          node.takeovers = [];
          for (const work of working) {
            work.replica = undefined;
            work.cpuParts = undefined;
            if (startResources(node, work)) {
              work.workedAt = time;
              scheduleWork(node, work, work.resumeAtAdmission ? "takeovers" : "working");
            } else {
              work.slotted = false;
              wakeDelivery(work);
              admit(node, work);
            }
          }
          for (const call of node.calls.values()) if (call.held) attachIdleResources(node, call.work);
          for (const tail of node.threadTails.values()) attachIdleResources(node, tail);
        } else {
          const f = node.fleet,
            a = node.props.autoscaling;
          f.recommendations = [];
          f.changes = [];
          f.decision = undefined;
          f.nextSync = time + (a?.mode === "on" ? controllerSyncMs(a.controller) : 15_000);
          f.keda = undefined;
          f.cloud = undefined;
          resetController(node, f, a?.mode === "on" ? a.controller : undefined);
          reconcile.add(node);
        }
        changed.add(id);
      }
      if (admissionChanged && (previous.admission || node.props.admission))
        admissionChanges.push({ id, policy: node.props.admission });
      // A setup or timeline patch replaces a mix or table whole (never a deep merge of rows or rules).
      if ("trafficMix" in patch || "routeTable" in patch) compileNodeRouting(node);
      if (node.role === "source") sourceRate += node.props.ratePerSec - previous.ratePerSec;
      if (
        Math.max(1, Math.round(node.props.replicas * capacityMultiplier)) !== node.replicas ||
        (isBroker(node) && node.props.partitions !== previous.partitions)
      )
        changed.add(id);
      if (node.props.concurrency !== previous.concurrency || node.props.latencyMs !== previous.latencyMs)
        for (const group of groupsByConsumer.get(id) ?? []) limits.add(group);
    }
    if (admissionChanges.length) reconfigureAdmission(admission, admissionChanges, planning, time);
    for (const node of nodes.values()) {
      if (node.fleet && node.props.resources && (multiplierChanged || reconcile.has(node))) {
        const f = node.fleet,
          a = node.props.autoscaling;
        const c = a?.mode === "on" && !f.override ? a.controller : undefined;
        const range = c ? replicaRange(c, next) : undefined;
        const desired = range
          ? time === 0
            ? range.initial
            : Math.max(range.min, Math.min(range.max, f.desired))
          : Math.max(1, Math.round(node.props.replicas * next));
        if (!initialized.has(node)) {
          if (time === 0) {
            node.fleet = createFleet(desired, {
              concurrency: node.props.concurrency,
              syncMs: c ? controllerSyncMs(c) : undefined,
              partBudget,
            });
            node.fleet.override = f.override;
            resetController(node, node.fleet, c);
          } else reconcileResources(node, desired);
        }
        if (patches[node.id]?.replicas !== undefined && node.fleet.override)
          node.fleet.decision = {
            at: time,
            source: "pods",
            raw: patches[node.id].replicas!,
            desired: node.fleet.desired,
            reason: "override",
            nextAt: time,
          };
        changed.add(node.id);
      }
      if (multiplierChanged && Math.max(1, Math.round(node.props.replicas * next)) !== node.replicas)
        changed.add(node.id);
    }
    if (changed.size) assignReplicas(changed);
    for (const group of limits) {
      refreshGroupLimit(group);
      drainStaged(group);
    }
    // A unit of an active-standby pair failed: its own unit count went down (a capacity multiplier never changes
    // it), at least one is left, and the run is under way (a unit missing at time zero is the starting state).
    for (const [node, before] of units)
      if (
        node.props.device?.ha === "active-standby" &&
        node.props.replicas < before &&
        node.status === "up" &&
        time > 0
      ) {
        node.holdUntil = time + node.props.device.failoverMs;
        log("status", node, undefined, `failing over to the standby (${node.props.replicas} of ${before} units left)`);
      }
  }

  function acknowledge(node: Node, work: Work): void {
    finishResident(node, work);
    endAdmission(work);
    if (work.delivery) settleDelivery(work.delivery);
    release(work);
  }

  /**
   * Whether a failed delivery can retry in place: it already has one of the node's slots, or one is free now (its
   * group's too). Prefetched deliveries arriving at a down consumer can't all keep one: the rest go back to the broker.
   */
  function canRetain(node: Node, work: Work): boolean {
    if (work.cpuParts?.some((p) => p.drainAt !== undefined)) return false;
    if (node.fleet && work.replica !== undefined && node.fleet.busy.get(work.replica)?.drainAt !== undefined)
      return false;
    if (work.slotted && (!node.fleet || work.replica !== undefined || work.cpuParts?.length)) return true;
    if (callerReservations(node) && threadOccupancy(node) >= slots(node) / scale) return false;
    if (
      node.fleet
        ? (scale === 1 ? node.fleet.active : threadOccupancy(node) * scale) >= slots(node)
        : threadOccupancy(node) >= slots(node)
    )
      return false;
    return !work.delivery || !!work.held || hold(work.delivery.group, node, work);
  }

  /** What ended an attempt that was cut short rather than failing on its own: its node's outage, or termination. */
  function ended(node: Node): OutcomeKind {
    return node.status === "down" ? "callee-down" : "error";
  }

  /**
   * Replies upstream. The reply's classification is the terminal cause of the attempt that just settled
   * (`kind` only where no attempt is decided: a non-processor outage, a router's deny), never a cached call state.
   * `legacyCode` is the reply code where retries don't execute, exactly as it always was.
   */
  function answer(work: Work, ok: boolean, kind?: OutcomeKind, legacyCode = ok ? undefined : work.failureCode): void {
    let outcome: ClassifiedOutcome | undefined;
    let code = legacyCode;
    if (classifies) {
      let cause = kind ?? work.attempt?.outcome?.cause;
      if (cause === undefined || (cause === "success") !== ok) {
        if (TEST_ORACLES && opts.verifyResilience)
          throw new Error(`Reply @${time}: ok=${ok} but its attempt is ${cause}`);
        cause = ok ? "success" : "error";
      }
      // A child's own deadline is an upstream 504 at its caller, rather than that caller's own timeout.
      outcome = classifyOutcome(cause === "deadline" ? "upstream-timeout" : cause);
      code = outcome.code;
    }
    if (waits() && work.via?.sync && work.message.returnCall !== undefined) {
      const edge = work.via;
      const start = Math.max(time, work.message.visualAt ?? time);
      if (!cut(edge))
        scheduleLogical({
          id: nextLogical++,
          end: time + edge.networkDelayMs,
          edge,
          call: work.message.returnCall,
          callAttempt: work.message.callAttempt,
          backoffMs: work.message.backoffMs,
          ok,
          code,
          outcome,
          timeoutOrigin: work.timeoutOrigin,
          visualAt: start + Math.max(STEP, edge.travelMs),
          represented: work.message.represented,
        });
      const visible = drawn < maxParticles;
      const trip: Trip = {
        id: nextParticle++,
        edge,
        message: work.message,
        kind: "reply",
        start,
        end: start + Math.max(STEP, edge.travelMs),
        drawn: visible,
        echo: true,
        code,
      };
      edge.active++;
      if (visible) {
        drawn++;
        drawnTrips.set(trip.id, trip);
      }
      keepEcho(trip);
      if (work.message.family.trace)
        step(work.message, "send", edge.to.id, { edge: edge.id, via: "reply", until: time + edge.networkDelayMs });
      return;
    }
    reply(work, code);
  }

  function attempt(node: Node, work: Work): Attempt<Message> {
    return (work.attempt ??= {
      id: nextAttempt++,
      node: node.id,
      message: work.message,
      admittedAt: time,
      committed: false,
      res: { thread: work.thread, request: work.requestLease },
    });
  }

  /**
   * Writes an attempt's terminal result once: success, or the cause that ended it. Where retries execute the
   * classified cause is part of that write-once record, with its code; elsewhere the record keeps `legacyCode`.
   */
  function decide(a: Attempt<Message>, cause: OutcomeKind, legacyCode?: number, at = time): void {
    settleOnce(
      a,
      cause === "success",
      classifies ? classifyOutcome(cause).code : legacyCode,
      at,
      classifies ? cause : undefined,
    );
    if (TEST_ORACLES && opts.verifyOutcomes) outcomeChecks.set(a.id, a);
  }

  /** All terminal paths use the same write-once commitment, preserving their own effects. */
  function commitAttempt(a: Attempt<Message>, cause: OutcomeKind, legacyCode?: number): boolean {
    decide(a, cause, legacyCode);
    if (a.committed) return false;
    a.committed = true;
    return true;
  }

  function scheduleThreadGrace(id: number, work: Reservation<Group>): void {
    const at = executionGraceDeadline(nodes.get(work.owner)!, work);
    if (Number.isFinite(at)) scheduleLogical({ id: nextLogical++, end: at, thread: id });
  }

  /** The first wave finishes logically; remaining cohort CPU keeps running independently. */
  function finishThreadWork(node: Node, work: Work): void {
    const r = ledger.get<Group>(work.thread);
    if (!r || !work.workSegment) return;
    const elapsed = node.activeMs - (r.segmentActive ?? r.startActive);
    const localHold = elapsed;
    if (ownsCpu(work) && (work.cpuRemaining ?? 0) > 1e-8 && (work.logicalCpuRemaining ?? Infinity) <= 1e-8)
      node.cpuTail.add(work);
    r.heldMs += Math.max(0, localHold);
    r.segmentActive = node.activeMs;
    work.workSegment = false;
  }

  function retireRequest(work: Work, immediate = false): void {
    const r = ledger.get<Group>(work.requestLease);
    if (!r) return;
    work.requestLease = undefined;
    const node = nodes.get(r.owner)!;
    if (immediate || node.status === "down" || (TEST_ORACLES && opts.ledgerHold === "none")) ledger.release(r);
    else ledger.retire(r, node.activeMs - (r.segmentActive ?? r.startActive), node.activeMs);
  }

  /** Choose each branch once, then join Requests before publishing Messages or replying upstream. */
  function beginCall(node: Node, work: Work, ok = true): boolean {
    if (!node.waits) return false;
    let message = work.message;
    message = rename(message, outputType(node.role, node.props.emits, message.type));
    const outgoing = !ok ? [] : work.route ? [work.route.edge] : outputRoutes(node, message);
    work.outputMessage = message;
    work.outputs = outgoing.filter((edge) => !edge.sync);
    const requests = outgoing.filter((edge) => edge.sync);
    if (!requests.length) return false;
    // Capture only admission's fractional carry before local work advances segmentActive.
    const admissibleActive = executionAdmissibleActive(node, work);
    finishThreadWork(node, work);
    const nonblocking = requests.every((e) => !e.policy?.blocking);
    if (nonblocking) retireThread(node, work);
    const depth = (message.callDepth ?? 0) + 1;
    if (depth > 16 || calls.size >= 100_000) {
      log("status", node, message, depth > 16 ? "call depth limit" : "open call limit reached");
      settleWork(node, work, "call-limit");
      return true;
    }
    const call: Call = {
      attempt: attempt(node, work),
      id: nextCall++,
      startedAt: time,
      node,
      work,
      outstanding: new Set(requests.map((e) => e.id)),
      branches: new Map(
        requests.map((e) => [
          e.id,
          {
            state: "queued",
            expiresAt: time + (e.policy?.deadlineMs ?? Infinity),
            ...(e.retry ? { attempt: 1, countedAt: time } : {}),
            ...(e.breaker ? { attemptStartedAt: time } : {}),
          },
        ]),
      ),
      blockingRemaining: requests.filter((e) => e.policy?.blocking).length,
      held: node.role === "processor" && !nonblocking,
      replyMs: requests.reduce((sum, e) => sum + (e.policy?.replyMs ?? 0), 0),
      replies: requests.filter((e) => !e.policy?.blocking).length,
      depth,
    };
    call.attempt.call = {
      startedAt: call.startedAt,
      blockingRemaining: call.blockingRemaining,
      depth,
      branches: call.branches,
    };
    calls.set(call.id, call);
    node.calls.set(call.id, call);
    work.waitingCall = call.id;
    if (call.held) {
      node.heldCalls++;
      if (work.delivery) {
        node.heldBrokerCalls++;
        call.brokerHeld = true;
      }
      work.slotted = true;
    } else {
      node.offThreadCalls++;
      work.slotted = false;
      endResources(node, work);
      endThreadAdmission(work);
      release(work);
      suspendDelivery(work);
    }
    if (call.held) threadPhase(node, ledger.get<Group>(work.thread), "wait");
    for (const edge of requests) {
      if (call.held && edge.policy?.blocking) {
        edge.calls.held += call.heldDots ??= dotsOf(message);
        node.waitingOn.set(
          edge.id,
          (node.waitingOn.get(edge.id) ?? 0) + (ledger.get<Group>(work.thread)?.weight ?? sizeOf(message)),
        );
      }
      const branch = {
        ...addressed(copy(node, message), edge.requestRoute ?? message.request),
        // A held caller thread was granted within its incoming width, so it narrows it.
        width: ledger.get(work.thread)?.weight ?? message.width,
        returnCall: call.id,
        callDepth: depth,
        ...(edge.retry ? { callAttempt: 1 } : {}),
      };
      if (edge.retry) {
        retryCount(edge, "requests", branch);
        retryCount(edge, "attempts", branch);
      }
      if (!permitBreaker(call, edge, branch)) continue;
      pushDue(
        edge.poolPending,
        {
          id: call.id,
          end: call.id,
          call,
          message: branch,
          admissibleActive,
        },
        edge.poolPendingIndices,
      );
      scheduleDeadline(call, edge, branch);
      dispatchCalls(edge);
    }
    return true;
  }

  function logBreaker(edge: Edge, previous: BreakerState["state"]): void {
    if (edge.breaker!.state.state !== previous) {
      const view = breakerView(edge.breaker!.state, edge.breaker!.policy, time);
      log(
        "status",
        edge.from,
        undefined,
        `${edge.from.label} → ${edge.to.label} breaker ${edge.breaker!.state.state === "open" ? "opened" : edge.breaker!.state.state === "half-open" ? "testing" : "closed"}${view.state === "open" ? (view.calls ? ` (${Math.round(view.failurePercent)}% failing over ${(edge.breaker!.policy.windowMs ?? 10000) / 1000} s)` : " (probes inconclusive)") : ""}`,
      );
    }
  }

  function finishBreaker(call: Call, edge: Edge, cause: OutcomeKind): void {
    const branch = call.branches.get(edge.id)!;
    if (!edge.breaker || !branch.breakerPermit) return;
    const previous = edge.breaker.state.state;
    breakerRecord(
      edge.breaker.state,
      edge.breaker.policy,
      time,
      cause,
      time - branch.attemptStartedAt!,
      branch.breakerPermit,
    );
    branch.breakerPermit = undefined;
    logBreaker(edge, previous);
  }

  /** Reclassify a logical attempt (or its refused part) as a local short circuit. */
  function shortCircuited(edge: Edge, branch: LogicalBranch, message: Message): void {
    edge.calls.shortCircuited! += dotsOf(message);
    edge.calls.attempts! -= dotsOf(message);
    const bucket = edge.retry!.window.buckets[Math.floor(branch.countedAt! / 1000) % 10];
    if (bucket?.second === Math.floor(branch.countedAt! / 1000)) bucket.attempts -= sizeOf(message);
  }

  /**
   * A half-open breaker's throttle split: the branch keeps only the admitted test calls, and the rest of its
   * cohort fails fast at this instant, as scale 1 short-circuits the rest of a burst. The probe reaches the
   * callee and the breaker at its real size at any scale. The caller's dot still takes one outcome, the probe's.
   */
  function narrowProbe(edge: Edge, branch: LogicalBranch, message: Message, admitted: number): void {
    // The refused part ends off the request route; the admitted part completes it once for the whole cohort.
    creditRoute(message, message);
    const refused: Message = {
      ...copy(edge.from, message),
      attempts: message.attempts,
      represented: sizeOf(message) - admitted,
      request: undefined,
      routeCohort: undefined,
    };
    message.represented = branch.represented = admitted;
    // A waiter for a pool connection that outlived the open interval (dispatch skipped while its caller was
    // down) scheduled its deadline at the whole cohort's size.
    const deadline = branch.deadlineEvent === undefined ? undefined : logicalIndices.get(branch.deadlineEvent);
    if (deadline !== undefined) logical[deadline].represented = admitted;
    shortCircuited(edge, branch, refused);
    // A whole short circuit counts here when its logical failure drains; this part never settles the call.
    edge.calls.failed += dotsOf(refused);
    gone(edge.from, refused, "end", "breaker open");
  }

  /** The real requests a call's branch carries: its caller's cohort, unless a half-open breaker narrowed it. */
  function branchSized(call: Call, edge: Edge): { represented?: number } {
    const represented = call.branches.get(edge.id)?.represented;
    return represented === undefined ? call.work.message : { represented };
  }

  function permitBreaker(call: Call, edge: Edge, message: Message): boolean {
    if (!edge.breaker) return true;
    const branch = call.branches.get(edge.id)!;
    const { state, policy } = edge.breaker;
    if (branch.breakerPermit?.generation === state.generation && state.state !== "open") return true;
    const previous = state.state;
    const size = sizeOf(message);
    branch.breakerPermit = breakerPermits(state, policy, time, size);
    branch.attemptStartedAt ??= time;
    logBreaker(edge, previous);
    if (branch.breakerPermit) {
      if (size - branch.breakerPermit.units > 1e-9) narrowProbe(edge, branch, message, branch.breakerPermit.units);
      return true;
    }
    shortCircuited(edge, branch, message);
    if (edge.poolPendingIndices.has(call.id)) cancelPending(edge, call.id);
    else gone(edge.from, message, "end", "breaker open");
    scheduleLogical({
      id: nextLogical++,
      end: time,
      edge,
      call: call.id,
      ok: false,
      outcome: classifyOutcome("breaker-open"),
      code: 503,
      represented: message.represented,
      callAttempt: branch.attempt,
    });
    return false;
  }

  function dispatchCalls(edge: Edge): void {
    if (edge.from.status === "down" || earlyPoolWakes?.has(edge)) return;
    while (edge.poolPending.length) {
      const next = edge.poolPending[0];
      if (
        !calls.has(next.call.id) ||
        next.call.attempt.outcome ||
        raceReply(next.call.branches.get(edge.id)!, time) === "timeout"
      ) {
        popDue(edge.poolPending, edge.poolPendingIndices);
        gone(edge.from, next.message, "end", "call already failed");
        continue;
      }
      if (!permitBreaker(next.call, edge, next.message)) continue;
      // Only a finite pool narrows the cohort; an unbounded pool ignores width.
      const finite = Number.isFinite(edge.policy?.pool);
      const reservation = ledger.reserve(
        {
          scope: "pool",
          owner: edge.from.id,
          edge: edge.id,
          startActive: edge.from.activeMs,
          startedAt: time,
          phase: "wait",
          ...(next.message.represented === undefined ? {} : { units: dotsOf(next.message) }),
        },
        sizeOf(next.message),
        (edge.policy?.pool ?? Infinity) - edge.poolUsed,
        finite ? (next.message.width ?? Infinity) : Infinity,
        next.admissibleActive,
      );
      if (!reservation) break;
      const { call, message } = popDue(edge.poolPending, edge.poolPendingIndices);
      if (finite) message.width = reservation.weight;
      edge.poolUsed += reservation.weight;
      edge.poolLeases.set(call.id, reservation.id);
      const branch = call.branches.get(edge.id)!;
      branch.state = "sent";
      if (TEST_ORACLES && opts.verifyResilience && edge.breaker)
        breakerDispatches.push({
          state: edge.breaker.state.state,
          sent: branch.breakerPermit!.sent,
          probes: edge.breaker.policy.halfOpenCalls ?? 5,
          units: branch.breakerPermit!.units,
        });
      branch.pool = reservation.id;
      edge.calls.inFlight += occupancyFraction(reservation);
      if (!edge.policy?.blocking) edge.from.freeFlight += occupancyFraction(reservation);
      const work = call.work;
      deliver(
        edge,
        message,
        "message",
        undefined,
        work.route ? { rule: work.route.rule, weight: work.route.weight } : undefined,
      );
    }
  }

  function emptyRetryCounts() {
    return {
      requests: 0,
      attempts: 0,
      retried: 0,
      succeeded: 0,
      budgetDenied: 0,
      shortCircuited: 0,
      ambiguous: 0,
      backingOff: 0,
    };
  }

  function retryCount(
    edge: Edge,
    field: "requests" | "attempts" | "retried" | "succeeded",
    message: { represented?: number },
  ): void {
    edge.calls[field] = (edge.calls[field] ?? 0) + dotsOf(message);
    recordRetryWindow(edge.retry!.window, time, field, sizeOf(message));
  }

  function cancelRetry(call: Call, edge: Edge): void {
    const branch = call.branches.get(edge.id)!;
    if (branch.retryEvent === undefined) return;
    removeDue(logical, branch.retryEvent, logicalIndices);
    branch.retryEvent = undefined;
    // A cancelled backoff leaves its failed attempt as the branch's last; a paused caller keeps the call.
    if (branch.state === "backoff") branch.state = "failed";
    // Released as charged: a partial dot's dots change with a live scale edit.
    edge.calls.backingOff = settled(edge.calls.backingOff! - (branch.backoffDots ?? 0));
    branch.backoffDots = undefined;
    if (--call.backingOff! === 0) {
      const elapsed = time - call.backoffAt!;
      call.work.message.backoffMs = (call.work.message.backoffMs ?? 0) + elapsed;
      call.backoffAt = undefined;
    }
  }

  function maybeRetry(call: Call, edge: Edge, event: Logical): boolean {
    const retry = edge.retry;
    if (!retry || call.attempt.outcome || call.node.status === "down") return false;
    const branch = call.branches.get(edge.id)!;
    const policy = retry.policy;
    const kind = event.outcome?.class;
    if (!kind || !policy.retryOn.includes(kind) || branch.attempt! >= Math.min(policy.maxAttempts, 10)) return false;
    const message = call.work.message;
    // Only a narrowed probe's own requests failed and may retry: the rest of its cohort short-circuited.
    const sized = branchSized(call, edge);
    const w = retryWindow(retry.window, time);
    if (!retryBudgetPermits(policy.budget, w.requests, w.retried, sizeOf(sized))) {
      edge.calls.budgetDenied! += dotsOf(sized);
      return false;
    }
    if (TEST_ORACLES && opts.verifyResilience && policy.budget)
      budgetDecisions.push({
        requests: w.requests,
        retried: w.retried,
        units: sizeOf(sized),
        budget: policy.budget,
      });
    let u = 0;
    if (policy.jitter) {
      const draw = drawStream(retry.stream ?? streamSeed(seed, edge.id, "retry"));
      retry.stream = draw.state;
      u = draw.value;
    }
    const delay = backoffDelay(policy, branch.attempt!, u);
    if (event.timeout && branch.state === "sent") edge.calls.ambiguous! += dotsOf(sized);
    // A deadline can expire while the pool is full. Remove that queued attempt
    // before resetting its deadline for a retry; otherwise it can dispatch again.
    cancelPending(edge, call.id);
    branch.state = "backoff";
    if (!(call.backingOff ?? 0)) call.backoffAt = time;
    call.backingOff = (call.backingOff ?? 0) + 1;
    branch.retryEvent = nextLogical++;
    retryCount(edge, "retried", sized);
    // A logical attempt includes its scheduled backoff and pool wait, even if a
    // sibling subsequently cancels it. Wire dispatch is tracked by inFlight.
    retryCount(edge, "attempts", sized);
    branch.countedAt = time;
    branch.backoffDots = dotsOf(sized);
    edge.calls.backingOff! += branch.backoffDots;
    scheduleLogical({ id: branch.retryEvent, end: time + delay, edge, call: call.id, retry: true });
    const reason = event.timeout ? "timed out" : String(event.code);
    log(
      "retry",
      call.node,
      message,
      `${edge.to.label}: attempt ${branch.attempt! + 1}/${Math.min(policy.maxAttempts, 10)} after ${delay} ms, ${reason}`,
    );
    if (message.family.trace)
      step(message, "retry", call.node.id, {
        edge: edge.id,
        attempt: branch.attempt! + 1,
        reason,
        backoffMs: delay,
        maxAttempts: Math.min(policy.maxAttempts, 10),
      });
    return true;
  }

  function retryCall(call: Call, edge: Edge): void {
    const timing = call.branches.get(edge.id)!;
    cancelRetry(call, edge);
    timing.attempt!++;
    timing.attemptStartedAt = time;
    timing.state = "queued";
    timing.expiresAt = time + (edge.policy?.deadlineMs ?? Infinity);
    const retried = copy(call.node, call.work.outputMessage ?? call.work.message);
    // A narrowed branch retries only its admitted requests: size it before addressed() counts them as sent.
    if (timing.represented !== undefined) retried.represented = timing.represented;
    const message = {
      ...addressed(retried, edge.requestRoute ?? call.work.message.request),
      width: ledger.get(call.work.thread)?.weight ?? call.work.message.width,
      returnCall: call.id,
      callDepth: call.depth,
      callAttempt: timing.attempt,
    };
    // A narrowed branch's retry still completes its caller's whole cohort's route.
    if (timing.represented !== undefined) creditRoute(message, call.work.message);
    if (!permitBreaker(call, edge, message)) return;
    pushDue(
      edge.poolPending,
      { id: call.id, end: call.id, call, message, admissibleActive: edge.from.activeMs },
      edge.poolPendingIndices,
    );
    scheduleDeadline(call, edge, message);
    dispatchCalls(edge);
  }

  /** Initial attempts and retries start the same classified, per-attempt deadline. */
  function scheduleDeadline(call: Call, edge: Edge, message: Message): void {
    const timing = call.branches.get(edge.id)!;
    if (!Number.isFinite(timing.expiresAt)) return;
    // Every deadline is the attempt's own timeout (504); classified only where retries execute.
    const outcome = classifies ? classifyOutcome("deadline") : undefined;
    timing.deadlineEvent = nextLogical++;
    scheduleLogical({
      id: timing.deadlineEvent,
      end: timing.expiresAt,
      edge,
      call: call.id,
      timeout: true,
      ok: false,
      outcome,
      code: 504,
      represented: message.represented,
      callAttempt: message.callAttempt,
    });
  }

  function cancelDeadline(call: Call, edge: Edge): void {
    const branch = call.branches.get(edge.id)!;
    if (branch.deadlineEvent !== undefined) {
      removeDue(logical, branch.deadlineEvent, logicalIndices);
      branch.deadlineEvent = undefined;
    }
  }

  function retirePool(edge: Edge, callId: number, holdMs: number): void {
    const lease = ledger.get(edge.poolLeases.get(callId));
    if (!lease) return;
    if (TEST_ORACLES && opts.ledgerHold === "none") ledger.release(lease);
    else ledger.retire(lease, holdMs, edge.from.activeMs);
    // A pool narrower than the blocking caller's thread turns the cohort over in more
    // waves than the thread's own stretch: the thread is not admissible before that
    // exact turnover. A pool at least as wide never needs this: its hold is nested in
    // the thread's and stretched by no more, so it always turns over first.
    const thread = edge.policy?.blocking ? ledger.get(calls.get(callId)?.work.thread) : undefined;
    if (thread && lease.turnoverAt !== undefined && lease.weight < thread.weight - 1e-9)
      thread.notBefore = Math.max(thread.notBefore ?? -Infinity, lease.turnoverAt);
    edge.poolLeases.delete(callId);
  }

  function cancelPending(edge: Edge, callId: number): void {
    const pending = removeDue(edge.poolPending, callId, edge.poolPendingIndices);
    if (pending) gone(edge.from, pending.message, "end", "call already failed");
  }

  function releaseCallEdge(call: Call, edge: Edge): void {
    if (!call.held || !edge.policy?.blocking) return;
    const message = call.work.message;
    edge.calls.held = settled(edge.calls.held - (call.heldDots ?? 1));
    const count =
      (call.node.waitingOn.get(edge.id) ?? 0) - (ledger.get<Group>(call.work.thread)?.weight ?? sizeOf(message));
    if (count) call.node.waitingOn.set(edge.id, count);
    else call.node.waitingOn.delete(edge.id);
  }

  /** The blocking branches finished; logical work leaves the thread immediately. */
  function detachCallThread(call: Call): void {
    const { node, work } = call;
    if (node.status === "paused") return;
    retireThread(node, work, node.status === "down");
    call.held = false;
    node.offThreadCalls++;
    node.heldCalls--;
    if (call.brokerHeld) node.heldBrokerCalls--;
    call.brokerHeld = false;
    work.slotted = false;
    endResources(node, work);
    endThreadAdmission(work);
    release(work);
    suspendDelivery(work);
  }

  function releaseCall(call: Call): void {
    if (!calls.delete(call.id)) return;
    const { node, work } = call;
    node.calls.delete(call.id);
    if (call.held) {
      node.heldCalls--;
      if (call.brokerHeld) node.heldBrokerCalls--;
    } else node.offThreadCalls--;
    call.held = false;
    work.waitingCall = undefined;
    work.slotted = false;
    endResources(node, work);
    release(work);
  }

  /** A decided attempt's cause; pre-w2 (and w2 without retry policies) records none, only `ok`. */
  function settledCause(a: Attempt<Message>): OutcomeKind {
    return a.outcome!.cause ?? (a.outcome!.ok ? "success" : "error");
  }

  /**
   * Settles a call's join, which is the caller's own attempt: `cause` is written once unless the join is already
   * decided (by its deadline, or while its node was paused). A continuation is a new attempt with its own cause.
   */
  function settleAttempt(call: Call, cause?: OutcomeKind, releaseNow = false): void {
    const { node, work } = call;
    const a = call.attempt;
    decide(a, cause ?? "error", work.failureCode);
    const hasDeadline = [...call.branches.values()].some((branch) => Number.isFinite(branch.expiresAt));
    for (const id of call.branches.keys()) {
      const edge = faultEdges.get(id)!;
      finishBreaker(call, edge, "call-limit");
      cancelDeadline(call, edge);
      cancelRetry(call, edge);
      cancelPending(edge, call.id);
      if (!a.outcome!.ok && hasDeadline) retirePool(edge, call.id, a.outcome!.at - call.startedAt);
    }
    if (a.committed) {
      if (releaseNow) releaseCall(call);
      return;
    }
    if (node.status === "paused") return;
    let ok = a.outcome!.ok;
    const retry =
      !ok || ((call.replies ?? 0) > 0 && (node.status === "down" || releaseNow))
        ? retryFor(node, work, !releaseNow)
        : "none";
    commitAttempt(a, settledCause(a));
    for (const id of call.outstanding) {
      const edge = faultEdges.get(id)!;
      releaseCallEdge(call, edge);
      cancelPending(edge, call.id);
    }
    call.outstanding.clear();
    work.message.callMs = (work.message.callMs ?? 0) + a.outcome!.at - call.startedAt;
    if (node.role === "source") {
      recordLatency(
        (node.latency ??= createLatencyRecorder()),
        work.message.type,
        a.outcome!.at - call.startedAt,
        0,
        0,
        latencyBudget,
        a.outcome!.at - call.startedAt,
        work.message.backoffMs,
        dotsOf(work.message),
      );
    }
    if (node.role === "processor" && (call.replies ?? 0) > 0 && node.status !== "down" && !releaseNow) {
      // A continuation may take over its own unexpired capacity, never more
      // than its request lease. Retire it as a new logical step on that ownership.
      retireThread(node, work);
      const tail = ledger.get<Group>(work.localThread);
      if (tail) takeoverThread(node, work, tail);
      if (ledger.get<Group>(work.thread)) threadPhase(node, ledger.get<Group>(work.thread), "work");
      const cpuParts = work.cpuParts;
      const replica = work.replica;
      work.cpuParts = work.replica = undefined;
      releaseCall(call);
      work.cpuParts = cpuParts;
      work.replica = replica;
      work.localThread = undefined;
      work.slotted = false;
      work.attempt = undefined;
      work.remaining = call.replyMs ?? 0;
      const pendingCpu = work.cpuRemaining ?? 0;
      work.cpuOwed = work.fractionalTail = undefined;
      work.cpuBacklog = pendingCpu;
      work.cpuRemaining = undefined;
      work.continuation = {
        ok,
        cpuMs: replyCpuMs(node.props.resources?.cpuMsPerMessage ?? 0, call.replies!),
        cause: settledCause(a),
      };
      work.cpuPerRequest = work.continuation.cpuMs;
      const continuationCpu = work.continuation.cpuMs * executionCohort(work);
      const thread = ledger.get<Group>(work.thread);
      work.logicalCpuRemaining = node.props.resources && thread ? work.continuation.cpuMs * thread.weight : undefined;
      if (thread) {
        // On the taken-over tail's ranges (takeoverThread). Backlog is the tail's unfinished CPU
        // only past the CPU part budget; otherwise that stays a tail of its own (I7).
        if (work.cpuParts) {
          const count = work.cpuParts.reduce((sum, p) => sum + p.last - p.first + 1, 0);
          for (const p of work.cpuParts) p.cpu = ((pendingCpu + continuationCpu) * (p.last - p.first + 1)) / count;
        }
        // Already owns a thread/replica, even if a live shrink has removed all
        // admission room. Do not strand that ownership in the pending queue.
        work.cpuRemaining = node.props.resources ? pendingCpu + continuationCpu : undefined;
        work.slotted = true;
        work.workedAt = time;
        scheduleWork(node, work, "takeovers");
      } else {
        // Only the completed own-work cohort owns CPU while this continuation queues.
        // Its new CPU is initialized after the continuation actually gains a thread.
        work.cpuRemaining = pendingCpu;
        if (pendingCpu > 1e-8) node.cpuTail.add(work);
        endResources(node, work);
        work.cpuRemaining = work.cpuBacklog = undefined;
        work.admissibleActive = node.activeMs;
        resumeLater(node, work);
      }
      return;
    }
    if (node.role === "processor" && (call.replies ?? 0) > 0) {
      // The join is settled, but its continuation has never run. Termination is
      // a failed work attempt; it must not rewrite that settled join. Its cause is what ended it.
      work.attempt = undefined;
      commitAttempt(attempt(node, work), ended(node));
      ok = false;
    }
    wakeDelivery(work);
    if (retry !== "inplace") {
      // Direct expiry precedes admission; a propagated 504 can arrive after a
      // child's continuation and keeps the normal reply-phase turnaround.
      const timedOut = [...call.branches.values()].some((branch) => branch.state === "timedOut");
      retireThread(node, work, releaseNow || node.status === "down", timedOut ? 0 : undefined);
      retireRequest(work, releaseNow);
    }
    if (ok) complete(node, work);
    else fail(node, work, retry);
    // Logical acknowledgement releases the broker's delivery slot now. Its
    // retained thread must not later look like a queued pushed request.
    if (call.brokerHeld && !work.held) {
      node.heldBrokerCalls--;
      call.brokerHeld = false;
    }
    if (work.retained) {
      // In-place retries keep the same reservation's immutable start clock.
      calls.delete(call.id);
      node.calls.delete(call.id);
      if (call.held) {
        node.heldCalls--;
        if (work.delivery) node.heldBrokerCalls--;
      } else node.offThreadCalls--;
      work.waitingCall = undefined;
      work.attempt = undefined;
      work.workedAt = time;
      scheduleWork(node, work, "working");
    } else releaseCall(call);
  }

  /** Idle work is O(1): only due arrivals, replies and drain expiries visit call records. */
  function drainLogical(): void {
    while (logical.length && logical[0].end <= time) {
      const event = popDue(logical, logicalIndices);
      const edge = event.edge;
      if (event.thread !== undefined) {
        const reservation = ledger.state.reservations.get(event.thread);
        if (reservation) {
          const node = nodes.get(reservation.owner)!;
          const work = node.threadTails.get(reservation.id)!;
          if (node.status !== "paused" && executionGraceDeadline(node, work) <= time) releaseThread(reservation);
        }
        continue;
      }
      if (event.call !== undefined) {
        const call = calls.get(event.call);
        if (event.grace !== undefined) {
          if (call && call.node.status !== "paused" && executionGraceDeadline(call.node, call.work) <= time) {
            settleAttempt(call, ended(call.node), true);
          }
          continue;
        }
        if (event.retry) {
          if (call && !call.attempt.outcome) retryCall(call, edge!);
          continue;
        }
        // A late reply belongs to its old attempt, never to the current pool
        // lease or deadline. Attempt identity is separate from broker delivery.
        if (edge?.retry && call && event.callAttempt !== call.branches.get(edge.id)!.attempt) {
          edge.calls.late += dotsOf(event);
          continue;
        }
        if (edge?.retry && call?.branches.get(edge.id)?.state === "backoff") {
          edge.calls.late += dotsOf(event);
          continue;
        }
        if (event.timeout && (!call || call.attempt.outcome || !call.outstanding.has(edge!.id))) continue;
        if (
          !event.timeout &&
          call &&
          !call.attempt.outcome &&
          call.outstanding.has(edge!.id) &&
          raceReply(call.branches.get(edge!.id)!, event.end) === "timeout"
        ) {
          event.timeout = true;
          event.ok = false;
          event.outcome = classifies ? classifyOutcome("deadline") : undefined;
          event.code = 504;
          edge!.calls.late += dotsOf(event);
        }
        if (edge && call && !call.attempt.outcome && call.outstanding.has(edge.id))
          finishBreaker(
            call,
            edge,
            event.ok ? "success" : event.timeout ? "deadline" : (event.outcome?.kind ?? "error"),
          );
        if (edge) {
          const lease = ledger.get(edge.poolLeases.get(event.call));
          if (lease)
            retirePool(edge, event.call, event.timeout ? edge.policy!.deadlineMs! : event.end - lease.startedAt!);
          ledger.releaseDue(edge.from.id, edge.from.activeMs);
          dispatchCalls(edge);
        }
        if (!call || call.attempt.outcome || !call.outstanding.has(edge!.id)) {
          edge!.calls.late += dotsOf(event);
          continue;
        }
        cancelDeadline(call, edge!);
        if (event.backoffMs !== undefined)
          call.work.message.backoffMs = Math.max(call.work.message.backoffMs ?? 0, event.backoffMs);
        if (event.timeout) edge!.calls.timedOut += dotsOf(event);
        if (!event.ok) {
          edge!.calls.failed += dotsOf(event);
          if (maybeRetry(call, edge!, event)) continue;
          call.work.failureCode = event.code;
          call.work.timeoutOrigin = event.timeout ? edge!.id : event.timeoutOrigin;
        }
        call.outstanding.delete(edge!.id);
        if (event.ok && edge!.retry) retryCount(edge!, "succeeded", branchSized(call, edge!));
        releaseCallEdge(call, edge!);
        call.branches.get(edge!.id)!.state = event.timeout ? "timedOut" : event.ok ? "replied" : "failed";
        if (edge!.policy?.blocking) call.blockingRemaining--;
        call.attempt.call!.blockingRemaining = call.blockingRemaining;
        if (call.held && call.outstanding.size && call.blockingRemaining === 0) detachCallThread(call);
        call.work.message.visualAt = Math.max(call.work.message.visualAt ?? 0, event.visualAt ?? time);
        if (call.work.outputMessage)
          call.work.outputMessage.visualAt = Math.max(call.work.outputMessage.visualAt ?? 0, event.visualAt ?? time);
        // The join's cause is this branch's: its own deadline, or the reply's classification (a child's outcome).
        const cause: OutcomeKind = event.ok ? "success" : event.timeout ? "deadline" : (event.outcome?.kind ?? "error");
        if (event.timeout) decide(call.attempt, cause, 504, call.branches.get(edge!.id)!.expiresAt);
        if (!event.ok || !call.outstanding.size) settleAttempt(call, cause);
      } else if (edge && event.message) {
        arrived(edge.to, event.message);
        if (cut(edge)) {
          cutPush(edge, event.message);
          continue;
        }
        edge.delivered += dotsOf(event.message);
        log("deliver", edge.to, event.message);
        lineage.arrived(event.message, edge.to.id, edge.id);
        arrive(edge.to, { message: event.message, via: edge, remaining: latency(edge.to) });
      }
    }
  }

  function reply(work: Work, code?: number): void {
    if (work.via?.sync) travel(work.via, work.message, "reply", undefined, 0, code);
  }

  function retryFor(node: Node, work: Work, allowRetry = true): RetryDisposition {
    return retryDisposition({
      delivery: !!work.delivery,
      inplace: node.props.retry === "inplace",
      attempts: work.message.attempts,
      maxDeliveryCount: work.delivery?.broker.props.maxDeliveryCount ?? 0,
      retain: () => allowRetry && canRetain(node, work),
    });
  }

  function fail(node: Node, work: Work, retry: RetryDisposition): void {
    if (retry !== "inplace") finishResident(node, work);
    // A queued retained attempt can fail again while down. Retention belongs only to this attempt.
    work.retained = false;
    node.failed += dotsOf(work.message);
    log("fail", node, work.message, `attempt ${work.message.attempts + 1}`);
    if (work.message.family.trace) step(work.message, "fail", node.id, { attempt: work.message.attempts + 1 });
    if (work.delivery) {
      work.message.attempts++;
      log("retry", work.delivery.broker, work.message, `attempt ${work.message.attempts}`);
      if (work.message.family.trace && work.message.attempts < work.delivery.broker.props.maxDeliveryCount)
        step(work.message, "retry", work.delivery.broker.id, { attempt: work.message.attempts });
      if (retry === "inplace") {
        work.failureCode = undefined;
        work.timeoutOrigin = undefined;
        work.remaining = node.props.retryBackoffMs + latency(node);
        work.waitRemaining = node.props.retryBackoffMs;
        if (node.props.resources) {
          node.cpuTail.delete(work);
          work.cpuOwed = work.fractionalTail = undefined;
          work.cpuPerRequest = node.props.resources.cpuMsPerMessage;
          // The failed cohort's unfinished CPU stays owed, unless an outage ended the
          // attempt: shutdown cancels CPU that has not run, here as for a retained backlog.
          const backlog = node.status === "down" ? 0 : (work.cpuRemaining ?? 0);
          work.cpuBacklog = usesLedger(node) ? backlog : undefined;
          work.cohort = executionCohort(work);
          work.cpuRemaining = (work.cpuBacklog ?? 0) + node.props.resources.cpuMsPerMessage * work.cohort;
          const thread = usesLedger(node) && ledger.get(work.thread);
          work.logicalCpuRemaining = thread ? node.props.resources.cpuMsPerMessage * thread.weight : undefined;
          work.cpuBackoffUntil = time + node.props.retryBackoffMs;
          const count = work.cpuParts?.reduce((sum, p) => sum + p.last - p.first + 1, 0) ?? 0;
          for (const p of work.cpuParts ?? []) p.cpu = (work.cpuRemaining * (p.last - p.first + 1)) / count;
        }
        work.retained = true;
        // A live policy removal must not leave a prior attempt's admission clock
        // able to end this retry's newer CPU backoff early on recovery.
        work.retryAdmissionAt = node.props.admission ? time + node.props.retryBackoffMs : undefined;
        // Retaining the pool does not retain the previous attempt's completed residence.
        if (node.status === "up") startAttempt(node, work);
      } else {
        endAdmission(work);
        release(work);
        travel(
          work.delivery.edge,
          work.message,
          "retry",
          work.delivery,
          work.message.attempts < work.delivery.broker.props.maxDeliveryCount ? node.props.retryBackoffMs : 0,
        );
      }
    } else {
      endAdmission(work);
      answer(work, false);
      if (node.props.admission && node.status !== "down") gone(node, work.message, "end", "processing failed");
      else
        drop(
          node,
          work.message,
          node.status === "down" ? "node down" : "processing failed",
          work.via,
          node.status === "down" ? undefined : work.timeoutOrigin,
        );
    }
  }

  /** Ends the work's current attempt with `cause`: success, or what failed it. */
  function settleWork(node: Node, work: Work, cause: OutcomeKind, allowRetry = true): void {
    finishThreadWork(node, work);
    let ok = cause === "success";
    if (waits()) {
      const a = attempt(node, work);
      if (!commitAttempt(a, cause)) return;
      ok = a.outcome!.ok;
    }
    const retry = ok ? "none" : retryFor(node, work, allowRetry);
    if (retry !== "inplace") {
      retireThread(node, work, node.status === "down" || !allowRetry);
      retireRequest(work, !allowRetry);
    }
    if (ok) complete(node, work);
    else fail(node, work, retry);
    if (work.retained) work.attempt = undefined;
  }

  function finish(node: Node, work: Work): void {
    if (work.continuation) {
      wakeDelivery(work);
      // A continuation replies with its join's cause, unless an outage ends it first.
      const cause = node.status === "down" ? "callee-down" : work.continuation.cause;
      work.continuation = undefined;
      settleWork(node, work, cause);
      return;
    }
    if (node.status === "down") {
      if (work.delivery || node.role === "processor") settleWork(node, work, "callee-down");
      else {
        acknowledge(node, work);
        answer(work, false, "callee-down");
        drop(node, work.message, "node down", work.via);
      }
      return;
    }
    if (
      (node.role === "processor" || node.props.admission || node.faultRate !== undefined) &&
      random() < (node.faultRate ?? work.errorRate ?? node.props.failureRate)
    ) {
      settleWork(node, work, "error");
      return;
    }
    if (waits() && beginCall(node, work)) return;
    settleWork(node, work, "success");
  }

  function complete(node: Node, work: Work): void {
    acknowledge(node, work);
    answer(work, true);
    if (isBroker(node)) {
      publish(node, work.message);
      return;
    }
    processed(node, work.message);
    if (work.injected && (node.role === "sink" || node.role === "store")) forward(node, work.message);
    else if (node.role === "sink") gone(node, work.message, "end", "received");
    else if (node.role === "store") {
      // Outgoing async edges from a store model change feeds / CDC: each gets a copy.
      const feeds = node.outgoing.filter((edge) => accepts(edge, work.message, true, false));
      if (!feeds.length) {
        gone(node, work.message, "end", "stored");
        return;
      }
      const copies = fanOut(node, work.message, feeds.length);
      feeds.forEach((edge, i) => deliver(edge, copies[i], "message"));
    } else {
      // Output renaming happens before the call. Carry the completed path's timing
      // into that copy after its wait and continuation have finished.
      const output = work.outputMessage;
      forward(
        node,
        output && output !== work.message
          ? {
              ...output,
              workMs: work.message.workMs,
              callMs: work.message.callMs,
              ...(work.message.backoffMs === undefined ? {} : { backoffMs: work.message.backoffMs }),
            }
          : work.message,
        work.route,
        work.outputs,
      );
    }
  }

  function tick(): void {
    time += STEP;
    for (const node of nodes.values()) {
      if (node.status !== "up" || held(node)) continue;
      node.activeMs += STEP;
    }
    const fleetChanges = new Set<string>();
    advanceFleets(fleetChanges);
    if (fleetChanges.size) assignReplicas(fleetChanges);
    let resourceClock = false;
    for (const node of nodes.values())
      if (node.fleet) {
        resourceClock = true;
        break;
      }
    // Settle due turnovers before this tick's arrivals, so a node that admits on arrival sees the
    // capacity its cohorts released. At scale 1 nothing is ever due (whole weights release at once).
    earlyPoolWakes = new Set();
    releasingEarly = true;
    for (const node of nodes.values()) ledger.releaseDue(node.id, node.activeMs);
    releasingEarly = false;
    incomingBeforeReleases = !resourceClock;
    if (!resourceClock) {
      admitIncoming();
      incomingAt = time;
    }

    for (const node of nodes.values()) {
      node.cpuTick =
        TEST_ORACLES && opts.verifyResources && node.fleet
          ? {
              before: node.fleet.totalCpu,
              capacityMs:
                node.fleet.ready + node.fleet.draining === 0
                  ? 0
                  : ((node.props.resources!.cpuLimitMilli ?? node.props.resources!.availableCpuMilli ?? Infinity) /
                      1000) *
                    STEP *
                    (node.fleet.ready + node.fleet.draining),
              charges: [],
            }
          : undefined;
      // Pre-W1 processors use service pacing; W1 turnover belongs to the ledger.
      if (
        !waits() &&
        !node.props.admission &&
        node.role === "processor" &&
        scale > 1 &&
        node.props.latencyMs > 0 &&
        node.status === "up"
      ) {
        node.serviceCredit = Math.min(
          Math.max(1, slots(node) / scale),
          node.serviceCredit + (slots(node) * STEP) / (node.props.latencyMs * scale),
        );
      }
      // A network device admits at most its ceiling: real messages/s, in sampled dots.
      const limit = node.role === "gateway" ? ceiling(node) : Infinity;
      if (limit < Infinity && node.status === "up" && !held(node)) {
        const perTick = (limit * STEP) / (1000 * scale);
        // Room for a whole message plus a tick's worth: fractions carry over, and idle time banks no burst.
        node.serviceCredit = Math.min(1 + perTick, node.serviceCredit + perTick);
      }
      if (node.status !== "paused" && !held(node)) {
        const f = node.fleet,
          r = node.props.resources;
        const cpu = prepareCpu(node);
        const cpuBudgets = cpu[0];
        let keep = 0;
        advancingWork = node;
        try {
          for (const work of node.working) {
            if (node.status === "up" && callerReservations(node) && !ledger.get(work.thread)) {
              work.slotted = false;
              endResources(node, work);
              work.admissibleActive = node.activeMs;
              wakeDelivery(work);
              admit(node, work);
              continue;
            }
            if (work.retryAdmissionAt !== undefined && time >= work.retryAdmissionAt && node.status === "up") {
              work.retryAdmissionAt = undefined;
              work.waitRemaining = 0;
              work.workedAt = time;
              work.retained = false;
              work.remaining = latency(node);
              if (!reserveAdmission(node, work)) {
                endResources(node, work);
                work.slotted = false;
                continue;
              }
            }
            work.remaining -= waits() ? Math.max(0, time - Math.max(work.workedAt ?? time, time - STEP)) : STEP;
            let worked = Math.max(0, time - Math.max(work.workedAt ?? time, time - STEP));
            if (work.waitRemaining) {
              const waiting = Math.min(worked, work.waitRemaining);
              work.waitRemaining -= waiting;
              worked -= waiting;
            }
            if (waits() && !work.attempt && !work.waitRemaining) attempt(node, work);
            work.message.workMs += worked;
            work.workedAt = time;
            if (f && r && node.status === "up" && ((work.cpuBackoffUntil ?? 0) <= time || (work.cpuBacklog ?? 0) > 0)) {
              spendCpu(node, work, cpuBudgets);
            }
            const graceExpired = f && executionGraceDeadline(node, work) <= time;
            if (graceExpired) {
              work.retained = false;
              work.slotted = false;
              cancelCpu(work);
              endResources(node, work);
              settleWork(node, work, ended(node), false);
            } else if (
              (work.remaining <= 0 &&
                (node.status === "down" || (work.logicalCpuRemaining ?? work.cpuRemaining ?? 0) <= 1e-8)) ||
              (node.status === "down" && !work.retained)
            ) {
              work.retained = false;
              finish(node, work);
              if (work.retained) node.working[keep++] = work;
              else if (work.waitingCall === undefined) {
                work.slotted = false;
                endResources(node, work);
              }
            } else node.working[keep++] = work;
          }
          node.working.length = keep;
          recountWorking(node);
        } finally {
          advancingWork = undefined;
        }

        finishCpuTails(node, cpu);
        integrateAndScale(node, cpu, fleetChanges);
      }
      if (!node.fleet) {
        admitPending(node);
        node.admittedAt = time;
      }
    }
    if (fleetChanges.size) assignReplicas(fleetChanges);
    drainLogical();
    const poolWakes = earlyPoolWakes;
    earlyPoolWakes = undefined;
    for (const edge of poolWakes) dispatchCalls(edge);
    if (resourceClock) {
      admitIncoming();
      incomingAt = time;
    }
    for (const node of nodes.values())
      if (node.fleet) {
        admitPending(node);
        node.admittedAt = time;
      }
    for (const node of nodes.values()) {
      if (isBroker(node)) pull(node);
      ledger.expireCredits(node.id, node.activeMs);
      finishTickMetrics(node);
    }
    if (TEST_ORACLES && opts.verifyResources) {
      const arriving = new Map<Node, Message[]>();
      onTheWay((node, message) => {
        const list = arriving.get(node);
        if (list) list.push(message);
        else arriving.set(node, [message]);
      });
      opts.verifyResources({
        nodes: [...nodes.values()].map((node) => ({
          ...node,
          executionLedger: usesLedger(node),
          working: resourceWork(node),
          pending: queuedWork(node, groupsByConsumer),
          queue: node.pending,
          workQueues: { working: node.working, pending: queuedWork(node, groupsByConsumer), takeovers: node.takeovers },
          arriving: arriving.get(node) ?? [],
        })),
        time,
        scale,
        capacityMultiplier,
        partBudget,
        ledger: ledger.state,
        admission: {
          inFlight: admission.inFlight,
          limits: admissionLimits(admission),
          retainedExcess: admission.retainedExcess,
          leases: [
            ...ledger.state.reservations.values(),
            ...[...nodes.values()].flatMap((node) =>
              [...liveWork(node, groupsByConsumer)].flatMap((work) =>
                [work.lease, work.threadLease].filter((lease): lease is AdmissionLease => !!lease),
              ),
            ),
          ],
        },
      });
    }
    if (TEST_ORACLES && opts.verifyResilience) {
      opts.verifyResilience({
        time,
        inSystem,
        edges,
        queues: [...nodes.values()]
          .filter((n) => n.props.queue)
          .map((n) => ({
            queued: checkedQueued(n),
            accounted: n.queueUnits,
            limit: n.props.queue?.limit,
          })),
        calls: calls.values(),
        logical,
        budgetDecisions,
        breakerDispatches,
      });
      breakerDispatches = [];
      budgetDecisions = [];
    }
    if (TEST_ORACLES)
      opts.verifyLedger?.({
        time,
        ledger: ledger.state,
        nodes: nodes.values(),
        edges,
        inSystem,
        admissionInFlight: admission.inFlight,
        partBudget,
        logical,
      });
    if (TEST_ORACLES && opts.verifyOutcomes) {
      for (const call of calls.values()) outcomeChecks.set(call.attempt.id, call.attempt);
      opts.verifyOutcomes({ time, attempts: [...outcomeChecks.values()] });
      outcomeChecks.clear();
    }
  }

  /** Compiles a node's routing settings (load, or a live patch of trafficMix/routeTable): never per tick or message. */
  function compileNodeRouting(node: Node): void {
    const raw = node.rawProps;
    node.table =
      routes && raw.routeTable !== undefined && routeTableCapable(node.stencil, node.role)
        ? compileTable(raw.routeTable)
        : undefined;
    const quotas = new Map<string, QuotaRequirement[]>();
    if (node.table)
      for (const action of [
        ...node.table.rules.map((r) => r.action),
        ...(node.table.fallback ? [node.table.fallback] : []),
      ])
        if (action.quotas.length)
          quotas.set(action.key, quotaRequirements(node.id, action.key, action.quotas, planning));
    node.quotas = quotas;
    for (const requirements of quotas.values()) reconfigureQuotas(admission, requirements, time);
    node.mix = node.role === "source" ? compileMix(raw.trafficMix, routes) : undefined;
    node.mixCredit = node.mix ? node.mix.routes.map(() => 0) : [];
    node.mixDeficit = node.mix ? node.mix.routes.map(() => 0) : [];
  }

  function refreshSourceRate(): void {
    sourceRate = 0;
    for (const node of nodes.values()) if (node.role === "source") sourceRate += node.props.ratePerSec;
  }

  function reset(): void {
    cohortDots = new Map();
    ledger.state = { reservations: new Map(), owners: new Map(), nextReservation: 1 };
    partBudget = createCpuPartBudget();
    admission = emptyAdmission();
    reconfigureAdmission(
      admission,
      [...nodes.values()].flatMap((n) => (n.props.admission ? [{ id: n.id, policy: n.props.admission }] : [])),
      planning,
      0,
    );
    refreshSourceRate();
    time = 0;
    incomingAt = undefined;
    incomingBeforeReleases = false;
    accumulator = 0;
    inSystem = 0;
    drawn = 0;
    nextMessage = 1;
    nextParticle = 1;
    nextInjection = 1;
    trips = [];
    echoExpiries = [];
    echoByTime.clear();
    logical = [];
    logicalIndices.clear();
    calls.clear();
    nextCall = 1;
    nextAttempt = 1;
    if (TEST_ORACLES) outcomeChecks.clear();
    nextLogical = 1;
    drawnTrips.clear();
    sourceEmitted = 0;
    injections.length = 0;
    events.length = 0;
    eventHead = 0;
    randomCalls = 0;
    randomState = mulberry32(seed);
    lineage.reset();
    latencyBudget = createLatencyBudget();
    sinceFault = undefined;
    routeCounts = new Map();
    for (const node of nodes.values()) {
      node.latency = undefined;
      node.streams = new Map();
      node.mixCredit.fill(0);
      node.mixDeficit.fill(0);
      node.routeRejections = Object.create(null);
      initializeFleet(node);
      node.pending.clear();
      node.resume.clear();
      node.resumeUnits = 0;
      node.takeovers = [];
      node.staged = 0;
      node.pendingUnits = node.stagedUnits = node.queueUnits = 0;
      node.working.length = 0;
      node.workingUnits = 0;
      node.calls.clear();
      node.threadTails.clear();
      node.cpuTail.clear();
      node.sampledExecution = false;
      node.threadWeight = { work: 0, wait: 0 };
      node.threadCount = { work: 0, wait: 0 };
      node.residentWeight = 0;
      node.residentCount = 0;
      node.requestWeight = node.requestCount = 0;
      node.activeMs = 0;
      node.admittedAt = undefined;
      node.heldCalls = 0;
      node.offThreadCalls = 0;
      node.freeFlight = 0;
      node.heldBrokerCalls = 0;
      node.waitingOn.clear();
      node.incoming = node.incomingUnits = 0;
      node.cursor = 0;
      node.processed = 0;
      node.failed = 0;
      node.deadLettered = 0;
      node.dropped = 0;
      node.outageDropped = 0;
      node.timeoutLosses.clear();
      node.blocked = 0;
      node.shedLost = 0;
      node.shed = 0;
      node.rejected = 0;
      node.rejectionReasons = Object.create(null);
      node.holdUntil = 0;
      node.throughput = 0;
      node.completedThisStep = 0;
      node.trafficCredit = 0;
      node.serviceCredit = 0;
      for (const group of node.groups) {
        group.pending.clear();
        group.pendingUnits = 0;
        group.active = 0;
        group.offThread = 0;
        group.offByNode.clear();
        group.cursor = 0;
        group.activeByNode = Object.create(null);
        group.heldByNode = new Map();
        group.staged = new Map();
      }
    }
    assignReplicas(new Set(nodes.keys()));
    for (const edge of edges) {
      edge.calls = { inFlight: 0, held: 0, timedOut: 0, failed: 0, late: 0, ...(edge.retry ? emptyRetryCounts() : {}) };
      if (edge.breaker) edge.breaker.state = createBreaker();
      if (edge.retry) {
        edge.retry.window = createRetryWindow();
        edge.retry.stream = undefined;
        if (edge.retry.policy.maxAttempts > 10)
          log("status", edge.from, undefined, "Retries capped at 10 attempts per call");
      }
      edge.poolUsed = 0;
      edge.poolPending = [];
      edge.poolPendingIndices.clear();
      edge.poolLeases.clear();
      edge.delivered = 0;
      edge.active = 0;
    }
  }
  const [
    onTheWay,
    deliver,
    accepts,
    latency,
    arrived,
    keepEcho,
    travel,
    forward,
    outputRoutes,
    admitIncoming,
    inject,
    rename,
    cutPush,
  ] = createTransport(
    () => trips,
    () => logical,
    injections,
    waits,
    block,
    scheduleLogical,
    () => nextLogical++,
    () => time,
    () => classifies,
    cut,
    (delta = 0) => (drawn += delta),
    maxParticles,
    () => nextParticle++,
    () => drawnTrips,
    dotsOf,
    step,
    random,
    log,
    drop,
    () => echoByTime,
    () => echoExpiries,
    gone,
    fanOut,
    addressed,
    () => cohort,
    () => cohortDots,
    spend,
    () => nextMessage++,
    opts,
    countRoute,
    () => {
      inSystem++;
    },
    lineage,
    (node, work) => arrive(node, work),
    () => traffic,
    () => engine.trafficLimit(),
    nodes,
    () => scale,
    (delta = 0) => (sourceEmitted += delta),
    drainLogical,
    (trip) => returned(trip),
    () => routes,
    () => nextInjection++,
  );

  const [
    recountWorking,
    recountUnits,
    slots,
    scheduleWork,
    enqueue,
    resumeLater,
    queueBacklog,
    ceiling,
    held,
    endThreadAdmission,
    endAdmission,
    checkedQueued,
    configureShedQueue,
    reserveAdmission,
    arrive,
    admitPending,
  ] = createAdmission(
    dotsOf,
    nodes,
    (visit) => onTheWay(visit),
    callerReservations,
    () => time,
    sizeOf,
    executionCohort,
    settled,
    () => admission,
    retireRequest,
    retireThread,
    waits,
    commitAttempt,
    attempt,
    log,
    acknowledge,
    answer,
    gone,
    opts,
    executionOccupancy,
    () => scale,
    queuedChecks,
    copy,
    () => calls,
    creditRoute,
    () => logicalIndices,
    () => logical,
    ledger,
    () => planning,
    usesLedger,
    endResources,
    (node, work) => admit(node, work),
    random,
    finish,
    startResources,
    startAttempt,
    (group, node, work) => hold(group, node, work),
    (group, node, work) => stage(group, node, work),
    step,
    accepts,
    () => seed,
    block,
    countRoute,
    () => advancingWork,
    (node, work) => executionGraceDeadline(node, work),
    settleWork,
    ended,
    (work) => wakeDelivery(work),
    threadOccupancy,
    reacquireCapacity,
  );

  const [
    stage,
    indexGroups,
    readBrokerMetric,
    travelByConsumer,
    refreshGroupLimit,
    assignReplicas,
    admit,
    hold,
    release,
    suspendDelivery,
    wakeDelivery,
    settleDelivery,
    publish,
    returned,
    pull,
    drainStaged,
  ] = createBroker(
    nodes,
    groupsByConsumer,
    metricGroups,
    lineage,
    () => scale,
    () => capacityMultiplier,
    (id) => compiled.restricted.has(id),
    dotsOf,
    sizeOf,
    settled,
    threadOccupancy,
    slots,
    scheduleWork,
    enqueue,
    accepts,
    cut,
    processed,
    step,
    gone,
    fanOut,
    copy,
    block,
    log,
    deliver,
    drop,
    travel,
  );
  const [
    initializeFleet,
    resetController,
    scheduleController,
    executionGraceDeadline,
    reconcileResources,
    spendCpu,
    advanceFleets,
    prepareCpu,
    finishCpuTails,
    integrateAndScale,
  ] = createResources(
    nodes,
    groupsByConsumer,
    ledger,
    () => time,
    () => scale,
    () => capacityMultiplier,
    () => seed,
    () => partBudget,
    () => nextLogical++,
    waits,
    callerReservations,
    residentRequests,
    memoryRequests,
    threadOccupancy,
    sizeOf,
    slots,
    readBrokerMetric,
    scheduleLogical,
    scheduleThreadGrace,
    endResources,
  );

  const [checkpoint, restore] = createCheckpoints(
    nodes,
    edges,
    faultEdges,
    () => {
      lineage.shareRecords();
      return {
        nodes,
        partBudget,
        latencyBudget,
        edges,
        trips,
        echoExpiries,
        echoByTime,
        drawnTrips,
        logical,
        logicalIndices,
        ledger: ledger.state,
        calls,
        // Only the outcome oracle fills it (Vitest only).
        ...(TEST_ORACLES && { outcomeChecks }),
        injections,
        events,
        admission: {
          buckets: admission.buckets,
          inFlight: admission.inFlight,
          retainedExcess: admission.retainedExcess,
        },
        lineage: lineage.state,
        routeCounts,
        faults,
      };
    },
    () => ({
      time,
      incomingAt,
      incomingBeforeReleases,
      accumulator,
      speed,
      traffic,
      sourceRate,
      sourceEmitted,
      drawn,
      nextMessage,
      nextParticle,
      nextInjection,
      nextCall,
      nextAttempt,
      nextLogical,
      inSystem,
      eventHead,
      seed,
      randomCalls,
      topology,
      scale,
      capacityMultiplier,
      sinceFault,
    }),
    (copy, clock, repair) => {
      partBudget = copy.partBudget;
      latencyBudget = copy.latencyBudget;
      repair(copy);
      trips = copy.trips;
      echoExpiries = copy.echoExpiries;
      echoByTime = copy.echoByTime;
      logical = copy.logical;
      logicalIndices = copy.logicalIndices;
      ledger.state = copy.ledger;
      calls = copy.calls;
      if (TEST_ORACLES) outcomeChecks = copy.outcomeChecks!;
      drawnTrips = copy.drawnTrips;
      injections.splice(0, injections.length, ...copy.injections);
      events.splice(0, events.length, ...copy.events);
      lineage.state = copy.lineage;
      routeCounts = copy.routeCounts;
      faults = copy.faults;
      admission = emptyAdmission();
      reconfigureAdmission(
        admission,
        [...nodes.values()].flatMap((n) => (n.props.admission ? [{ id: n.id, policy: n.props.admission }] : [])),
        planning,
        clock.time,
      );
      restoreAdmission(admission, copy.admission);
      ({
        time,
        incomingAt,
        incomingBeforeReleases,
        accumulator,
        speed,
        traffic,
        sourceRate,
        sourceEmitted,
        drawn,
        nextMessage,
        nextParticle,
        nextInjection,
        nextCall,
        nextAttempt,
        nextLogical,
        inSystem,
        eventHead,
        seed,
        randomCalls,
        scale,
        capacityMultiplier,
        sinceFault,
      } = clock);
      randomState = mulberry32((seed + Math.imul(randomCalls, 0x6d2b79f5)) >>> 0);
      configuration = undefined;
    },
    indexGroups,
    () => topology,
  );

  lineage.setHistory(opts.traceHistory ?? 0);
  const engine: SimEngine = {
    tracer: lineage,
    validateLifecycleActions(actions) {
      if (!revisionAtLeast(planning?.revision, "p3-a1") || !actions.length) return;
      validateAllocationActions(nodes.values(), actions, capacityMultiplier);
    },
    checkpoint,
    restore,
    effectiveProps: (nodeId) => structuredClone(nodes.get(nodeId)?.rawProps ?? {}),
    configuration: () =>
      (configuration ??= Object.fromEntries([...nodes].map(([id, node]) => [id, structuredClone(node.rawProps)]))),
    metrics: () => ({ time, inSystem, pendingInjections: injections.length }),
    fleet(nodeId) {
      const n = nodes.get(nodeId);
      return n?.fleet && n.props.resources ? fleetReadout(n.fleet) : undefined;
    },
    threadUsage(nodeId) {
      const node = nodes.get(nodeId);
      return waits() && node?.waits
        ? { working: node.threadWeight.work / scale, waiting: node.threadWeight.wait / scale }
        : undefined;
    },
    replicaPage(nodeId, page) {
      const n = nodes.get(nodeId);
      return n?.fleet && n.props.resources ? replicaPage(n.fleet, n.props.resources, time, scale, page) : [];
    },
    measure(metric) {
      if ("system" in metric) return inSystem;
      const node = nodes.get(metric.node);
      if (!node) return undefined;
      if (metric.field === "inFlight") return threadOccupancy(node);
      // Counters read as reports do, to 1e-9 dots, so a partial dot's exact total meets an expectation.
      if (metric.field === "timedOut")
        return roundDots(node.outgoing.reduce((sum, edge) => sum + edge.calls.timedOut, 0));
      if (metric.field === "retried")
        return roundDots(node.outgoing.reduce((sum, edge) => sum + (edge.calls.retried ?? 0), 0));
      if (metric.field === "shortCircuited")
        return roundDots(node.outgoing.reduce((sum, edge) => sum + (edge.calls.shortCircuited ?? 0), 0));
      if (metric.field === "amplification") {
        let requests = 0,
          attempts = 0;
        for (const edge of node.outgoing)
          if (edge.retry) {
            const w = retryWindow(edge.retry.window, time);
            requests += w.requests;
            attempts += w.attempts;
          }
        return requests ? attempts / requests : 1;
      }
      if (metric.field === "goodput") return node.throughput;
      if (metric.field === "threadsWaiting") return waits() && node.waits ? node.threadWeight.wait / scale : 0;
      if (metric.field === "threadsBusy")
        return waits() && node.waits ? (node.threadWeight.work + node.threadWeight.wait) / scale : 0;
      if (metric.field === "backlog") return queueBacklog(node);
      if (metric.field === "lag") {
        if (metric.group !== undefined)
          return roundDots(
            node.groups.find((group) => group.name === metric.group)?.pendingUnits ??
              (node.role === "queue" && metric.group === "queue" && !node.groups.length ? node.pendingUnits : 0),
          );
        let lag = node.role === "queue" && !node.groups.length ? node.pendingUnits : 0;
        for (const group of node.groups) lag = Math.max(lag, group.pendingUnits);
        return roundDots(lag);
      }
      return metric.field === "throughput" ? node.throughput : roundDots(node[metric.field]);
    },
    load(diagram: DiagramFile): void {
      if (resourceBudgetExceeded(diagram)) throw new Error(t("autoscaling.budget", { limit: MAX_LIFECYCLE_REPLICAS }));
      faultIndex = faultTopology(diagram);
      faults = new Map();
      faultEdges.clear();
      planning = diagram.planning;
      classifies = false;
      configuration = undefined;
      topology++;
      nodes.clear();
      edges.length = 0;
      compiled = compileTopology(diagram, roleOf);
      for (const input of diagram.nodes) {
        const role = roleOf(input.stencil);
        const rawProps = { ...input.props };
        const status = rawProps.status === "paused" || rawProps.status === "down" ? rawProps.status : "up";
        nodes.set(input.id, {
          id: input.id,
          label: input.label,
          stencil: input.stencil,
          role,
          status,
          baseStatus: status,
          outages: new Set(),
          rawProps,
          props: resolveProps(role, input.label, rawProps, input.stencil, planning),
          replicas: 1,
          activeReplicas: 1,
          outgoing: [],
          groups: [],
          pending: resolveProps(role, input.label, rawProps, input.stencil, planning).queue
            ? new ShedQueue<Work>()
            : new Deque<Work>(),
          staged: 0,
          pendingUnits: 0,
          stagedUnits: 0,
          queueUnits: 0,
          incomingUnits: 0,
          working: [],
          workingUnits: 0,
          calls: new Map(),
          activeMs: 0,
          threadTails: new Map(),
          threadWeight: { work: 0, wait: 0 },
          threadCount: { work: 0, wait: 0 },
          admitting: false,
          admissionDirty: false,
          residentWeight: 0,
          residentCount: 0,
          requestWeight: 0,
          requestCount: 0,
          heldCalls: 0,
          offThreadCalls: 0,
          freeFlight: 0,
          heldBrokerCalls: 0,
          waitingOn: new Map(),
          resume: new Deque(),
          resumeUnits: 0,
          takeovers: [],
          frees: false,
          waits: false,
          callTarget: false,
          cpuTail: new Set(),
          sampledExecution: false,
          incoming: 0,
          cursor: 0,
          processed: 0,
          failed: 0,
          deadLettered: 0,
          dropped: 0,
          outageDropped: 0,
          timeoutLosses: new Map(),
          blocked: 0,
          shedLost: 0,
          shed: 0,
          rejected: 0,
          rejectionReasons: Object.create(null),
          throughput: 0,
          completedThisStep: 0,
          trafficCredit: 0,
          serviceCredit: 0,
          holdUntil: 0,
          mixCredit: [],
          mixDeficit: [],
          streams: new Map(),
          routeRejections: Object.create(null),
          quotas: new Map(),
          targets: new Map(),
        });
      }
      if (retries() && [...nodes.values()].some((n) => n.props.queue)) classifies = true;
      routes = compileRoutes(planning);
      const edgeProps = routes || waits() ? new Map(diagram.edges.map((e) => [e.id, e.props])) : undefined;
      const edgeById = new Map<string, Edge>();
      const deadLetter = deadLetterRoutes(compiled);
      for (const input of compiled.edges) {
        const from = nodes.get(input.from)!,
          to = nodes.get(input.to)!;
        const edge: Edge = {
          ...input,
          priority: edgeProps?.get(input.id)?.priority as import("./types").QueuePriority,
          from,
          to,
          delivered: 0,
          active: 0,
          networkDelayMs: 0,
          poolUsed: 0,
          poolPending: [],
          poolPendingIndices: new Map(),
          poolLeases: new Map(),
          calls: { inFlight: 0, held: 0, timedOut: 0, failed: 0, late: 0 },
        };
        const props = edgeProps?.get(edge.id);
        if (waits()) {
          edge.policy = callPolicy(from.stencil, props?.caller as import("./types").EdgeSimProps["caller"]);
          const delay = props?.networkDelayMs;
          edge.networkDelayMs = typeof delay === "number" && Number.isFinite(delay) ? Math.max(0, delay) : 0;
          if (callEligible(from.role, edge)) {
            from.waits = true;
            if (to.role === "processor") to.callTarget = true;
          }
        }
        const breaker = (props?.caller as import("./types").EdgeSimProps["caller"])?.breaker;
        const retry = (props?.caller as import("./types").EdgeSimProps["caller"])?.retry;
        if (retries() && callEligible(from.role, edge) && (retry || breaker)) {
          classifies = true;
          edge.retry = {
            policy: structuredClone(retry ?? { maxAttempts: 1, backoffMs: 0, strategy: "fixed", retryOn: [] }),
            window: createRetryWindow(),
          };
          if (breaker) edge.breaker = { policy: structuredClone(breaker), state: createBreaker() };
          Object.assign(edge.calls, emptyRetryCounts());
        }
        if (props && routes) {
          // A caller's address belongs to a Request out of a source or service; on a router's edges it's dormant.
          const caller = from.role === "source" || from.role === "processor" || from.role === "none";
          const route =
            caller && edge.sync && typeof props.requestRouteId === "string"
              ? routes!.get(props.requestRouteId)
              : undefined;
          if (route) edge.requestRoute = route;
          const filter = compileFilter(props.requestFilter);
          if (filter) edge.requestFilter = filter;
        }
        edges.push(edge);
        faultEdges.set(edge.id, edge);
        edgeById.set(edge.id, edge);
        // The route the dead-letter check reads as effective (deadLetterRoutes, topology.ts).
        if (deadLetter.get(from.id) === input) from.dlq = edge;
        else if (!edge.dlq) {
          from.outgoing.push(edge);
          from.targets.set(edge.id, edge);
        }
      }
      for (const node of nodes.values()) {
        node.frees =
          node.waits && node.outgoing.filter((e) => callEligible(node.role, e)).every((e) => !e.policy?.blocking);
        compileNodeRouting(node);
      }
      for (const [id, groups] of compiled.groups) {
        const node = nodes.get(id)!;
        node.groups = groups.map((group) => ({
          name: group.name,
          edges: group.edges.map((edge) => edgeById.get(edge.id)!),
          members: group.members,
          limit: 0,
          pending: new Deque(),
          pendingUnits: 0,
          active: 0,
          cursor: 0,
          allocations: new Map(),
          drainOwners: new Map(),
          activeByNode: Object.create(null),
          offThread: 0,
          offByNode: new Map(),
          heldByNode: new Map(),
          staged: new Map(),
          travelTo: travelByConsumer(group.edges),
        }));
      }
      indexGroups();
      traffic = false;
      speed = 1;
      reset();
    },
    step(dtMs: number): void {
      if (!Number.isFinite(dtMs) || dtMs <= 0) return;
      accumulator += dtMs * speed;
      const steps = Math.floor((accumulator + 1e-8) / STEP);
      accumulator = Math.max(0, accumulator - steps * STEP);
      for (let i = 0; i < steps; i++) tick();
    },
    frame() {
      function topWaiting(node: Node): [string, number][] {
        const top: [string, number][] = [];
        for (const entry of node.waitingOn) {
          let i = 0;
          while (i < top.length && top[i][1] >= entry[1]) i++;
          if (i < 3) {
            top.splice(i, 0, entry);
            if (top.length > 3) top.pop();
          }
        }
        return top;
      }
      const particles: Particle[] = [];
      for (const trip of drawnTrips.values())
        if (trip.start <= time)
          particles.push({
            id: trip.id,
            edgeId: trip.edge.id,
            messageId: trip.message.id,
            rootId: trip.message.family.root,
            kind: trip.kind,
            ...(trip.message.callAttempt! > 1 && trip.kind === "message"
              ? { callAttempt: trip.message.callAttempt }
              : {}),
            progress: Math.min(1, Math.max(0, (time - trip.start) / (trip.end - trip.start))),
            type: trip.message.type,
            color: trip.message.request?.color ?? trip.message.color,
            ...(trip.message.request ? { route: trip.message.request.id, marker: trip.message.request.marker } : {}),
            ...(trip.code ? { code: trip.code } : {}),
          });
      const nodeStates: Record<string, NodeSimState> = Object.create(null);
      for (const node of nodes.values()) {
        const lag: Record<string, number> = Object.create(null);
        const backlog = queueBacklog(node);
        for (const group of node.groups) lag[group.name] = roundDots(group.pendingUnits);
        if (node.role === "queue" && !node.groups.length) lag.queue = backlog;
        nodeStates[node.id] = {
          ...(node.latency
            ? {
                latency: sinceFault
                  ? { ...latencyMetrics(node.latency), sinceFault: sinceFault }
                  : latencyMetrics(node.latency),
              }
            : {}),
          id: node.id,
          role: node.role,
          status: node.status,
          backlog,
          lag,
          inFlight: threadOccupancy(node),
          ...(node.waits && node.role === "processor"
            ? {
                threads: {
                  slots: slots(node) / scale,
                  working: node.threadWeight.work / scale,
                  waiting: node.threadWeight.wait / scale,
                  waitingOn: topWaiting(node).map(([id, weight]) => [id, weight / scale]),
                  queued: backlog,
                  ...(node.freeFlight > 0 ? { inFlight: node.freeFlight } : {}),
                },
              }
            : {}),
          processed: roundDots(node.processed),
          failed: roundDots(node.failed),
          deadLettered: roundDots(node.deadLettered),
          dropped: roundDots(node.dropped),
          ...(node.outageDropped ? { outageDropped: roundDots(node.outageDropped) } : {}),
          ...(node.blocked ? { blocked: roundDots(node.blocked) } : {}),
          ...(node.props.queue || node.shed
            ? {
                shed: roundDots(node.shed),
                queueDepth: roundDots(node.queueUnits / scale),
                ...(node.shedLost ? { shedLost: roundDots(node.shedLost) } : {}),
                ...(node.props.queue?.limit === undefined ? {} : { queueLimit: node.props.queue.limit }),
              }
            : {}),
          ...(node.props.admission || node.table || node.props.queue || node.shed
            ? { rejected: roundDots(node.rejected), rejectionReasons: roundCounts(node.rejectionReasons) }
            : {}),
          ...(node.table ? { routeRejections: roundCounts(node.routeRejections) } : {}),
          ...(held(node) ? { failingOver: true } : {}),
          throughput: node.throughput,
          ...(node.fleet && node.props.resources
            ? {
                fleet: fleetReadout(node.fleet),
                resources: resourceReadout(node.fleet, node.props.resources, memoryRequests(node), time, scale),
              }
            : {}),
          replicas: node.replicas,
          activeReplicas: node.activeReplicas,
          idleReplicas: node.replicas - node.activeReplicas,
          ...(isBroker(node) && !node.groups.length ? { noConsumer: true as const } : {}),
        };
      }
      const frame: SimFrame = {
        time: time,
        particles,
        nodes: nodeStates,
        inSystem,
        scale: scale,
      };
      if (faults.size) frame.faults = structuredClone([...faults.values()]);
      if (routes) {
        const counts: Record<string, RouteCounts> = Object.create(null);
        for (const id of routes.keys()) {
          const c = routeCounts.get(id);
          counts[id] = c ? roundRoute(c) : { sent: 0, rejected: 0, completed: 0 };
        }
        frame.routes = counts;
      }
      return frame;
    },
    timeoutLosses(expected) {
      return Object.fromEntries(
        [...nodes].map(([id, node]) => [
          id,
          [...node.timeoutLosses].reduce((sum, [edge, count]) => sum + (expected.has(edge) ? count : 0), 0),
        ]),
      );
    },
    queuedCalls(edgeId: string): number {
      return faultEdges.get(edgeId)?.poolPending.length ?? 0;
    },
    replicaBounds(nodeId) {
      const a = nodes.get(nodeId)?.props.autoscaling;
      if (a?.mode !== "on") return undefined;
      const { min, max } = replicaRange(a.controller, capacityMultiplier);
      return { min, max, multiplier: capacityMultiplier };
    },
    snapshot: () => accountingSnapshot(engine.frame(), time, scale, eventHead),
    inject,
    setLatencySinceFault(on): void {
      latencySinceFault = on;
    },
    setFault(fault): void {
      const problem = faultProblem(fault);
      if (problem) throw new Error(problem);
      if (
        fault.kind === "boundary"
          ? !faultIndex.ranges.has(fault.boundary)
          : fault.kind === "link"
            ? !faultIndex.links.has(fault.edge)
            : !nodes.has(fault.node)
      )
        return;
      const key = faultKey(fault);
      const previous = faults.get(key);
      if (!previous && !faultActive(fault)) return;
      const magnitude = (value: Fault) =>
        value.kind === "boundary"
          ? value.down
          : value.kind === "link"
            ? value.cut
            : value.kind === "slow"
              ? value.factor
              : value.rate;
      if (previous && magnitude(previous) === magnitude(fault)) return;
      if (latencySinceFault) {
        latencyBudget = createLatencyBudget();
        sinceFault = Object.freeze({ atMs: time, fault: Object.freeze(structuredClone(fault)) });
        for (const node of nodes.values()) node.latency = undefined;
      }
      if (faultActive(fault)) faults.set(faultKey(fault), structuredClone(fault));
      else faults.delete(faultKey(fault));
      if (fault.kind === "link") {
        const edge = faultEdges.get(fault.edge)!;
        edge.cut = fault.cut;
      } else if (fault.kind === "fail") {
        nodes.get(fault.node)!.faultRate = fault.rate || undefined;
      } else if (fault.kind === "boundary") {
        const range = faultIndex.ranges.get(fault.boundary)!;
        for (let i = range.start; i < range.end; i++) {
          const node = nodes.get(faultIndex.members[i])!;
          if (fault.down) node.outages.add(fault.boundary);
          else node.outages.delete(fault.boundary);
          changeStatus(node, boundaryDown(node) ? "down" : node.baseStatus);
        }
      } else if (fault.kind === "slow") {
        const node = nodes.get(fault.node)!;
        node.slowFactor = fault.factor;
        node.props = faultProps(
          node,
          resolveProps(node.role, node.label, node.rawProps, node.stencil, planning, node.props.admission),
        );
        for (const group of groupsByConsumer.get(node.id) ?? []) refreshGroupLimit(group);
      }
    },
    setNodeStatus(nodeId: string, status: NodeStatus): void {
      const node = nodes.get(nodeId);
      if (!node) return;
      node.baseStatus = status;
      changeStatus(node, boundaryDown(node) ? "down" : status);
    },
    setNodeProps(nodeId: string, patch: NodeSimProps): void {
      setNodePropsBatch({ [nodeId]: patch });
    },
    setNodePropsBatch,
    trafficLimit: () =>
      partBudget.blocked
        ? "resources"
        : sourceRate / scale > SOURCE_RATE_CAP
          ? "rate"
          : sourceEmitted >= SOURCE_VOLUME_CAP
            ? "volume"
            : undefined,
    setScale(value): void {
      if (TEST_ORACLES && opts.sameArrivals) {
        cohort = resolveScale(value);
        return;
      }
      const next = resolveScale(value);
      if (next === scale) return;
      scale = next;
      recountUnits();
      // A processor's time per sampled dot follows the scale, and so does what may be on the way to it.
      for (const node of nodes.values()) for (const group of node.groups) refreshGroupLimit(group);
    },
    setCapacityMultiplier(value): void {
      setNodePropsBatch({}, value);
    },
    setTraffic(on: boolean): void {
      traffic = on && !engine.trafficLimit();
    },
    setSpeed(value: number): void {
      if (Number.isFinite(value)) speed = Math.max(0.25, Math.min(8, value));
    },
    reset,
  };
  seedSetters.set(engine, (value) => {
    seed = value;
  });
  drawCounters.set(engine, () => randomCalls);
  return engine;
}
