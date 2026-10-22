import type { SampledWork } from "./sampledResources";

/** Shared by every fleet in one run and cloned with checkpoints. Bounds allocations before mutation. */
export const MAX_CPU_PARTS = 20_000;
export interface CpuPartBudget {
  used: number;
  blocked: boolean;
}
export const createCpuPartBudget = (): CpuPartBudget => ({ used: 0, blocked: false });

/** Resource ownership belongs to an attempt, whether working, queued or staged. */
export interface ResourceWork extends SampledWork {
  replica?: number;
  /** Sampled memory allowance retained when concurrency is lowered on an existing attempt. */
  memorySlots?: number;
  cpuRemaining?: number;
  logicalCpuRemaining?: number;
  cpuPerRequest?: number;
  cpuBacklog?: number;
  /** Fair tail CPU deferred to the next tick; never exceeds unfinished CPU. */
  cpuOwed?: number;
  /** Set when this became a CPU tail: less than one request's CPU, so it yields to first waves. */
  fractionalTail?: boolean;
  cpuBackoffUntil?: number;
  retryAdmissionAt?: number;
}
export function clearResourceWork(work: ResourceWork) {
  work.replica = undefined;
  work.memorySlots = undefined;
  work.cpuParts = undefined;
  work.cpuRemaining = undefined;
  work.logicalCpuRemaining = undefined;
  work.cpuPerRequest = undefined;
  work.cpuBacklog = undefined;
  work.cpuOwed = undefined;
  work.fractionalTail = undefined;
  work.cpuBackoffUntil = undefined;
}
export function shiftWorkDeadlines(work: ResourceWork, duration: number) {
  if (work.cpuBackoffUntil !== undefined) work.cpuBackoffUntil += duration;
  if (work.retryAdmissionAt !== undefined) work.retryAdmissionAt += duration;
  for (const part of work.cpuParts ?? []) if (part.drainAt !== undefined) part.drainAt += duration;
}

/** CPU that outlives a logical step keeps both physical and delivery ownership. */
export interface CpuTail<Group> extends ResourceWork {
  group?: Group;
}
export const deliveryGroup = <Group>(work: CpuTail<Group>): Group | undefined => work.group;
export const ownsCpu = (work: ResourceWork): boolean => work.replica !== undefined || !!work.cpuParts?.length;
export function cancelCpu(work: ResourceWork): void {
  for (const part of work.cpuParts ?? []) part.cpu = 0;
  work.cpuRemaining = work.logicalCpuRemaining = work.cpuBacklog = 0;
  work.cpuOwed = 0;
}

/**
 * A tail of less than one request's CPU is the fractional part of a sampled cohort: at scale one that request
 * runs in only some cycles, so charging it ahead of the next first wave would delay that wave in every cycle.
 * It yields, and is repaid. A tail of one or more whole requests stands for requests that share the CPU fairly,
 * so it keeps its fair share ahead of first waves. Decided once, when the work becomes a tail.
 */
export function yieldsToFirstWaves(work: ResourceWork, requestCpuMs: number): boolean {
  return (work.fractionalTail ??= (work.cpuRemaining ?? 0) < (work.cpuPerRequest ?? requestCpuMs) - 1e-9);
}

export type CpuBudgets = Map<number | string, { remaining: number; count: number }>;
export type TailCharge = (work: ResourceWork, spent: number, replica: number | undefined, active: boolean) => void;

type CpuEntry = { key: number | string; cpu: number; drainAt?: number };
function cpuEntries(work: ResourceWork): CpuEntry[] {
  return work.cpuParts ?? [{ key: work.replica ?? 0, cpu: work.cpuRemaining ?? 0 }];
}

/** Every phase shares the remaining budget, but divides it only among that phase's entries. */
export function countCpuEntries(works: Iterable<ResourceWork>, budgets: CpuBudgets): void {
  for (const budget of budgets.values()) budget.count = 0;
  for (const work of works)
    for (const part of cpuEntries(work))
      if (!work.cpuParts || part.cpu > 0) {
        const budget = budgets.get(part.key);
        if (budget) budget.count++;
      }
}

/** A tail's fair share of the whole tick: per key, the full budget over every entry the node counted. */
export function tailEntitlements(tails: Iterable<ResourceWork>, budgets: CpuBudgets): Map<ResourceWork, number> {
  const out = new Map<ResourceWork, number>();
  for (const tail of tails) {
    let share = 0;
    for (const part of cpuEntries(tail)) {
      const budget = budgets.get(part.key);
      if (budget?.count && part.cpu > 0) share += Math.min(part.cpu, budget.remaining / budget.count);
    }
    out.set(tail, share);
  }
  return out;
}

/**
 * Max-min fair (water-filling) per key: each tail part takes at most `cap(work, cpu)`, and what one part
 * leaves goes to the others, so a key stops short of its budget only when every part on it is satisfied.
 */
function shareAmong(
  tails: Iterable<ResourceWork>,
  budgets: CpuBudgets,
  cap: (work: ResourceWork, cpu: number) => number,
  charge: TailCharge,
): Map<ResourceWork, number> {
  const byKey = new Map<number | string, { work: ResourceWork; part: CpuEntry; cap: number }[]>();
  const got = new Map<ResourceWork, number>();
  for (const work of tails) {
    got.set(work, 0);
    for (const part of cpuEntries(work)) {
      const limit = Math.min(part.cpu, cap(work, part.cpu));
      if (!(limit > 1e-12) || !budgets.has(part.key)) continue;
      let list = byKey.get(part.key);
      if (!list) byKey.set(part.key, (list = []));
      list.push({ work, part, cap: limit });
    }
  }
  for (const [key, list] of byKey) {
    const budget = budgets.get(key)!;
    // Stable: equal caps keep tail order, so the schedule stays deterministic.
    list.sort((a, b) => a.cap - b.cap);
    let left = list.length;
    for (const { work, part, cap } of list) {
      const spent = Math.max(0, Math.min(cap, budget.remaining / left--));
      if (!(spent > 0)) continue;
      part.cpu -= spent;
      budget.remaining -= spent;
      got.set(work, got.get(work)! + spent);
      charge(work, spent, work.cpuParts ? undefined : work.replica, part.drainAt === undefined);
    }
  }
  for (const [work, spent] of got) work.cpuRemaining = Math.max(0, (work.cpuRemaining ?? 0) - spent);
  return got;
}

/** Repay: owed tail CPU runs before first waves, each tail at most its owed share of what it has left. */
export function repayTails(tails: Iterable<ResourceWork>, budgets: CpuBudgets, charge: TailCharge): void {
  const owed = [...tails].filter((tail) => (tail.cpuOwed ?? 0) > 1e-9 && (tail.cpuRemaining ?? 0) > 1e-12);
  const got = shareAmong(owed, budgets, (work, cpu) => cpu * Math.min(1, work.cpuOwed! / work.cpuRemaining!), charge);
  for (const [tail, spent] of got) tail.cpuOwed = Math.min(tail.cpuRemaining ?? 0, Math.max(0, tail.cpuOwed! - spent));
}

/**
 * Yield: after first waves, tails share what is left. Whatever a tail was entitled to this tick and did not get
 * stays owed (never more than its unfinished CPU) and is repaid first next tick.
 */
export function yieldTails(
  tails: Iterable<ResourceWork>,
  budgets: CpuBudgets,
  entitlements: ReadonlyMap<ResourceWork, number>,
  charge: TailCharge,
  finish: (tail: ResourceWork) => void,
): void {
  const got = shareAmong(tails, budgets, (_work, cpu) => cpu, charge);
  for (const [tail, spent] of got) {
    const owed = (tail.cpuOwed ?? 0) + (entitlements.get(tail) ?? 0) - spent;
    tail.cpuOwed = Math.min(tail.cpuRemaining ?? 0, Math.max(0, owed));
    if ((tail.cpuRemaining ?? 0) <= 1e-8) {
      tail.cpuOwed = 0;
      finish(tail);
    }
  }
}
