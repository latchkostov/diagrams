import { compactReadyRanges, type Cohort, type Fleet } from "./autoscaling";

/** A sampled attempt distributes its real CPU work over homogeneous physical ID ranges. */
export interface CpuPart {
  first: number;
  last: number;
  cpu: number;
  drainAt?: number;
}
export interface SampledWork {
  cpuParts?: CpuPart[];
}
const size = (c: { first: number; last: number }) => c.last - c.first + 1;
export const partKey = (p: { first: number; last: number }) => `${p.first}:${p.last}`;
function split(work: SampledWork, cut: number) {
  if (!work.cpuParts) return;
  work.cpuParts = work.cpuParts.flatMap((p) => {
    if (cut <= p.first || cut > p.last) return [p];
    const fraction = (cut - p.first) / size(p);
    return [
      { ...p, last: cut - 1, cpu: p.cpu * fraction },
      { ...p, first: cut, cpu: p.cpu * (1 - fraction) },
    ];
  });
}
/** Splits only cohort boundaries, never one object per represented message or replica. */
export function sampledParts(f: Fleet, eligible: number, cpu: number, working: SampledWork[]): CpuPart[] {
  compactReadyRanges(f, working);
  const parts: CpuPart[] = [];
  let left = eligible;
  for (let i = f.rangeHead; i < f.ranges.length && left > 0; i++) {
    const range = f.ranges[i],
      count = Math.min(left, size(range));
    if (count <= 0) continue;
    const end = range.first + count - 1;
    if (end < range.last) {
      for (const work of working) split(work, end + 1);
      f.ranges.splice(i + 1, 0, { ...range, first: end + 1 });
      range.last = end;
    }
    parts.push({ first: range.first, last: end, cpu: (cpu * count) / eligible });
    left -= count;
  }
  return parts;
}
/** Reconciliation removes ready ranges; occupied pieces retain their identity and grace deadline. */
export function retainSampledDrains(f: Fleet, before: Cohort[], working: SampledWork[], deadline: number) {
  const remaining = new Map(f.ranges.slice(f.rangeHead).map((c) => [c.first, c.last]));
  for (const old of before) {
    const first = (remaining.get(old.first) ?? old.first - 1) + 1;
    if (first > old.last) continue;
    let occupied = false;
    for (const work of working) {
      split(work, first);
      for (const p of work.cpuParts ?? [])
        if (p.first >= first && p.last <= old.last && p.drainAt === undefined) {
          p.drainAt = deadline;
          occupied = true;
        }
    }
    if (occupied) {
      f.sampledDrains.push({ first, last: old.last, at: deadline });
      f.draining += old.last - first + 1;
    }
  }
}
export function releaseSampledDrains(f: Fleet, working: SampledWork[]) {
  const occupied = new Set(
    working.flatMap((w) => (w.cpuParts ?? []).filter((p) => p.drainAt !== undefined).map(partKey)),
  );
  const next: Cohort[] = [];
  for (const c of f.sampledDrains) {
    if (occupied.has(partKey(c))) next.push(c);
    else f.draining -= size(c);
  }
  if (next.length !== f.sampledDrains.length) f.assignmentChanged = true;
  f.sampledDrains = next;
}
/** Union size for partition ownership; overlapping weighted attempts reserve each identity once. */
export function sampledOwners(working: SampledWork[]): number {
  const parts = working
    .flatMap((w) => (w.cpuParts ?? []).filter((p) => p.drainAt !== undefined))
    .sort((a, b) => a.first - b.first);
  let end = 0,
    count = 0;
  for (const p of parts) {
    count += Math.max(0, p.last - Math.max(end, p.first - 1));
    end = Math.max(end, p.last);
  }
  return count;
}
