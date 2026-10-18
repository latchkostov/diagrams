import type { LatencyMetrics, LatencySummary } from "./types";

/** Fixed logarithmic buckets: upper-bound estimates within 12%, up to ~26 minutes.
 * The final bucket covers longer runs and reports the observed maximum. No samples are retained. */
export const LATENCY_BUCKETS = 128;
export const LATENCY_TYPES = 64;
/** At most 1 MiB of live per-type bucket payload per run, plus one aggregate per measured node.
 * With 24 checkpoints, even distributions changed after every capture retain at most 25 versions. */
export const LATENCY_TYPE_HISTOGRAMS = 1024;
export const createLatencyBudget = () => ({ remaining: LATENCY_TYPE_HISTOGRAMS });
type LatencyBudget = ReturnType<typeof createLatencyBudget>;
const RATIO = 1.12;
const LOG_RATIO = Math.log(RATIO);
const BOUNDS = Array.from({ length: LATENCY_BUCKETS }, (_, i) => (i === 0 ? 0 : RATIO ** (i - 1)));

interface Histogram {
  buckets: number[];
  samples: number;
  max: number;
  waitMs: number;
  workMs: number;
  travelMs: number;
}

/** Mutable recorder; checkpoint copies share histograms until their first subsequent write. */
export interface LatencyRecorder {
  total: Histogram;
  types: Map<string, Histogram>;
  typesLimited?: true;
}

const histogram = (): Histogram => ({
  buckets: Array<number>(LATENCY_BUCKETS).fill(0),
  samples: 0,
  max: 0,
  waitMs: 0,
  workMs: 0,
  travelMs: 0,
});

export const createLatencyRecorder = (): LatencyRecorder => ({ total: histogram(), types: new Map() });

const shared = new WeakSet<Histogram>();
export function shareLatencyRecorder(recorder: LatencyRecorder): LatencyRecorder {
  shared.add(recorder.total);
  for (const h of recorder.types.values()) shared.add(h);
  return { ...recorder, types: new Map(recorder.types) };
}

function writable(h: Histogram): Histogram {
  return shared.has(h) ? { ...h, buckets: h.buckets.slice() } : h;
}

export function recordLatency(
  recorder: LatencyRecorder,
  type: string,
  wait: number,
  work: number,
  travel: number,
  budget?: LatencyBudget,
) {
  const latency = wait + work;
  const bucket =
    latency <= 0 ? 0 : Math.min(LATENCY_BUCKETS - 1, Math.max(1, Math.ceil(Math.log(latency) / LOG_RATIO) + 1));
  const add = (h: Histogram) => {
    h.buckets[bucket]++;
    h.samples++;
    h.max = Math.max(h.max, latency);
    h.waitMs += wait;
    h.workMs += work;
    h.travelMs += travel;
  };
  add((recorder.total = writable(recorder.total)));
  let typed = recorder.types.get(type);
  if (!typed && recorder.types.size < LATENCY_TYPES && (!budget || budget.remaining > 0)) {
    typed = histogram();
    if (budget) budget.remaining--;
  }
  if (typed) {
    typed = writable(typed);
    recorder.types.set(type, typed);
    add(typed);
  } else recorder.typesLimited = true;
}

const summaries = new WeakMap<Histogram, LatencySummary>();
const views = new WeakMap<LatencyRecorder, LatencyMetrics>();

function summary(h: Histogram): LatencySummary {
  const cached = summaries.get(h);
  if (cached?.samples === h.samples) return cached;
  const at = (q: number) => {
    const rank = Math.ceil(h.samples * q);
    let count = 0;
    for (let i = 0; i < LATENCY_BUCKETS; i++) {
      count += h.buckets[i];
      if (count >= rank) return i === LATENCY_BUCKETS - 1 ? h.max : Math.min(h.max, BOUNDS[i]);
    }
    return h.max;
  };
  const value = Object.freeze({
    samples: h.samples,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    waitMs: h.waitMs,
    workMs: h.workMs,
    travelMs: h.travelMs,
  });
  summaries.set(h, value);
  return value;
}

export function latencyMetrics(recorder: LatencyRecorder): LatencyMetrics {
  const cached = views.get(recorder);
  if (cached?.samples === recorder.total.samples) return cached;
  const value = Object.freeze({
    ...summary(recorder.total),
    byType: Object.freeze(Object.fromEntries([...recorder.types].map(([type, h]) => [type, summary(h)]))),
    ...(recorder.typesLimited ? { typesLimited: true as const } : {}),
  });
  views.set(recorder, value);
  return value;
}
