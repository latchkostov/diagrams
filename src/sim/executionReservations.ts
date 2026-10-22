import type { SimRole } from "../model/types";
import type { AdmissionLease, AdmissionLeases, AdmissionState } from "./admission";
import { reacquire, releaseAdmission } from "./admission";
import { acquireReplica, releaseReplica, type Fleet } from "./autoscaling";
import type { ResolvedProps } from "./defaults";
import { SampledLedger, type Reservation } from "./ledger";
import { clearResourceWork, deliveryGroup, yieldsToFirstWaves, type CpuTail, type ResourceWork } from "./resourceWork";
import { sampledParts, releaseCpuParts } from "./sampledResources";
import { STEP } from "./timing";

export interface ExecutionWork<Group> extends ResourceWork {
  message?: { width?: number };
  attempt?: { res: { thread?: number; request?: number } };
  slotted?: boolean;
  thread?: number;
  requestLease?: number;
  localThread?: number;
  /** Capacity lost at shutdown; recovery never charges another quota transaction. */
  recoveryCapacity?: AdmissionLeases;
  recoveryThread?: { represented: number; weight: number };
  lease?: AdmissionLease;
  threadLease?: AdmissionLease;
  admissibleActive?: number;
  executionWeight?: number;
  /** Represented requests its CPU was sized for before any thread or lease held them. */
  cohort?: number;
  /** Open from thread acquisition, or an attempt on a held thread, until its own work finishes. */
  workSegment?: boolean;
  continuation?: { ok: boolean; cpuMs: number };
  via?: { endpointId?: string };
  delivery?: { group: Group; broker: { props: { broker?: { partitioned: boolean } } } };
  group?: Group;
}
interface ExecutionNode<Group> {
  id: string;
  role: SimRole;
  status: string;
  activeMs: number;
  activeReplicas: number;
  props: ResolvedProps;
  fleet?: Fleet;
  sampledExecution: boolean;
  threadWeight: Record<"work" | "wait", number>;
  threadCount: Record<"work" | "wait", number>;
  requestWeight: number;
  requestCount: number;
  cpuTail: Set<CpuTail<Group>>;
  threadTails: Map<number, Reservation<Group>>;
}

/** Execution ownership only. Admission owns quota transactions independently. */
export function createExecutionReservations<
  Group extends {
    allocations: Map<string, number>;
    edges: readonly { from: { props: { broker?: { partitioned: boolean } } } }[];
  },
  Node extends ExecutionNode<Group>,
>(context: {
  ledger: SampledLedger;
  admission: () => AdmissionState;
  scale: () => number;
  time: () => number;
  waits: () => boolean;
  callerReservations: (node: Node) => boolean;
  admissionLag: (node: Node, reservation: Reservation<Group>) => number;
  slots: (node: Node) => number;
  resourceWork: (node: Node) => CpuTail<Group>[];
  scheduleThreadGrace: (id: number, work: Reservation<Group>) => void;
  immediateHolds: () => boolean;
}) {
  type Work = ExecutionWork<Group>;
  const { ledger, callerReservations, slots, resourceWork, scheduleThreadGrace } = context;
  const usesLedger = (node: Node) => context.waits() && node.role === "processor";
  /** Real requests this work executes for, fixed once its thread, admission or CPU is
   * sized. A live scale edit never resizes that cohort, even before a thread holds it. */
  const cohort = (work: Work): number =>
    ledger.get(work.thread)?.represented ??
    ledger.get(work.requestLease)?.represented ??
    work.recoveryCapacity?.request.represented ??
    work.recoveryThread?.represented ??
    work.lease?.represented ??
    work.threadLease?.represented ??
    work.cohort ??
    context.scale();

  function reserveThread(
    node: Node,
    work: Work,
    represented: number,
    room: number,
    cap: number,
    keys?: string[],
    admissibleActive = work.admissibleActive ?? node.activeMs,
  ): Reservation<Group> | undefined {
    const existing = ledger.get<Group>(work.thread);
    if (existing) return existing;
    const thread = ledger.reserve<Group>(
      { owner: node.id, scope: "thread", startActive: node.activeMs, keys },
      represented,
      room,
      cap,
      admissibleActive,
    );
    if (!thread) return;
    work.thread = thread.id;
    // Every acquisition opens a work segment, however the work reached it
    // (admission, recovery, a retry admitted while down, or a takeover).
    // Ledger retirement scales the first wave's hold once by represented/weight.
    // Only that wave blocks logical completion; the remaining CPU belongs to a tail.
    // Waiting for the whole cohort here would scale its CPU duration twice.
    work.workSegment = true;
    const previousWeight = work.executionWeight ?? work.recoveryThread?.weight;
    if (work.logicalCpuRemaining !== undefined && previousWeight !== undefined)
      work.logicalCpuRemaining *= thread.weight / previousWeight;
    if (work.cpuRemaining !== undefined) work.logicalCpuRemaining ??= (work.cpuPerRequest ?? 0) * thread.weight;
    work.recoveryThread = undefined;
    node.threadWeight.work += thread.weight;
    node.threadCount.work++;
    return thread;
  }
  /** Capacity only: preserve the attempt's timing, policy and quota transaction. */
  function reacquireCapacity(node: Node, work: Work): boolean {
    const admission = context.admission();
    if (!usesLedger(node) || ledger.get(work.thread)) return true;
    if (!callerReservations(node)) {
      const retained = work.recoveryThread ?? work.threadLease;
      const thread = reserveThread(
        node,
        work,
        cohort(work),
        slots(node) - node.threadWeight.work - node.threadWeight.wait,
        Math.min(retained?.weight ?? Infinity, work.message?.width ?? Infinity),
      );
      if (!thread) return false;
      thread.requestWeight = thread.weight;
      return true;
    }
    const recovery = work.recoveryCapacity;
    const lease = recovery?.thread ?? work.threadLease ?? work.lease;
    let request = ledger.get(work.requestLease);
    // Admission can precede execution while paused. A live scale edit must not
    // resize that already-charged transaction when it enters the ledger.
    const represented = cohort(work);
    const room = slots(node) - node.threadWeight.work - node.threadWeight.wait;
    let cap = Math.min(
      lease?.weight ?? Infinity,
      request?.weight ?? recovery?.request.weight ?? Infinity,
      work.message?.width ?? Infinity,
    );
    let requestCapacity = recovery?.request ?? work.lease;
    let threadCapacity = recovery?.thread ?? work.threadLease;
    if (recovery) {
      const leases = reacquire(admission, {
        node: node.id,
        policy: node.props.admission,
        endpointId: work.via?.endpointId,
        slots: slots(node),
        room,
        request: request ? undefined : requestCapacity,
        thread: { represented, weight: Math.min(represented, room, cap), keys: threadCapacity?.keys ?? [] },
      });
      if (!leases) return false;
      requestCapacity = leases.request;
      threadCapacity = leases.thread;
      cap = leases.thread.weight;
    }
    const thread = reserveThread(node, work, represented, room, cap, threadCapacity?.keys);
    if (!thread) return false;
    // A paused arrival may have charged more execution capacity before a live
    // shrink. Transfer only the granted weight into the ledger and return the
    // unused part of that slot lease; request residence keeps its own weight.
    if (threadCapacity && threadCapacity.weight > thread.weight)
      releaseAdmission(admission, { ...threadCapacity, weight: threadCapacity.weight - thread.weight });
    work.executionWeight = thread.weight;
    work.threadLease = undefined;
    if (!request) {
      request = ledger.reserve(
        {
          owner: node.id,
          scope: "request",
          startActive: node.activeMs,
          keys: requestCapacity?.keys,
        },
        represented,
        requestCapacity?.weight ?? thread.weight,
        Infinity,
        work.admissibleActive ?? node.activeMs,
      )!;
      node.requestWeight += request.weight;
      node.requestCount++;
      work.requestLease = request.id;
      work.lease = undefined;
    }
    thread.requestWeight = request.weight;
    work.recoveryCapacity = undefined;
    return true;
  }

  /** A continuation can exchange its own tail, but never invent an uncharged lease while waiting. */
  function takeoverThread(node: Node, work: Work, tail: Reservation<Group>): void {
    node.cpuTail.delete(tail);
    work.cpuParts = tail.cpuParts;
    work.cpuRemaining = tail.cpuRemaining;
    work.replica = tail.replica;
    // This CPU becomes continuation backlog and participates in the first-wave loop.
    work.cpuOwed = work.fractionalTail = undefined;
    tail.cpuOwed = tail.fractionalTail = undefined;
    tail.cpuParts = tail.cpuRemaining = tail.replica = undefined;
    node.threadTails.delete(tail.id);
    releaseThread(tail);
    const request = ledger.get<Group>(work.requestLease)!;
    const room = slots(node) - node.threadWeight.work - node.threadWeight.wait;
    const leases = reacquire(context.admission(), {
      node: node.id,
      policy: node.props.admission,
      endpointId: work.via?.endpointId,
      slots: slots(node),
      room,
      thread: {
        represented: request.represented,
        weight: Math.min(request.represented, room, request.weight, work.message?.width ?? Infinity),
        keys: tail.keys ?? [],
      },
    });
    const thread =
      leases &&
      reserveThread(node, work, request.represented, room, leases.thread.weight, leases.thread.keys, node.activeMs);
    // A live shrink can leave the fleet full even after returning the old tail.
    if (thread) {
      work.executionWeight = thread.weight;
      thread.requestWeight = request.weight;
      thread.heldMs = Math.max(
        0,
        ((tail.releaseAt! + (tail.admissionLagMs ?? 0) - node.activeMs) * tail.weight) / tail.represented,
      );
    }
  }

  function startResources(node: Node, work: Work): boolean {
    const scale = context.scale(),
      time = context.time();
    work.group = work.delivery?.group ?? work.group;
    // Live resource enabling attaches CPU to the execution slot already held by this work.
    if (work.slotted && node.status !== "down" && !reacquireCapacity(node, work)) return false;
    if (!node.fleet || !node.props.resources) return true;
    const represented = cohort(work);
    work.cpuPerRequest ??= work.continuation?.cpuMs ?? node.props.resources.cpuMsPerMessage;
    const cpuRemaining = work.cpuRemaining ?? work.cpuPerRequest * represented;
    // Existing threads can exceed a newly lowered limit. Attach their CPU to the
    // shared fleet ranges so every retained slot keeps running without another acquisition.
    node.sampledExecution ||=
      scale > 1 ||
      (usesLedger(node) &&
        node.threadWeight.work + node.threadWeight.wait > node.activeReplicas * node.props.concurrency + 1e-9);
    if (!node.sampledExecution && work.replica === undefined) {
      work.replica = acquireReplica(node.fleet, node.props.concurrency);
      if (work.replica === undefined) return false;
    }
    const r = node.props.resources,
      f = node.fleet;
    if (node.sampledExecution && !work.cpuParts && work.replica === undefined) {
      const partitioned =
        work.delivery?.broker.props.broker?.partitioned ?? work.group?.edges[0]?.from.props.broker?.partitioned;
      const eligible = partitioned
        ? Math.min(node.activeReplicas, work.group?.allocations.get(node.id) ?? 0)
        : node.activeReplicas;
      work.cpuParts = sampledParts(f, eligible, cpuRemaining, () => resourceWork(node));
      if (!work.cpuParts) return false;
      creditSampledMemory(node, Math.max(0, (work.cpuBackoffUntil ?? time) - time));
    }
    // Failed acquisition has no execution owner yet. A later scale edit may change
    // its admitted cohort, so do not retain CPU initialized for the failed attempt.
    // Retained CPU fixes the cohort: a later thread must execute the same requests.
    work.cpuRemaining = cpuRemaining;
    work.cohort = represented;
    // Resources can be enabled after this request already acquired its ledger thread.
    const thread = usesLedger(node) && ledger.get(work.thread);
    if (thread) work.logicalCpuRemaining ??= work.cpuPerRequest * thread.weight;
    const occupancy =
      work.replica === undefined
        ? Math.min(scale, node.activeReplicas * node.props.concurrency) / Math.max(1, node.activeReplicas)
        : (f.busy.get(work.replica)?.count ?? 0);
    if (r.memoryLimitMiB !== undefined && r.baselineMemoryMiB + occupancy * r.memoryMiBPerMessage > r.memoryLimitMiB)
      f.unsafe = true;
    return true;
  }
  /** Own work already finished: attach physical ownership without inventing another CPU slice. */
  function attachIdleResources(node: Node, work: Work): boolean {
    work.cpuPerRequest ??= 0;
    work.cpuRemaining ??= 0;
    work.logicalCpuRemaining ??= 0;
    return startResources(node, work);
  }

  function creditSampledMemory(node: Node, backoff: number): void {
    const scale = context.scale();
    const r = node.props.resources!;
    const cores = (r.cpuLimitMilli ?? r.availableCpuMilli ?? Infinity) / 1000;
    const residence = Math.max(STEP, node.props.latencyMs, (r.cpuMsPerMessage * node.props.concurrency) / cores);
    node.fleet!.memoryCredit += scale * (backoff + residence);
  }
  function shutdown(node: Node, works: Iterable<Work>): void {
    for (const work of works) {
      const backlog = Math.min(work.cpuBacklog ?? 0, work.cpuRemaining ?? 0);
      if (backlog > 0) {
        const fraction = 1 - backlog / work.cpuRemaining!;
        for (const part of work.cpuParts ?? []) part.cpu *= fraction;
        work.cpuRemaining! -= backlog;
        work.cpuBacklog = 0;
      }
      const request = ledger.get(work.requestLease);
      const thread = ledger.get(work.thread);
      if (request)
        work.recoveryCapacity = {
          request: { weight: request.weight, represented: request.represented, keys: request.keys ?? [] },
          thread: thread
            ? { weight: thread.weight, represented: thread.represented, keys: thread.keys ?? [] }
            : undefined,
        };
      if (thread) work.recoveryThread = { represented: thread.represented, weight: thread.weight };
      work.thread = work.requestLease = work.localThread = undefined;
      if (work.attempt) work.attempt.res = {};
    }
    ledger.releaseOwner(node.id);
    for (const tail of [...node.cpuTail]) endResources(node, tail);
  }

  function disableResources(node: Node, works: Iterable<ResourceWork>): void {
    for (const work of works) {
      if (node.fleet) releaseCpuParts(node.fleet, work);
      clearResourceWork(work);
    }
    node.cpuTail.clear();
    node.fleet = undefined;
  }
  function releaseThread(reservation: Reservation): void {
    ledger.release(reservation);
  }
  function endResources(node: Node, work: CpuTail<Group>): void {
    if (!node.fleet) return;
    if (node.cpuTail.delete(work) && node.status === "up" && (work.cpuRemaining ?? 0) > 1e-8) {
      node.cpuTail.add({
        group: deliveryGroup(work),
        cpuParts: work.cpuParts,
        cpuRemaining: work.cpuRemaining,
        cpuOwed: work.cpuOwed,
        // Classified here when the tail forms and detaches in one tick: the work still knows its request CPU.
        fractionalTail: yieldsToFirstWaves(work, node.props.resources?.cpuMsPerMessage ?? 0),
        replica: work.replica,
      });
      work.cpuParts = undefined;
      work.replica = undefined;
      work.cpuOwed = work.fractionalTail = undefined;
    }
    releaseReplica(node.fleet, work.replica, node.props.concurrency);
    work.replica = undefined;
    work.memorySlots = undefined;
    releaseCpuParts(node.fleet, work);
  }
  /** Retired thread ownership is capacity only; terminal residency has one finalizer. */
  function retireThread(node: Node, work: Work, immediate = false, admissionLagMs?: number): void {
    const r = ledger.get<Group>(work.thread);
    if (!r) return;
    work.thread = undefined;
    r.group = work.delivery?.group;
    const tail = node.cpuTail.delete(work);
    if (tail) node.cpuTail.add(r);
    r.cpuParts = work.cpuParts;
    r.cpuRemaining = work.cpuRemaining;
    r.cpuOwed = work.cpuOwed;
    r.fractionalTail = tail ? yieldsToFirstWaves(work, node.props.resources?.cpuMsPerMessage ?? 0) : undefined;
    r.replica = work.replica;
    work.cpuParts = work.cpuRemaining = work.replica = work.logicalCpuRemaining = work.cpuBacklog = undefined;
    work.cpuOwed = work.fractionalTail = undefined;
    node.threadTails.set(r.id, r);
    work.localThread = r.id;
    if (immediate || !usesLedger(node) || context.immediateHolds()) ledger.release(r);
    // Stretch only the turnaround that scale one actually waits through: a
    // reply before this tick's next admission opportunity has no extra lag.
    else
      ledger.retire(
        r,
        node.activeMs - (r.segmentActive ?? r.startActive),
        node.activeMs,
        admissionLagMs ?? (r.phase === "wait" ? context.admissionLag(node, r) : 0),
      );
    if (node.threadTails.has(r.id)) scheduleThreadGrace(r.id, r);
  }

  return {
    /** A connection inherits the thread's fractional admission phase. */
    admissibleActive(node: Node, work: Work) {
      const thread = ledger.get(work.thread);
      return node.activeMs - (thread ? (thread.segmentActive ?? thread.startActive) - thread.startActive : 0);
    },
    usesLedger,
    cohort,
    reacquireCapacity,
    startResources,
    attachIdleResources,
    endResources,
    retireThread,
    releaseThread,
    takeoverThread,
    shutdown,
    disableResources,
  };
}
