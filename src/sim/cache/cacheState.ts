import type { CachePolicy } from "../../model/caching";
import type { CompiledMatch } from "../routeMatching";
import type { PopularityTable } from "./popularity";

export interface CacheCounts {
  requests: number;
  hits: number;
  misses: number;
  notCached: number;
  fetches: number;
  fills: number;
}
export interface CacheReadout extends CacheCounts {
  hitRatio: number;
  originOffload: number;
  rules: Record<string, CacheCounts>;
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
  freshUntil: Float64Array;
  fetching: Float64Array;
  rate: { buckets: Float64Array; second: number; planned: number };
  fetchMs: { samples: Float64Array; cursor: number; count: number; sum: number; planned: number };
  counts: CacheCounts;
  warmSince?: number;
}
export interface NodeCache {
  rules: CacheRuleState[];
  counts: CacheCounts;
}
export interface CacheLookup {
  rule?: CacheRuleState;
  item: number;
  outcome: "hit" | "miss" | "not-cached";
  at: number;
  freshUntil?: number;
  fetching?: true;
}
