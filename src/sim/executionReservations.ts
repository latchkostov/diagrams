import type { SimRole } from "../model/types";
import type { AdmissionLease, AdmissionLeases, AdmissionState } from "./admission";
import { reacquire, releaseAdmission } from "./admission";
import { acquireReplica, releaseReplica, type Fleet } from "./autoscaling";
import type { ResolvedProps } from "./defaults";
import { SampledLedger, type Reservation } from "./ledger";
import { clearResourceWork, deliveryGroup, type CpuTail, type ResourceWork } from "./resourceWork";
import { sampledParts, releaseCpuParts } from "./sampledResources";
import { STEP } from "./timing";

export interface ExecutionWork<Group> extends ResourceWork {
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
  slots: (node: Node) => number;
  resourceWork: (node: Node) => CpuTail<Group>[];
  scheduleThreadGrace: (id: number, work: Reservation<Group>) => void;
  immediateHolds: () => boolean;
}) {
  type Work = ExecutionWork<Group>;
  const { ledger, callerReservations, slots, resourceWork, scheduleThreadGrace } = context;
  const usesLedger = (node: Node) => context.waits() && node.role === "processor";

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
    node.threadWeight.work += thread.weight;
    node.threadCount.work++;
    return thread;
  }
  /** Capacity only: preserve the attempt's timing, policy and quota transaction. */
  function reacquireCapacity(node: Node, work: Work): boolean {
    const admission = context.admission(),
      scale = context.scale();
    if (!usesLedger(node) || ledger.get(work.thread)) return true;
    if (!callerReservations(node)) {
      const retained = work.recoveryThread ?? work.threadLease;
      const thread = reserveThread(
        node,
        work,
        retained?.represented ?? scale,
        slots(node) - node.threadWeight.work - node.threadWeight.wait,
        retained?.weight ?? Infinity,
      );
      if (!thread) return false;
      thread.requestWeight = thread.weight;
      work.recoveryThread = undefined;
      return true;
    }
    const recovery = work.recoveryCapacity;
    const lease = recovery?.thread ?? work.threadLease ?? work.lease;
    let request = ledger.get(work.requestLease);
    // Admission can precede execution while paused. A live scale edit must not
    // resize that already-charged transaction when it enters the ledger.
    const represented = request?.represented ?? recovery?.request.represented ?? lease?.represented ?? scale;
    const room = slots(node) - node.threadWeight.work - node.threadWeight.wait;
    let cap = Math.min(lease?.weight ?? Infinity, request?.weight ?? recovery?.request.weight ?? Infinity);
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
    // Recovery can resize execution while preserving the per-request fraction already done.
    // The cohort's total remaining CPU is unchanged; only its current first wave changes.
    if (work.logicalCpuRemaining !== undefined && work.executionWeight !== undefined)
      work.logicalCpuRemaining *= thread.weight / work.executionWeight;
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
        weight: Math.min(request.represented, room, request.weight),
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
    const represented =
      ledger.get(work.thread)?.represented ??
      ledger.get(work.requestLease)?.represented ??
      work.lease?.represented ??
      scale;
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
    work.cpuRemaining = cpuRemaining;
    // Resources can be enabled after this request already acquired its ledger thread.
    const thread = callerReservations(node) && ledger.get(work.thread);
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
        replica: work.replica,
      });
      work.cpuParts = undefined;
      work.replica = undefined;
    }
    releaseReplica(node.fleet, work.replica, node.props.concurrency);
    work.replica = undefined;
    work.memorySlots = undefined;
    releaseCpuParts(node.fleet, work);
  }
  /** Retired thread ownership is capacity only; terminal residency has one finalizer. */
  function retireThread(node: Node, work: Work, immediate = false): void {
    const r = ledger.get<Group>(work.thread);
    if (!r) return;
    work.thread = undefined;
    r.group = work.delivery?.group;
    if (node.cpuTail.delete(work)) node.cpuTail.add(r);
    r.cpuParts = work.cpuParts;
    r.cpuRemaining = work.cpuRemaining;
    r.replica = work.replica;
    work.cpuParts = work.cpuRemaining = work.replica = work.logicalCpuRemaining = work.cpuBacklog = undefined;
    node.threadTails.set(r.id, r);
    work.localThread = r.id;
    if (immediate || !callerReservations(node) || context.immediateHolds()) ledger.release(r);
    // Resource-backed nodes have a second admission phase after logical replies.
    else
      ledger.retire(r, node.activeMs - (r.segmentActive ?? r.startActive), node.activeMs, node.fleet ? 0 : undefined);
    if (node.threadTails.has(r.id)) scheduleThreadGrace(r.id, r);
  }

  return {
    usesLedger,
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
