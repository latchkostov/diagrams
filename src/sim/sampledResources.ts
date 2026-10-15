import { compactReadyRanges, type Cohort, type Fleet } from "./autoscaling";

import { MAX_CPU_PARTS } from "./resourceWork";
function reserve(f: Fleet, count: number): boolean {
  if (f.partBudget.used + count > MAX_CPU_PARTS) {
    f.partBudget.blocked = true;
    return false;
  }
  f.partBudget.used += count;
  f.partBudget.blocked = false;
  return true;
}
export function releaseCpuParts(f: Fleet, work: SampledWork) {
  if (work.cpuParts?.length) f.partBudget.blocked = false;
  f.partBudget.used -= work.cpuParts?.length ?? 0;
  work.cpuParts = undefined;
  f.rangesDirty = true;
}
/** A scale-down can split only the still-ready piece of each occupied interval. */
export function canDrainSampled(f: Fleet, desired: number, working: SampledWork[]): boolean {
  let remove = Math.max(0, f.ready - desired),
    additional = 0;
  const cuts: number[] = [];
  for (let i = f.ranges.length - 1; remove > 0 && i >= f.rangeHead; i--) {
    const range = f.ranges[i];
    const count = Math.min(remove, Math.max(0, size(range)));
    const cut = range.last - count + 1;
    remove -= count;
    if (count > 0) cuts.push(cut);
  }
  cuts.sort((a, b) => a - b);
  for (const work of working)
    for (const part of work.cpuParts ?? []) additional += upperBound(cuts, part.last) - upperBound(cuts, part.first);
  if (f.partBudget.used + additional <= MAX_CPU_PARTS) return true;
  f.partBudget.blocked = true;
  return false;
}
/** A sampled attempt distributes its real CPU work over homogeneous physical ID ranges. */
export interface CpuPart {
  key: string;
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
function upperBound(values: number[], value: number): number {
  let lo = 0,
    hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
function piece(p: CpuPart, first: number, last: number): CpuPart {
  return { ...p, first, last, key: partKey({ first, last }), cpu: (p.cpu * (last - first + 1)) / size(p) };
}
function split(f: Fleet, work: SampledWork, cut: number) {
  if (!work.cpuParts) return;
  work.cpuParts = work.cpuParts.flatMap((p) => {
    if (cut <= p.first || cut > p.last) return [p];
    f.partBudget.used++; // Admission / reconciliation preflight reserved room for every split.
    return [piece(p, p.first, cut - 1), piece(p, cut, p.last)];
  });
}
/** Splits only cohort boundaries, never one object per represented message or replica. */
export function sampledParts(f: Fleet, eligible: number, cpu: number, working: SampledWork[]): CpuPart[] | undefined {
  compactReadyRanges(f, working);
  let left = eligible,
    countParts = 0,
    splits = 0;
  for (let i = f.rangeHead; i < f.ranges.length && left > 0; i++) {
    const range = f.ranges[i],
      count = Math.min(left, size(range));
    if (count <= 0) continue;
    countParts++;
    if (count < size(range))
      for (const work of working)
        for (const part of work.cpuParts ?? [])
          if (part.first < range.first + count && range.first + count <= part.last) splits++;
    left -= count;
  }
  if (f.partBudget.used + countParts + splits > MAX_CPU_PARTS || !reserve(f, countParts)) {
    f.partBudget.blocked = true;
    return undefined;
  }
  const parts: CpuPart[] = [];
  left = eligible;
  for (let i = f.rangeHead; i < f.ranges.length && left > 0; i++) {
    const range = f.ranges[i],
      count = Math.min(left, size(range));
    if (count <= 0) continue;
    const end = range.first + count - 1;
    if (end < range.last) {
      for (const work of working) split(f, work, end + 1);
      f.ranges.splice(i + 1, 0, { ...range, first: end + 1 });
      range.last = end;
    }
    parts.push({
      first: range.first,
      last: end,
      key: partKey({ first: range.first, last: end }),
      cpu: (cpu * count) / eligible,
    });
    left -= count;
  }
  return parts;
}
/** Reconciliation removes ready ranges; occupied pieces retain their identity and grace deadline. */
export function retainSampledDrains(f: Fleet, before: Cohort[], working: SampledWork[], deadline: number) {
  const remaining = new Map(f.ranges.slice(f.rangeHead).map((c) => [c.first, c.last]));
  const removed = before
    .flatMap((old) => {
      const first = (remaining.get(old.first) ?? old.first - 1) + 1;
      return first > old.last ? [] : [{ first, last: old.last, occupied: false }];
    })
    .sort((a, b) => a.first - b.first);
  if (!removed.length) return;
  // Sweep each attempt once. Jitter can leave thousands of disjoint removed cohorts.
  for (const work of working) {
    if (!work.cpuParts) continue;
    const parts: CpuPart[] = [];
    let index = 0;
    for (const p of [...work.cpuParts].sort((a, b) => a.first - b.first)) {
      let first = p.first;
      while (index < removed.length && removed[index].last < first) index++;
      while (index < removed.length && removed[index].first <= p.last) {
        const interval = removed[index];
        if (first < interval.first) parts.push(piece(p, first, interval.first - 1));
        const last = Math.min(p.last, interval.last);
        const drainFirst = Math.max(first, interval.first);
        const drain = drainFirst === p.first && last === p.last ? p : piece(p, drainFirst, last);
        if (drain.drainAt === undefined) {
          drain.drainAt = deadline;
          interval.occupied = true;
        }
        parts.push(drain);
        first = last + 1;
        if (last === interval.last) index++;
        if (first > p.last) break;
      }
      if (first <= p.last) parts.push(first === p.first ? p : piece(p, first, p.last));
    }
    f.partBudget.used += parts.length - work.cpuParts.length;
    work.cpuParts = parts;
  }
  for (const { first, last, occupied } of removed) {
    if (occupied) {
      f.replicaIndexDirty = true;
      f.sampledDrains.push({ first, last, at: deadline });
      f.draining += last - first + 1;
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
  if (next.length !== f.sampledDrains.length) {
    f.assignmentChanged = true;
    f.replicaIndexDirty = true;
  }
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
