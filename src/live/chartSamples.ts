import type { RunHistory, RunSample } from "./runHistory";

/** Bound plotted objects to four extrema per pixel column, plus the run's endpoints. */
export function chartSamples(history: RunHistory, id: string, width: number, end: number): RunSample[] {
  const series = history.series(id);
  if (!series) return [];
  const { times, values, from, to } = series;
  const value = (i: number, key: number) => values[(i % times.length) * 2 + key];
  const columns = Math.max(1, Math.floor(width));
  const kept = new Set<number>();
  let column = -1,
    last = -1;
  let extrema: number[] = [];
  for (let i = from; i < to; i++) {
    const t = times[i % times.length];
    if (t > end) break;
    const next = Math.min(columns - 1, Math.floor((t / Math.max(1, end)) * columns));
    if (next !== column) {
      for (const index of extrema) kept.add(index);
      extrema = [i, i, i, i];
      column = next;
    }
    for (let key = 0; key < 2; key++) {
      if (value(i, key) < value(extrema[key * 2], key)) extrema[key * 2] = i;
      if (value(i, key) > value(extrema[key * 2 + 1], key)) extrema[key * 2 + 1] = i;
    }
    last = i;
  }
  if (last < 0) return [];
  for (const index of [from, ...extrema, last]) kept.add(index);
  return [...kept]
    .sort((a, b) => a - b)
    .map((i) => ({ t: times[i % times.length], rate: value(i, 0), queue: value(i, 1) }));
}
