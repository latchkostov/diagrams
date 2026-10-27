import {
  createFleet,
  reconcileFleet,
  advanceFleet,
  chargeCpu,
  integrateResources,
  evaluateHpa,
  commitScalingChange,
  type Fleet,
} from "../autoscaling";
import { controllerSyncMs, replicaRange } from "../../model/resourceRuntime";
import type { ExecutableController } from "../../model/autoscaling";
import { evaluateCloud, onDemand, resetCloud, type CloudReads } from "../cloudScalers";
import { evaluateKeda, resetKeda, type BrokerMetric, type ScalerTrigger } from "../keda";
import { canDrainSampled, retainSampledDrains, releaseSampledDrains } from "../sampledResources";
import {
  cancelCpu,
  chargeTails,
  tailEntitlements,
  yieldsToFirstWaves,
  type CpuBudgets,
  type CpuPartBudget,
  type ResourceWork,
} from "../resourceWork";
import type { SampledLedger, Reservation } from "../ledger";
import { STEP } from "../timing";
import { resourceWork, type Node, type Work, type Group, type Logical } from "./model";

/** Resource bodies run only at their original sites in the facade's ordered tick. */
export function createResources(
  nodes: Map<string, Node>,
  groupsByConsumer: Map<string, Group[]>,
  ledger: SampledLedger,
  time: () => number,
  scale: () => number,
  capacityMultiplier: () => number,
  seed: () => number,
  partBudget: () => CpuPartBudget,
  logicalId: () => number,
  waits: () => boolean,
  callerReservations: (node: Node) => boolean,
  residentRequests: (node: Node) => number,
  memoryRequests: (node: Node) => number,
  threadOccupancy: (node: Node) => number,
  sizeOf: (message?: { represented?: number }) => number,
  slots: (node: Node) => number,
  readBrokerMetric: (trigger: ScalerTrigger) => BrokerMetric | undefined,
  scheduleLogical: (event: Logical) => void,
  scheduleThreadGrace: (id: number, work: Reservation<Group>) => void,
  endResources: (node: Node, work: ResourceWork) => void,
) {
  function initializeFleet(node: Node): void {
    if (!node.props.resources) {
      node.fleet = undefined;
      return;
    }
    const c = node.props.autoscaling?.mode === "on" ? node.props.autoscaling.controller : undefined;
    node.fleet = createFleet(
      c
        ? replicaRange(c, capacityMultiplier()).initial
        : Math.max(1, Math.round(node.props.replicas * capacityMultiplier())),
      { concurrency: node.props.concurrency, syncMs: c ? controllerSyncMs(c) : undefined, partBudget: partBudget() },
    );
    node.fleet.paused = node.status === "paused";
    resetController(node, node.fleet, c);
    if (node.fleet.paused) node.fleet.pausedAt = time();
  }

  /** KEDA and Container Apps own a poll clock; every controller owns its next evaluation. */
  function resetController(node: Node, f: Fleet, c: ExecutableController | undefined): void {
    if (c?.kind === "keda") resetKeda(f, c, time());
    else if (c && c.kind !== "hpa") resetCloud(f, c, time(), node.id, cloudReads(node));
  }

  function scheduleController(node: Node): void {
    const f = node.fleet!,
      a = node.props.autoscaling;
    if (f.keda && a?.mode === "on" && "pollingMs" in a.controller) f.keda.nextPoll = time() + a.controller.pollingMs;
    f.nextSync = time() + (a?.mode === "on" ? controllerSyncMs(a.controller) : 15_000);
  }

  /** Held deliveries are in this node's queue or work; the rest of its queue is pushed requests. O(groups + work). */
  function waitingRequests(node: Node): number {
    let held = 0;
    for (const group of groupsByConsumer.get(node.id) ?? []) held += group.heldByNode.get(node.id) ?? 0;
    let working = 0;
    for (const work of node.working) if (work.delivery) working++;
    for (const work of node.takeovers) if (work.delivery) working++;
    working += node.heldBrokerCalls;
    return Math.max(0, node.pending.length - (held - working)) * scale();
  }

  function cloudReads(node: Node): CloudReads {
    return {
      routed(source) {
        const lb = nodes.get(source);
        if (!lb) return undefined;
        let count = 0;
        for (const edge of lb.outgoing) if (edge.to === node && edge.sync) count += edge.delivered;
        return count * scale();
      },
      waiting: () => waitingRequests(node),
      inFlight: () =>
        callerReservations(node) ? node.threadWeight.work + node.threadWeight.wait : residentRequests(node),
      broker: (t) => readBrokerMetric(t),
    };
  }

  /** Every execution owner uses the same physical termination clock. */
  function executionGraceDeadline(node: Node, work: ResourceWork): number {
    let at = work.replica === undefined ? Infinity : (node.fleet?.busy.get(work.replica)?.drainAt ?? Infinity);
    for (const part of work.cpuParts ?? []) at = Math.min(at, part.drainAt ?? Infinity);
    return at;
  }

  function reconcileResources(node: Node, desired: number): boolean {
    const f = node.fleet!,
      r = node.props.resources!;
    const sampled = node.sampledExecution || scale() > 1 || node.threadTails.size > 0;
    if (sampled && !canDrainSampled(f, desired, resourceWork(node))) return false;
    const before = sampled ? f.ranges.slice(f.rangeHead).map((c) => ({ ...c })) : [];
    // Live overrides made during a pause start on the same frozen lifecycle clock.
    const lifecycleTime = node.status === "paused" ? (f.pausedAt ?? 0) : time();
    reconcileFleet(f, desired, r, lifecycleTime, seed(), node.id);
    if (sampled) retainSampledDrains(f, before, resourceWork(node), lifecycleTime + r.terminationGraceMs);
    for (const call of node.calls.values()) {
      const at = executionGraceDeadline(node, call.work);
      if (Number.isFinite(at)) scheduleLogical({ id: logicalId(), end: at, call: call.id, grace: at });
    }
    for (const [id, work] of node.threadTails) scheduleThreadGrace(id, work);
    return true;
  }

  function spendCpu(
    node: Node,
    work: ResourceWork,
    budgets: Map<number | string, { remaining: number; count: number }> | undefined,
    tail = false,
  ): void {
    const f = node.fleet!;
    const before = work.cpuRemaining ?? 0;
    const logical = !tail && "logicalCpuRemaining" in work ? (work as Work) : undefined;
    const logicalBefore = logical?.logicalCpuRemaining;
    const backlogBefore = logical?.cpuBacklog ?? 0;
    const eligible = (work.cpuBackoffUntil ?? 0) <= time();
    // A partial first wave can occupy only its reserved requests' replica capacity.
    // Cohort CPU beyond that wave remains available to the tail after completion.
    const cores = (node.props.resources!.cpuLimitMilli ?? node.props.resources!.availableCpuMilli ?? Infinity) / 1000;
    const firstWaveBudget = eligible
      ? Math.min(
          logicalBefore ?? 0,
          (logical?.executionWeight ?? ledger.get(logical?.thread)?.weight ?? 0) * cores * STEP,
        )
      : 0;
    const available = firstWaveBudget + backlogBefore;
    if (logicalBefore !== undefined && available <= 1e-8) return;
    const fraction = logicalBefore === undefined || !before ? 1 : Math.min(1, available / before);
    if (work.cpuParts) {
      for (const p of work.cpuParts)
        if (p.cpu > 0) {
          const budget = budgets?.get(p.key);
          if (!budget) continue;
          const spent = Math.min(p.cpu * fraction, budget.remaining / budget.count);
          p.cpu -= spent;
          budget.remaining -= spent;
          budget.count--;
          chargeCpu(f, undefined, spent, p.drainAt === undefined, time());
        }
      work.cpuRemaining = work.cpuParts.reduce((sum, p) => sum + p.cpu, 0);
    } else {
      const budget = budgets?.get(work.replica ?? 0);
      if (budget && work.cpuRemaining !== undefined) {
        const spent = Math.min(work.cpuRemaining * fraction, budget.remaining / budget.count);
        work.cpuRemaining -= spent;
        budget.remaining -= spent;
        budget.count--;
        chargeCpu(f, work.replica, spent, true, time());
      }
    }
    const spent = before - (work.cpuRemaining ?? 0);
    if (logicalBefore !== undefined) {
      const firstWave = Math.min(firstWaveBudget, spent);
      logical!.logicalCpuRemaining = logicalBefore - firstWave;
      logical!.cpuBacklog = Math.max(0, backlogBefore - (spent - firstWave));
    }
    node.cpuTick?.charges.push({
      before,
      after: work.cpuRemaining ?? 0,
      logicalBefore,
      logicalAfter: logical?.logicalCpuRemaining,
      backlogBefore,
      backlogAfter: logical?.cpuBacklog,
      eligible,
      weight: logical?.executionWeight ?? ledger.get(logical?.thread)?.weight,
      cpuMs: logical?.cpuPerRequest,
    });
  }
  function advanceFleets(fleetChanges: Set<string>): void {
    for (const node of nodes.values()) {
      const f = node.fleet;
      if (!f || node.status !== "up") continue;
      if (advanceFleet(f, time(), () => resourceWork(node))) fleetChanges.add(node.id);
    }
  }
  function prepareCpu(node: Node) {
    const f = node.fleet,
      r = node.props.resources;
    const cpuBudgets: CpuBudgets | undefined = f && r ? new Map() : undefined;
    let retained = 0,
      priorSlots = 0,
      priorOccupancy = 0;
    if (f && r) {
      const milli = r.cpuLimitMilli ?? r.availableCpuMilli ?? Infinity;
      for (const work of [...node.working, ...node.cpuTail]) {
        // Work admitted under an older, larger concurrency keeps that residence; every attempt alongside it
        // (a sampled dot may round past the new capacity) still owns its memory.
        if (work.memorySlots !== undefined) priorSlots = Math.max(priorSlots, work.memorySlots);
        // Tails carry no message and keep a whole dot's estimate.
        const size = sizeOf((work as Work).message);
        priorOccupancy += size;
        if (work.cpuParts && (work.cpuBackoffUntil !== undefined || work.memorySlots !== undefined)) retained += size;
        if (
          ("resumeAtAdmission" in work && work.resumeAtAdmission) ||
          work.cpuRemaining === undefined ||
          (!node.cpuTail.has(work) && (work.logicalCpuRemaining ?? Infinity) + (work.cpuBacklog ?? 0) <= 1e-8) ||
          ((work.cpuBackoffUntil ?? 0) > time() && !(work.cpuBacklog ?? 0))
        )
          continue;
        const first = node.cpuTail.has(work) ? 0 : 1;
        if (work.cpuParts) {
          for (const p of work.cpuParts)
            if (p.cpu > 0) {
              const key = p.key,
                budget = cpuBudgets?.get(key) ?? {
                  remaining: (milli / 1000) * STEP * (p.last - p.first + 1),
                  count: 0,
                  first: 0,
                };
              budget.count++;
              budget.first! += first;
              cpuBudgets?.set(key, budget);
            }
        } else {
          const id = work.replica ?? 0;
          const budget = cpuBudgets?.get(id) ?? { remaining: (milli / 1000) * STEP, count: 0, first: 0 };
          budget.count++;
          budget.first! += first;
          cpuBudgets?.set(id, budget);
        }
      }
    }
    // Retained attempts own memory throughout backoff and every retry, even after their
    // original service-time credit runs out. Ordinary sampled work keeps its residence estimate.
    const occupancy =
      f && r
        ? callerReservations(node)
          ? memoryRequests(node)
          : scale() === 1
            ? threadOccupancy(node)
            : node.heldCalls * scale() +
              Math.min(
                Math.max(f.memoryCredit / STEP, retained),
                Math.max(
                  // Admission limits new work; draining replicas still own retained memory.
                  Math.min(slots(node), f.ready * node.props.concurrency) + f.draining * node.props.concurrency,
                  Math.min(priorSlots, priorOccupancy),
                ),
              )
        : 0;
    for (const tail of node.cpuTail) {
      if (executionGraceDeadline(node, tail) <= time()) {
        node.cpuTail.delete(tail);
        const owned = "scope" in tail ? ledger.get((tail as Reservation).id) === tail : "message" in tail;
        // The logical grace event still needs the expired range identity.
        if (owned) {
          cancelCpu(tail);
        } else endResources(node, tail);
        continue;
      }
    }
    // CPU tails (docs/SIMULATION.md, technical model): a tail of whole requests keeps its fair share ahead of first waves.
    // A fractional tail yields: it repays what it is owed, first waves divide the rest of the tick, and
    // it shares what they leave, owing its fair share of the tick for whatever it did not get.
    const chargeTailCpu = (_work: ResourceWork, spent: number, replica: number | undefined, active: boolean) => {
      chargeCpu(f!, replica, spent, active, time());
      node.cpuTick?.charges.push({ before: spent, after: 0, backlogBefore: 0, eligible: true });
    };
    const yieldsCpu = (tail: ResourceWork) => yieldsToFirstWaves(tail, r?.cpuMsPerMessage ?? 0);
    const tailsBefore = cpuBudgets && node.cpuTail.size ? new Set(node.cpuTail) : undefined;
    const yielding = tailsBefore ? [...tailsBefore].filter(yieldsCpu) : [];
    const shares = yielding.length ? tailEntitlements(yielding, cpuBudgets!) : undefined;
    for (const tail of node.cpuTail) {
      if (shares?.has(tail)) continue;
      spendCpu(node, tail, cpuBudgets, true);
      if ((tail.cpuRemaining ?? 0) <= 1e-8) {
        node.cpuTail.delete(tail);
        const owned = "scope" in tail ? ledger.get((tail as Reservation).id) === tail : "message" in tail;
        if (!owned) endResources(node, tail);
      }
    }
    if (shares) {
      chargeTails(yielding, cpuBudgets!, chargeTailCpu);
      // First waves divide what is left among themselves.
      for (const budget of cpuBudgets!.values()) budget.count = budget.first!;
    }

    return [cpuBudgets, occupancy, tailsBefore, shares, chargeTailCpu, yieldsCpu, f, r] as const;
  }
  type CpuScratch = ReturnType<typeof prepareCpu>;
  function finishCpuTails(node: Node, scratch: CpuScratch): void {
    const [cpuBudgets, , tailsBefore, shares, chargeTailCpu, yieldsCpu] = scratch;
    // Yielding tails, including fractional tails that formed in this tick's loop.
    const tailsAfter =
      cpuBudgets && node.cpuTail.size
        ? [...node.cpuTail].filter((tail) => (tailsBefore?.has(tail) ? !!shares?.has(tail) : yieldsCpu(tail)))
        : [];
    if (tailsAfter.length) {
      if (node.cpuTick)
        node.cpuTick.tails = { budgets: cpuBudgets!, owed: new Map(tailsAfter.map((t) => [t, t.cpuOwed ?? 0])) };
      chargeTails(tailsAfter, cpuBudgets!, chargeTailCpu, shares ?? new Map(), (tail) => {
        node.cpuTail.delete(tail);
        const owned = "scope" in tail ? ledger.get((tail as Reservation).id) === tail : "message" in tail;
        if (!owned) endResources(node, tail);
      });
    }
  }
  function integrateAndScale(node: Node, scratch: CpuScratch, fleetChanges: Set<string>): void {
    const f = scratch[6],
      r = scratch[7];
    const occupancy = scratch[1];
    if (f && r) {
      if ((scale() > 1 && !waits()) || f.sampledDrains.length) releaseSampledDrains(f, resourceWork(node));
      if (f.assignmentChanged) {
        fleetChanges.add(node.id);
        f.assignmentChanged = false;
      }
      if (scale() > 1) f.memoryCredit = Math.max(0, f.memoryCredit - occupancy * STEP);
      const a = node.props.autoscaling;
      const cloud = a?.mode === "on" && a.modelRevision === "a3" ? a.controller : undefined;
      integrateResources(
        f,
        occupancy,
        time(),
        STEP,
        (cloud && cloud.kind !== "ecs") || waits()
          ? {
              inFlight: callerReservations(node)
                ? node.threadWeight.work + node.threadWeight.wait
                : residentRequests(node),
              waiting: cloud?.kind === "appService" ? waitingRequests(node) : 0,
            }
          : undefined,
      );
      const polled = a?.mode === "on" && (a.controller.kind === "keda" || a.controller.kind === "aca") && f.keda;
      const due = polled ? (f.desired === 0 ? f.keda!.nextPoll : Math.min(f.nextSync, f.keda!.nextPoll)) : f.nextSync;
      const reads = cloud ? cloudReads(node) : undefined;
      const requested =
        cloud && !f.override && node.status === "up"
          ? onDemand(f, cloud, time(), reads!, capacityMultiplier(), node.props.concurrency)
          : undefined;
      if (a?.mode === "on" && !f.override && (time() >= due || requested) && node.status === "up") {
        const decision =
          requested ??
          (a.controller.kind === "keda"
            ? evaluateKeda(f, a.controller, r, time(), readBrokerMetric, capacityMultiplier(), scale())
            : a.controller.kind === "hpa"
              ? evaluateHpa(f, a.controller, r, time(), capacityMultiplier(), scale())
              : evaluateCloud(
                  f,
                  a.controller,
                  r,
                  time(),
                  reads!,
                  node.id,
                  capacityMultiplier(),
                  scale(),
                  node.props.concurrency,
                ));
        if (decision) {
          const previous = f.desired;
          if (!reconcileResources(node, decision.desired)) {
            decision.desired = f.desired;
            decision.reason = "policy";
          } else if ((a.controller.kind === "keda" || a.controller.kind === "aca") && decision.reason === "inactive") {
            // A successful KEDA zero transition ends this active HPA epoch.
            f.recommendations = [];
            f.changes = [];
          } else if (decision.reason !== "activation" && decision.reason !== "request")
            commitScalingChange(f, previous, time());
          if (advanceFleet(f, time(), () => resourceWork(node)) || node.replicas !== f.ready) fleetChanges.add(node.id);
        }
      }
    }
  }
  return [
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
  ] as const;
}
