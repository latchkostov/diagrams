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

/** Per key: the tick's remaining CPU, every entry the node counted, and how many of them are first waves. */
export type CpuBudgets = Map<number | string, { remaining: number; count: number; first?: number }>;
export type TailCharge = (work: ResourceWork, spent: number, replica: number | undefined, active: boolean) => void;

type CpuEntry = { key: number | string; cpu: number; drainAt?: number };
const cpuEntries = (work: ResourceWork): CpuEntry[] =>
  work.cpuParts ?? [{ key: work.replica ?? 0, cpu: work.cpuRemaining ?? 0 }];

/** A tail's fair share of the whole tick: per key, the full budget over every entry the node counted. */
export function tailEntitlements(tails: ResourceWork[], budgets: CpuBudgets): Map<ResourceWork, number> {
  return new Map(
    tails.map((tail) => [
      tail,
      cpuEntries(tail).reduce((sum, part) => {
        const budget = budgets.get(part.key);
        return sum + (budget?.count && part.cpu > 0 ? Math.min(part.cpu, budget.remaining / budget.count) : 0);
      }, 0),
    ]),
  );
}

/**
 * Charges yielding tails, max-min fair (water-filling) per key, so a key stops short of its budget only when
 * every tail part on it is satisfied. Without `entitled` this is the repayment, before first waves: each tail
 * takes at most its owed share of what it has left. With it, tails share what first waves left, and whatever
 * a tail was entitled to this tick and did not get stays owed (never more than its unfinished CPU).
 */
export function chargeTails(
  tails: ResourceWork[],
  budgets: CpuBudgets,
  charge: TailCharge,
  entitled?: ReadonlyMap<ResourceWork, number>,
  finish?: (tail: ResourceWork) => void,
): void {
  if (!entitled) tails = tails.filter((tail) => (tail.cpuOwed ?? 0) > 1e-9 && (tail.cpuRemaining ?? 0) > 1e-12);
  const byKey = new Map<number | string, { tail: ResourceWork; part: CpuEntry; cap: number }[]>();
  const got = new Map<ResourceWork, number>();
  for (const tail of tails) {
    got.set(tail, 0);
    const fraction = entitled ? 1 : Math.min(1, tail.cpuOwed! / tail.cpuRemaining!);
    // A key first waves exhausted can charge nothing: skip it before grouping and sorting.
    // The tail keeps its `got` entry, so it still accrues what it was entitled to.
    for (const part of cpuEntries(tail))
      if (part.cpu * fraction > 1e-12 && (budgets.get(part.key)?.remaining ?? 0) > 0) {
        if (!byKey.has(part.key)) byKey.set(part.key, []);
        byKey.get(part.key)!.push({ tail, part, cap: part.cpu * fraction });
      }
  }
  for (const [key, list] of byKey) {
    const budget = budgets.get(key)!;
    // Stable: equal caps keep tail order, so the schedule stays deterministic.
    list.sort((a, b) => a.cap - b.cap);
    list.forEach(({ tail, part, cap }, i) => {
      const spent = Math.max(0, Math.min(cap, budget.remaining / (list.length - i)));
      if (!(spent > 0)) return;
      part.cpu -= spent;
      budget.remaining -= spent;
      got.set(tail, got.get(tail)! + spent);
      charge(tail, spent, tail.cpuParts ? undefined : tail.replica, part.drainAt === undefined);
    });
  }
  for (const [tail, spent] of got) {
    tail.cpuRemaining = Math.max(0, (tail.cpuRemaining ?? 0) - spent);
    const owed = (tail.cpuOwed ?? 0) + (entitled ? (entitled.get(tail) ?? 0) : 0) - spent;
    tail.cpuOwed = Math.min(tail.cpuRemaining, Math.max(0, owed));
    if (finish && tail.cpuRemaining <= 1e-8) {
      tail.cpuOwed = 0;
      finish(tail);
    }
  }
}
