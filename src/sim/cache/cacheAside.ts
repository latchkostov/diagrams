import type { Call, Edge } from "../engine/model";
import type { CacheLookup, NodeCache } from "./cacheState";
import type { CacheRuntime } from "./cacheBridge";

export interface AsideLease {
  owner: Call;
  waiting: number;
  waiters: { call: Call; edge: Edge }[];
}
export interface AsideFetch {
  cache: NodeCache;
  lookup: CacheLookup;
  size: number;
  key?: string;
  waiting?: boolean;
  edges?: Edge[];
  pending?: number;
  failed?: true;
}

/** A lease belongs to an item, not to a caller thread or a sampled cohort. */
export function prepareAside(
  call: Call,
  edge: Edge,
  response: { cache: NodeCache; lookup: CacheLookup },
  size: number,
  now: number,
  runtime: CacheRuntime,
  edges?: Edge[],
): "send" | "wait" | "skip" {
  const { cache, lookup } = response;
  if (lookup.outcome === "hit" || lookup.outcome === "stale") return "skip";
  const copy = { ...lookup, origin: edge.id, revalidate: undefined };
  const fetch: AsideFetch = { cache, lookup: copy, size };
  if (edges) {
    fetch.edges = edges;
    fetch.pending = edges.length;
  }
  if (lookup.outcome === "miss" && lookup.rule?.policy.coalesce && lookup.item >= 0) {
    const key = runtime.flightKey(lookup.rule.id, lookup.item);
    const leases = (cache.leases ??= new Map());
    const lease = leases.get(key);
    const filled = !lease && now < lookup.rule.freshUntil[lookup.item];
    const coalesced = size - (lease || filled ? 0 : 1);
    cache.counts.misses -= coalesced;
    cache.counts.coalesced += coalesced;
    lookup.rule.counts.misses -= coalesced;
    lookup.rule.counts.coalesced += coalesced;
    if (filled) return "skip";
    fetch.key = key;
    if (lease) {
      fetch.waiting = true;
      lease.waiters.push({ call, edge });
      lease.waiting += size;
    } else {
      leases.set(key, { owner: call, waiters: [], waiting: size - 1 });
      fetch.size = 1;
      if (edges) for (const origin of edges) call.branches.get(origin.id)!.represented = 1;
      else call.branches.get(edge.id)!.represented = 1;
    }
  }
  const origins = (call.aside ??= new Map());
  if (edges) for (const origin of edges) origins.set(origin.id, fetch);
  else origins.set(edge.id, fetch);
  if (fetch.waiting) return "wait";
  runtime.start(cache, copy, fetch.size);
  return "send";
}

/** Final replies fill once; failures and cancelled joins release every lease without a fill. */
export function finishAside(call: Call, edge: Edge, ok: boolean, now: number, runtime: CacheRuntime) {
  const fetch = call.aside?.get(edge.id);
  if (!fetch) return [];
  call.aside!.delete(edge.id);
  if (!ok) fetch.failed = true;
  if (fetch.pending !== undefined && --fetch.pending > 0) return [];
  const lease = fetch.key === undefined ? undefined : fetch.cache.leases?.get(fetch.key);
  if (fetch.waiting) {
    if (lease) {
      lease.waiters = lease.waiters.filter(
        (w) => w.call !== call || (fetch.edges ? !fetch.edges.includes(w.edge) : w.edge !== edge),
      );
      lease.waiting -= fetch.size;
    }
    return [];
  }
  runtime.settle(fetch.cache, fetch.lookup, now, fetch.size, ok && !fetch.failed);
  if (lease?.owner !== call) return [];
  fetch.cache.leases!.delete(fetch.key!);
  return lease.waiters;
}
