import { cancelCpu } from "../resourceWork";
import type { DiagramFile } from "../../model/types";
import { activeUnits } from "../../stencils/netDevices";
import { SampledLedger } from "../ledger";
import { type Attempt } from "../attempt";
import { ShedQueue } from "../shedQueue";
import { queueGrant } from "../admission";
import { Deque } from "../deque";
import { forwardingTargets } from "../topology";
import { roundDots } from "../units";
import { attemptAdmission, admissionSlots, releaseAdmission } from "../admission";
import { chooseAction, drawStream, pickWeighted, streamSeed, type CompiledRoute } from "../routeMatching";
import { attemptQuotas, reserveContinuation } from "../admission";
import { QUOTA_UNITS } from "../../model/admission";
import { type OutcomeKind } from "../retryPolicy";
import { breakerRecord } from "../breaker";
import type { RouteCounts, EngineOptions, TraceStep } from "../types";
import { isBroker, type Message, type Group, type Work, type Node, type Call, type Logical, type Edge } from "./model";
import type { AdmissionState } from "../admission";

declare const __TEST_ORACLES__: boolean | undefined;
const TEST_ORACLES = typeof __TEST_ORACLES__ === "boolean" && __TEST_ORACLES__;

const quotaReason = (reason: string) => QUOTA_UNITS.some((unit) => reason.endsWith(`: ${unit}`));

/** Synchronous admission bodies; the facade retains the ordered tick and restorable roots. */
export function createAdmission(
  dotsOf: (m?: { represented?: number }) => number,
  nodes: Map<string, Node>,
  onTheWay: (visit: (node: Node, message: Message) => void) => void,
  callerReservations: (node: Node) => boolean,
  time: () => number,
  sizeOf: (m?: { represented?: number }) => number,
  executionCohort: (work: import("../executionReservations").ExecutionWork<Group>) => number,
  settled: (n: number) => number,
  admission: () => AdmissionState,
  retireRequest: (work: Work, immediate?: boolean) => void,
  retireThread: (
    node: Node,
    work: import("../executionReservations").ExecutionWork<Group>,
    immediate?: boolean,
    admissionLagMs?: number,
  ) => void,
  waits: () => boolean,
  commitAttempt: (a: Attempt<Message>, cause: OutcomeKind, legacyCode?: number) => boolean,
  attempt: (node: Node, work: Work) => Attempt<Message>,
  log: (kind: import("../types").SimEventKind, node: Node, message?: Message, detail?: string) => void,
  acknowledge: (node: Node, work: Work) => void,
  answer: (work: Work, ok: boolean, kind?: OutcomeKind, legacyCode?: number | undefined) => void,
  gone: (
    node: Node,
    message: Message,
    kind: "end" | "drop" | "block" | "reject",
    reason: string,
    extra?: Partial<TraceStep>,
  ) => void,
  opts: EngineOptions,
  executionOccupancy: (node: Node) => number,
  scale: () => number,
  queuedChecks: WeakMap<ShedQueue<Work>, { revision: number; units: number }> | undefined,
  copy: (node: Node, message: Message) => Message,
  calls: () => Map<number, Call>,
  creditRoute: (message: Message, cohort: { represented?: number }) => void,
  logicalIndices: () => Map<number, number>,
  logical: () => Logical[],
  ledger: SampledLedger,
  planning: () => DiagramFile["planning"],
  usesLedger: (node: Node) => boolean,
  endResources: (node: Node, work: import("../resourceWork").CpuTail<Group>) => void,
  admit: (node: Node, work: Work) => void,
  random: () => number,
  finish: (node: Node, work: Work) => void,
  startResources: (node: Node, work: import("../executionReservations").ExecutionWork<Group>) => boolean,
  startAttempt: (node: Node, work: Work) => void,
  hold: (group: Group, node: Node, work: Work) => boolean,
  stage: (group: Group, node: Node, work: Work) => void,
  step: (message: Message, kind: import("../types").TraceStepKind, node: string, extra?: Partial<TraceStep>) => void,
  accepts: (edge: Edge, message: Message, fanout?: boolean, injected?: boolean) => boolean,
  seed: () => number,
  block: (message: Message, edge: Edge, extra?: Partial<TraceStep>) => void,
  countRoute: (route: CompiledRoute) => RouteCounts,
  advancingWork: () => Node | undefined,
  executionGraceDeadline: (node: Node, work: import("../resourceWork").ResourceWork) => number,
  settleWork: (node: Node, work: Work, cause: OutcomeKind, allowRetry?: boolean) => void,
  ended: (node: Node) => OutcomeKind,
  wakeDelivery: (work: Work) => void,
  threadOccupancy: (node: Node) => number,
  reacquireCapacity: (node: Node, work: import("../executionReservations").ExecutionWork<Group>) => boolean,
) {
  /** After the working set is rebuilt: its dots again, once per rebuild. */
  const recountWorking = (node: Node) => {
    let dots = 0;
    for (const work of node.working) dots += dotsOf(work.message);
    node.workingUnits = dots;
  };
  /**
   * A partial dot's share is its represented size over the scale, so a scale change recounts every cached dot counter
   * from what it holds (and what each queued work will take back out when it leaves).
   */
  function recountUnits(): void {
    const requeue = (queue: Iterable<Work>) => {
      let dots = 0;
      for (const work of queue) dots += work.queuedUnits = dotsOf(work.message);
      return dots;
    };
    for (const node of nodes.values()) {
      recountWorking(node);
      node.pendingUnits = requeue(node.pending);
      node.resumeUnits = requeue(node.resume);
      node.stagedUnits = node.incomingUnits = 0;
    }
    for (const node of nodes.values())
      for (const group of node.groups) {
        let dots = 0;
        for (const message of group.pending) dots += dotsOf(message);
        group.pendingUnits = dots;
        for (const [id, queue] of group.staged) nodes.get(id)!.stagedUnits += requeue(queue);
      }
    onTheWay((node, message) => (node.incomingUnits += dotsOf(message)));
  }

  function slots(node: Node): number {
    if (callerReservations(node) && node.props.admission) {
      return admissionSlots(node.props.admission, node.activeReplicas);
    }
    if (node.props.admission) return node.props.admission.slots ?? node.props.admission.api.maxInFlight ?? Infinity;
    return node.role === "processor" ? node.activeReplicas * node.props.concurrency : node.props.concurrency;
  }

  /** The source has been consumed by its queue/phase; invalidate any alternate admission path. */
  function scheduleWork(node: Node, work: Work, destination: "working" | "pending" | "takeovers"): void {
    if (work.resumeAtAdmission) node.takeovers = node.takeovers.filter((entry) => entry !== work);
    work.resumeAtAdmission = destination === "takeovers";
    if (destination === "pending") enqueue(node, work);
    else {
      node[destination].push(work);
      if (destination === "working") node.workingUnits += dotsOf(work.message);
    }
  }

  const queueEligible = (work: Work) =>
    !work.delivery && !work.continuation && work.workedAt === undefined && !work.recoveryCapacity;

  function enqueue(node: Node, work: Work): void {
    work.queueProtected = !queueEligible(work);
    work.queuedAt ??= time();
    if (node.props.queue && queueEligible(work)) {
      work.cohort ??= sizeOf(work.message);
      work.message = { ...work.message, represented: executionCohort(work) };
      node.queueUnits += work.queueSize = executionCohort(work);
    }
    node.pendingUnits += work.queuedUnits = dotsOf(work.message);
    node.pending.push(work);
  }

  function dequeue(node: Node, queue: Deque<Work> | ShedQueue<Work>, back = false): Work {
    const work = (back ? queue.pop() : queue.shift())!;
    if (queue === node.pending && work.queueSize !== undefined) {
      node.queueUnits = settled(node.queueUnits - work.queueSize);
      work.queueSize = undefined;
    }
    if (queue === node.pending) node.pendingUnits = node.pending.length ? node.pendingUnits - work.queuedUnits! : 0;
    else if (queue === node.resume) node.resumeUnits = node.resume.length ? node.resumeUnits - work.queuedUnits! : 0;
    return work;
  }

  /** A continuation queues to resume on its node. */
  function resumeLater(node: Node, work: Work): void {
    node.resumeUnits += work.queuedUnits = dotsOf(work.message);
    node.resume.push(work);
  }

  /** Dots queued at a node (pending, continuations and staged deliveries), or its fullest broker group: the one
   * backlog that measure() and frames report. */
  function queueBacklog(node: Node): number {
    let backlog = node.pendingUnits + node.resumeUnits + node.stagedUnits;
    for (const group of node.groups) backlog = Math.max(backlog, group.pendingUnits);
    return roundDots(backlog);
  }

  /** A network device's throughput ceiling in real messages/s: per unit, times the units carrying traffic. */
  function ceiling(node: Node): number {
    const device = node.props.device;
    return device ? device.perUnit * activeUnits(device.ha, node.replicas) : Infinity;
  }

  /** An active-standby pair whose active unit just failed: traffic waits for the standby to take over. */
  function held(node: Node): boolean {
    return node.status === "up" && time() < node.holdUntil;
  }

  function endThreadAdmission(work: Pick<Work, "threadLease">): void {
    releaseAdmission(admission(), work.threadLease);
    work.threadLease = undefined;
  }

  function endAdmission(work: Work): void {
    retireRequest(work);
    endThreadAdmission(work);
    releaseAdmission(admission(), work.lease);
    work.lease = undefined;
  }

  /** A dot this node's admission refused: counted rejected, acknowledged and answered, and its journey ends. */
  function rejectAdmission(node: Node, work: Work, reason: string): void {
    retireThread(node, work);
    const kind = quotaReason(reason) || reason === "concurrency" ? "quota" : "invalid-admission";
    if (node.table) {
      refuse(node, work, reason, kind, quotaReason(reason) ? 429 : undefined, work.route?.rule);
      return;
    }
    if (waits() && !commitAttempt(attempt(node, work), kind)) return;
    const units = dotsOf(work.message);
    node.rejected += units;
    node.rejectionReasons[reason] = (node.rejectionReasons[reason] ?? 0) + units;
    log("reject", node, work.message, reason);
    acknowledge(node, work);
    answer(work, false);
    gone(node, work.message, "reject", reason);
  }

  function shedWork(node: Node, work: Work, reason: string): void {
    const dots = dotsOf(work.message);
    node.shed += dots;
    if (work.message.returnCall === undefined && !work.via?.sync) {
      node.shedLost += dots;
      opts.onLoss?.({ node: node.id, connection: work.via?.id, reason, dots });
    }
    refuse(node, work, reason, "shed", 503);
  }

  /** Only fresh pushed work competes for this queue; broker deliveries and continuations retain ownership. */
  function admitPushed(node: Node, work: Work): void {
    const policy = node.props.queue!;
    work.priority = work.via?.priority ?? "normal";
    // Work that can start immediately is not waiting and does not spend queue room.
    admitPending(node);
    if (
      node.status === "up" &&
      !node.pending.length &&
      !node.resume.length &&
      slots(node) - executionOccupancy(node) + 1e-9 >= Math.min(1, sizeOf(work.message))
    ) {
      enqueue(node, work);
      admitPending(node);
      if (!node.pending.length) return;
      // A physical resource gate can still refuse the apparent thread room. This request really is waiting.
      dequeue(node, node.pending);
    }
    if (!(node.pending instanceof ShedQueue)) {
      const queue = new ShedQueue<Work>();
      for (const pending of node.pending) queue.push(pending);
      node.pending = queue;
    }
    const limit = policy.limit ?? Infinity;
    let grant = queueGrant(node.queueUnits, limit, sizeOf(work.message), true);
    while (grant + 1e-9 < sizeOf(work.message)) {
      const oldest = policy.whenFull === "drop-oldest";
      const victim = node.pending.evict(work, oldest, false);
      if (!victim) break;
      const excess = node.queueUnits + sizeOf(work.message) - limit;
      evictQueued(node, victim, excess, oldest);
      grant = queueGrant(node.queueUnits, limit, sizeOf(work.message), true);
    }
    if (!grant) {
      shedWork(node, work, "shed: queue full");
      return;
    }
    if (grant + 1e-9 < sizeOf(work.message)) splitShed(node, work, grant);
    enqueue(node, work);
  }

  function evictQueued(node: Node, victim: Work, excess: number, oldest: boolean): void {
    if (sizeOf(victim.message) > excess + 1e-9) {
      splitShed(node, victim, sizeOf(victim.message) - excess);
      node.pendingUnits -= excess / scale();
      node.queueUnits = settled(node.queueUnits - excess);
      victim.queueSize! -= excess;
      victim.queuedUnits! -= excess / scale();
      (node.pending as ShedQueue<Work>).touch();
    } else {
      (node.pending as ShedQueue<Work>).evictLowest(oldest);
      node.pendingUnits = node.pending.length ? node.pendingUnits - victim.queuedUnits! : 0;
      node.queueUnits = settled(node.queueUnits - (victim.queueSize ?? 0));
      victim.queueSize = undefined;
      shedWork(node, victim, "shed: queue full");
    }
  }

  /** Reindex once per configuration edit, including work already waiting when a policy is enabled. */
  function checkedQueued(node: Node): number {
    const queue = node.pending;
    const previous = queue instanceof ShedQueue ? queuedChecks?.get(queue) : undefined;
    if (queue instanceof ShedQueue && previous?.revision === queue.revision) return previous.units;
    let units = 0;
    for (const work of queue) if (queueEligible(work)) units += executionCohort(work);
    if (queue instanceof ShedQueue) queuedChecks?.set(queue, { revision: queue.revision, units });
    return units;
  }

  function configureShedQueue(node: Node): void {
    const queue = node.props.queue ? new ShedQueue<Work>() : new Deque<Work>();
    node.queueUnits = 0;
    for (const work of node.pending) {
      work.queueProtected = !queueEligible(work);
      work.priority ??= work.via?.priority ?? "normal";
      work.queueSize = undefined;
      if (node.props.queue && queueEligible(work)) {
        work.cohort ??= sizeOf(work.message);
        work.message = { ...work.message, represented: executionCohort(work) };
        node.queueUnits += work.queueSize = executionCohort(work);
      }
      queue.push(work);
    }
    node.pending = queue;
    if (!(queue instanceof ShedQueue)) return;
    const oldest = node.props.queue?.whenFull === "drop-oldest";
    const limit = node.props.queue?.limit ?? Infinity;
    while (node.queueUnits > limit + 1e-9) {
      const victim = queue.evictLowest(oldest, false);
      if (!victim) break;
      evictQueued(node, victim, node.queueUnits - limit, oldest);
    }
  }

  function splitShed(node: Node, work: Work, kept: number): void {
    const original = work.message;
    const sibling = { ...copy(node, original), attempts: original.attempts, represented: sizeOf(original) - kept };
    work.message = { ...original, represented: kept };
    if (work.cohort !== undefined) work.cohort = kept;
    if (work.attempt) work.attempt.message = work.message;
    // As with half-open probes, the retained branch determines the caller cohort's one outcome.
    // The refused sibling cannot settle it before its admitted requests finish.
    if (original.returnCall !== undefined && work.via) {
      const call = calls().get(original.returnCall),
        branch = call?.branches.get(work.via.id);
      if (
        call &&
        !call.attempt.outcome &&
        branch?.state === "sent" &&
        (branch.attempt ?? 1) === (original.callAttempt ?? 1)
      ) {
        creditRoute(work.message, original);
        branch.represented = kept;
        const deadline = branch.deadlineEvent === undefined ? undefined : logicalIndices().get(branch.deadlineEvent);
        if (deadline !== undefined) logical()[deadline].represented = kept;
        work.via.calls.failed += dotsOf(sibling);
        if (branch.breakerPermit && work.via.breaker) {
          const permit = { ...branch.breakerPermit, units: sizeOf(sibling) };
          breakerRecord(
            work.via.breaker.state,
            work.via.breaker.policy,
            time(),
            "shed",
            time() - (branch.attemptStartedAt ?? time()),
            permit,
          );
          branch.breakerPermit.units -= permit.units;
        }
      }
      sibling.returnCall = undefined;
      sibling.request = undefined;
      sibling.routeCohort = undefined;
    }
    shedWork(node, { message: sibling, via: work.via, remaining: 0 }, "shed: queue full");
  }

  /**
   * The throttle split: this work keeps the admitted partial dot, and a sibling partial dot of the refused
   * requests is rejected at the same instant. The sibling has no delivery of its own: the admitted part keeps
   * the dot's broker slot, and a redelivery carries only the admitted part.
   */
  function splitDot(node: Node, work: Work, admitted: number, refused: number): void {
    const sibling: Message = { ...copy(node, work.message), attempts: work.message.attempts, represented: refused };
    work.message = { ...work.message, represented: admitted };
    if (work.cohort !== undefined) work.cohort = admitted;
    if (work.attempt) work.attempt.message = work.message;
    // The refused part leaves the broker's counters now, as scale 1 acknowledges a rejected delivery.
    if (work.delivery) {
      const d = work.delivery,
        units = Math.min(d.units, dotsOf(sibling));
      d.units -= units;
      d.group.active = settled(d.group.active - units);
      d.group.activeByNode[d.edge.to.id] = settled((d.group.activeByNode[d.edge.to.id] ?? units) - units);
    }
    rejectAdmission(node, { message: sibling, via: work.via, remaining: 0, route: work.route }, "concurrency");
  }

  /** A split needs every part to settle on its own: no caller awaits this dot's one reply, and no CPU is sized. */
  const splittable = (work: Work) =>
    work.message.returnCall === undefined &&
    work.cpuRemaining === undefined &&
    work.cpuParts === undefined &&
    work.replica === undefined;

  function reserveAdmission(node: Node, work: Work, split = false): boolean {
    const policy = node.props.admission;
    if (!policy) return true;
    const retainedRequest = ledger.get<Group>(work.requestLease);
    const retainedThread = ledger.get<Group>(work.thread);
    endThreadAdmission(work);
    releaseAdmission(admission(), work.lease);
    work.lease = undefined;
    const outcome = attemptAdmission(
      admission(),
      node.id,
      policy,
      work.via?.endpointId,
      planning(),
      time(),
      executionCohort(work),
      admissionSlots(policy, node.activeReplicas),
      work.route?.quotas,
      (node.waits || node.callTarget) && node.role === "processor" && scale() > 1,
      retainedRequest
        ? {
            request: { ...retainedRequest, keys: retainedRequest.keys ?? [] },
            thread: retainedThread ? { ...retainedThread, keys: retainedThread.keys ?? [] } : undefined,
          }
        : undefined,
      waits() && (node.fleet || usesLedger(node))
        ? slots(node) -
            executionOccupancy(node) +
            (retainedThread?.weight ?? 0) +
            (!callerReservations(node) && work.replica !== undefined ? 1 : 0)
        : Infinity,
      split && splittable(work),
    );
    if ("rejected" in outcome) {
      if (outcome.waiting) {
        endResources(node, work);
        admit(node, work);
        return false;
      }
      rejectAdmission(node, work, outcome.rejected);
      return false;
    }
    if (outcome.refused) splitDot(node, work, outcome.leases.request.represented, outcome.refused);
    const leases = outcome.leases;
    work.lease = leases.request;
    work.threadLease = leases.thread;
    if (retainedRequest) {
      retainedRequest.keys = leases.request.keys;
      work.lease = undefined;
      if (retainedThread) {
        retainedThread.keys = leases.thread.keys;
        work.threadLease = undefined;
      }
    }
    work.errorRate = outcome.errorRate;
    if (outcome.latencyMs !== undefined)
      work.remaining = outcome.latencyMs * (node.slowFactor ?? 1) * (1 + (random() * 2 - 1) * node.props.jitter);
    if (ledger.get<Group>(work.thread)) work.workSegment = true;
    return true;
  }

  function arrive(node: Node, work: Work): void {
    work.admissibleActive = node.activeMs;
    // Pushed requests (not broker deliveries) for request-rate scalers; real units.
    if (node.fleet && !work.delivery) node.fleet.arrivals += sizeOf(work.message);
    if (node.status === "down") {
      finish(node, work);
      // An in-place retry took a free slot (canRetain); the others went back to the broker.
      if (work.retained) {
        if (!startResources(node, work)) {
          scheduleWork(node, work, "pending");
          return;
        }
        work.workedAt = time();
        startAttempt(node, work);
        scheduleWork(node, work, "working");
        work.slotted = true;
      }
      return;
    }
    // A router with a table matches the address first: a refusal or a deny rule ends the request here, before any
    // admission bucket or service time is spent.
    if (node.table && !work.route && !routeOnArrival(node, work)) return;
    if (node.props.admission) {
      const group = work.delivery?.group;
      if (group && !work.held && !hold(group, node, work)) {
        stage(group, node, work);
        return;
      }
      if (!reserveAdmission(node, work, true)) return;
      if (node.status === "paused") scheduleWork(node, work, "pending");
      else if (work.remaining <= 0 && !node.props.resources?.cpuMsPerMessage) {
        startAttempt(node, work);
        finish(node, work);
      } else {
        if (!startResources(node, work)) {
          scheduleWork(node, work, "pending");
          return;
        }
        work.workedAt = time();
        startAttempt(node, work);
        scheduleWork(node, work, "working");
        work.slotted = true;
        if (work.message.family.trace) step(work.message, "start", node.id);
      }
      return;
    }
    // Pausing a broker stops consumers pulling, not publishers appending to its log.
    if (isBroker(node)) {
      finish(node, work);
      return;
    }
    if (node.status === "paused") {
      if (node.props.queue && !work.delivery) admitPushed(node, work);
      else admit(node, work);
      return;
    }
    if (node.role === "source" || node.role === "sink" || node.role === "none") {
      finish(node, work);
    } else if (node.props.queue && !work.delivery) admitPushed(node, work);
    else admit(node, work);
  }

  /**
   * The router's choice for an arriving request (research §3): first matching rule, else Default, else 404. Only the
   * chosen action's positive-weight targets that pass the connection's filters are eligible; a matched rule is
   * final, so filtering never falls through to a later rule or Default. One seeded draw from the action's own
   * stream picks among them. False when the request ended here (refused, or a deny rule).
   */
  function routeOnArrival(node: Node, work: Work): boolean {
    const message = work.message;
    const choice = chooseAction(node.table!, message.request, !!work.via?.sync);
    if ("legacy" in choice) return true;
    if ("reject" in choice) {
      refuse(node, work, choice.reject, "no-route", 404);
      return false;
    }
    const { action, rule } = choice;
    const { eligible, weights } = forwardingTargets(
      action.targets,
      (id) => node.targets.get(id),
      (edge) => accepts(edge, message),
    );
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (!eligible.length) {
      refuse(node, work, "route-no-eligible-target", "no-route", 404, rule);
      return false;
    }
    let index = 0;
    if (eligible.length > 1) {
      const state = node.streams.get(action.key) ?? streamSeed(seed(), node.id, action.key);
      const draw = drawStream(state);
      node.streams.set(action.key, draw.state);
      index = pickWeighted(weights, draw.value);
    }
    const edge = eligible[index];
    work.route = { edge, rule, weight: weights[index] / total, quotas: node.quotas.get(action.key) ?? [] };
    if (edge.deny) {
      // A deny rule blocks at the sender, as today: blocked on purpose, no admission bucket debited.
      acknowledge(node, work);
      answer(work, true, "success");
      block(message, edge, { rule, weight: work.route.weight, edge: edge.id });
      return false;
    }
    // A router without a P3 policy charges its rule's quotas now; a managed one charges them with its own (atomic).
    if (!node.props.admission && work.route.quotas.length) {
      const refused = attemptQuotas(admission(), work.route.quotas, time(), sizeOf(message));
      if (refused) {
        refuse(node, work, refused, "quota", 429, rule);
        return false;
      }
    }
    return true;
  }

  /**
   * A router refuses a request: counted once as rejected (never dropped, failed or blocked), with its reason and
   * route, a visual refused reply where the request edge has replies, and the branch ends (lineage released).
   */
  function refuse(
    node: Node,
    work: Work,
    reason: string,
    kind: OutcomeKind,
    legacyCode: number | undefined,
    rule?: string,
  ): void {
    if (waits()) {
      const a = attempt(node, work);
      if (!commitAttempt(a, kind, legacyCode)) return;
    }
    const message = work.message;
    const units = dotsOf(message);
    node.rejected += units;
    node.rejectionReasons[reason] = (node.rejectionReasons[reason] ?? 0) + units;
    const key = message.request?.id ?? "";
    node.routeRejections[key] = (node.routeRejections[key] ?? 0) + units;
    if (message.request) countRoute(message.request).rejected += units;
    log("reject", node, message, reason);
    acknowledge(node, work);
    answer(work, false, undefined, legacyCode);
    gone(node, message, "reject", reason, rule === undefined ? undefined : { rule });
  }
  function admitPending(node: Node): void {
    node.admissionDirty = true;
    // A thread-tail release can call back here from finish(). Let the normal
    // post-work admission phase handle it after working has been compacted.
    if (node.admitting || advancingWork() === node) return;
    node.admitting = true;
    try {
      do {
        node.admissionDirty = false;
        admitPendingPass(node);
      } while (node.admissionDirty);
    } finally {
      node.admitting = false;
    }
  }

  function admitPendingPass(node: Node): void {
    const limit = node.role === "gateway" ? ceiling(node) : Infinity;
    if (node.status !== "paused" && !held(node)) {
      if (node.takeovers.length) {
        const finished = new Set<Work>();
        const takeovers = node.takeovers;
        node.takeovers = [];
        for (const work of takeovers) {
          if (!work.resumeAtAdmission) continue;
          const f = node.fleet;
          const expired = f && executionGraceDeadline(node, work) <= time();
          if (node.status === "down" || expired) {
            work.resumeAtAdmission = false;
            cancelCpu(work);
            settleWork(node, work, ended(node), false);
            work.slotted = false;
            endResources(node, work);
            continue;
          }
          if (node.status === "up" && !ledger.get(work.thread)) {
            work.slotted = false;
            endResources(node, work);
            work.admissibleActive = node.activeMs;
            wakeDelivery(work);
            admit(node, work);
            continue;
          }
          scheduleWork(node, work, "working");
          startAttempt(node, work);
          work.workedAt = time();
          if (work.remaining <= 0 && !(work.logicalCpuRemaining ?? work.cpuRemaining ?? 0)) {
            finish(node, work);
            if (!work.retained) {
              finished.add(work);
              if (work.waitingCall === undefined) {
                work.slotted = false;
                endResources(node, work);
              }
            }
          }
        }
        if (finished.size) {
          node.working = node.working.filter((work) => !finished.has(work));
          recountWorking(node);
        }
      }
      while (node.resume.length || node.pending.length) {
        // Brokers without consumers retain their messages until a new diagram is loaded.
        if (isBroker(node) && !node.groups.length) break;
        // A paused arrival can already own the execution keys a continuation
        // needs after a shrink. Let that admitted owner run and release them;
        // prioritizing the unreserved continuation would deadlock both queues.
        const admittedPending = node.pending.peek()?.threadLease;
        const resume = node.resume.peek();
        const queue =
          resume && !(admittedPending && !resume.threadLease && !ledger.get(resume.thread))
            ? node.resume
            : node.pending;
        const back = queue === node.pending && node.props.queue?.order === "lifo";
        const next = (back ? queue.peekBack() : queue.peek())!;
        if (
          queue === node.pending &&
          queueEligible(next) &&
          next.queuedAt !== undefined &&
          node.props.queue?.maxWaitMs !== undefined &&
          time() - next.queuedAt > node.props.queue.maxWaitMs
        ) {
          shedWork(node, dequeue(node, queue, back), "shed: waited too long");
          continue;
        }
        // Admission needs room for at least min(1, N) real units of the next cohort.
        if (
          node.status !== "down" &&
          !(node.fleet || usesLedger(node)
            ? waits()
              ? slots(node) - executionOccupancy(node) + 1e-9 >= Math.min(1, executionCohort(next))
              : executionOccupancy(node) < slots(node)
            : threadOccupancy(node) < slots(node))
        )
          break;
        if (
          node.status === "up" &&
          ((!waits() &&
            !node.props.admission &&
            node.role === "processor" &&
            scale() > 1 &&
            node.props.latencyMs > 0) ||
            limit < Infinity)
        ) {
          // A ceiling paces real messages: a partial dot spends only its own share of a dot's credit.
          const units = dotsOf(next.message);
          if (node.serviceCredit < units - 1e-9) break;
          node.serviceCredit -= units;
        }
        const recovering = !!next.recoveryCapacity;
        if (next.continuation && !recovering && node.props.admission && !next.threadLease && node.status === "up") {
          const policy = node.props.admission;
          next.threadLease = reserveContinuation(
            admission(),
            node.id,
            policy,
            sizeOf(next.message),
            slots(node),
            // A broker's part keeps its real size across a scale change: at scale 1 it may still be larger than the
            // node's slots, and it resumes on a partial grant as it would at a sampling scale (never stuck in resume).
            scale() > 1 || sizeOf(next.message) > 1 + 1e-9,
            ledger.get<Group>(next.requestLease) ?? next.lease,
          );
          if (!next.threadLease) break;
        }
        if (node.status === "up" && !startResources(node, next)) break;
        if (recovering && node.status === "up" && !reacquireCapacity(node, next)) {
          endResources(node, next);
          break;
        }
        const work = dequeue(node, queue, back);
        if (work.continuation) wakeDelivery(work);
        if (
          !work.continuation &&
          !recovering &&
          node.props.admission &&
          !work.lease &&
          node.status === "up" &&
          !reserveAdmission(node, work, true)
        ) {
          endResources(node, work);
          continue;
        }
        startAttempt(node, work);
        if (
          node.status === "down" ||
          (work.remaining <= 0 && !node.props.resources?.cpuMsPerMessage) ||
          isBroker(node) ||
          node.role === "source"
        ) {
          finish(node, work);
          if (work.retained) {
            if (!startResources(node, work)) {
              scheduleWork(node, work, "pending");
              break;
            }
            work.workedAt = time();
            scheduleWork(node, work, "working");
            work.slotted = true;
          } else if (work.waitingCall === undefined) endResources(node, work);
        } else {
          work.workedAt = time();
          scheduleWork(node, work, "working");
          work.slotted = true;
          if (work.message.family.trace) step(work.message, "start", node.id);
        }
      }
    }
  }
  return [
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
    (TEST_ORACLES ? checkedQueued : undefined)!,
    configureShedQueue,
    reserveAdmission,
    arrive,
    admitPending,
  ] as const;
}
