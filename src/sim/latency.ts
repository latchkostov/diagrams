import type { LatencyMetrics, LatencySummary } from "./types";

/** Fixed logarithmic buckets: upper-bound estimates within 12%, up to ~26 minutes.
 * The final bucket covers longer runs and reports the observed maximum. No samples are retained. */
export const LATENCY_BUCKETS = 128;
export const LATENCY_TYPES = 64;
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

/** Plain data so the engine's structured checkpoint owns every bucket and total. */
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

export function recordLatency(recorder: LatencyRecorder, type: string, wait: number, work: number, travel: number) {
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
  add(recorder.total);
  let typed = recorder.types.get(type);
  if (!typed && recorder.types.size < LATENCY_TYPES) recorder.types.set(type, (typed = histogram()));
  if (typed) add(typed);
  else recorder.typesLimited = true;
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
