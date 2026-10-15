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
  cpuRemaining?: number;
  cpuBackoffUntil?: number;
  retryAdmissionAt?: number;
}
export function clearResourceWork(work: ResourceWork) {
  work.replica = undefined;
  work.cpuParts = undefined;
  work.cpuRemaining = undefined;
  work.cpuBackoffUntil = undefined;
}
export function shiftWorkDeadlines(work: ResourceWork, duration: number) {
  if (work.cpuBackoffUntil !== undefined) work.cpuBackoffUntil += duration;
  if (work.retryAdmissionAt !== undefined) work.retryAdmissionAt += duration;
  for (const part of work.cpuParts ?? []) if (part.drainAt !== undefined) part.drainAt += duration;
}
