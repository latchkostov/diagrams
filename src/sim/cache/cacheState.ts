import type { CachePolicy } from "../../model/caching";
import type { CompiledMatch } from "../routeMatching";
import type { PopularityTable } from "./popularity";

export interface CacheCounts {
  requests: number;
  hits: number;
  misses: number;
  coalesced: number;
  notCached: number;
  fetches: number;
  fills: number;
  staleHits?: number;
  revalidations?: number;
}
export interface CacheReadout extends Omit<CacheCounts, "coalesced"> {
  coalesced?: number;
  hitRatio: number;
  originOffload: number;
  rules: Record<string, Omit<CacheCounts, "coalesced"> & { coalesced?: number }>;
}
/** A detached real-unit observation of one tracked item, whether or not it wins the display summary. */
export interface CacheItemObservation {
  rule: string;
  item: number;
  fetches: number;
  waiting: number;
  expiredAt: number;
  edge?: string;
}
export interface CacheDetails {
  purge?: {
    atMs: number;
    peakFetchRate: number;
    recoveredAfterMs?: number;
    tailItems: number;
    refillMs: number;
    hard: boolean;
    edge?: string;
  };
  sinceFault?: import("../types").LatencyMetrics["sinceFault"];
  herdThreshold?: number;
  itemFetches?: number;
  peakHerd?: { rule: string; item: number; fetches: number; edge?: string };
  herd?: CacheItemObservation;
  expected?: number;
  window?: { requests: number; hits: number; misses: number; fetches: number; seconds: number };
  latency?: {
    total?: import("../types").LatencyMetrics;
    hit?: import("../types").LatencySummary;
    miss?: import("../types").LatencySummary;
  };
}
export interface CacheRuleState {
  id: string;
  match?: CompiledMatch;
  address: boolean;
  types?: string[];
  policy: CachePolicy;
  popularity?: PopularityTable;
  stream: number;
  tracked: number;
  statisticalUntil: number;
  statisticalCredit: number;
  statisticalPending: number;
  statisticalDue: number;
  freshUntil: Float64Array;
  fetching: Float64Array;
  rate: { buckets: Float64Array; second: number; planned: number };
  fetchMs: { samples: Float64Array; cursor: number; count: number; sum: number; planned: number };
  counts: CacheCounts;
  warmSince?: number;
  purgedAt?: number;
  revalidationCredit?: number;
}
export interface NodeCache {
  cold?: {
    atMs: number;
    at: number;
    requests: number;
    hits: number;
    fetches: number;
    peakFetchRate: number;
    recoveredAfterMs?: number;
    tailItems: number;
    refillMs: number;
    hard: boolean;
    edge?: string;
    mixedOrigins?: boolean;
  };
  herds?: Map<string, { expiredAt: number; edge?: string }>;
  herdThreshold: number;
  peakHerd?: { rule: string; item: number; fetches: number; edge?: string };
  flights?: Map<string, import("../engine/model").Work>;
  expected: number;
  rules: CacheRuleState[];
  counts: CacheCounts;
  window?: { second: number; buckets: Float64Array };
  latency?: import("../latency").LatencyRecorder;
}
export interface CacheLookup {
  origin?: string;
  rule?: CacheRuleState;
  item: number;
  outcome: "hit" | "stale" | "miss" | "coalesced" | "not-cached";
  at: number;
  freshUntil?: number;
  fetching?: true;
  revalidate?: number;
}
