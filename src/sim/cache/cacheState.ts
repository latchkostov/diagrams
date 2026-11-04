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
}
export interface NodeCache {
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
  outcome: "hit" | "miss" | "coalesced" | "not-cached";
  at: number;
  freshUntil?: number;
  fetching?: true;
}
