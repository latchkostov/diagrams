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
}
