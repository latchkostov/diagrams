import type { CacheCounts, CacheRuleState } from "./cacheState";

const countKeys = ["requests", "hits", "misses", "notCached", "fetches", "fills"] as const;
type Config = Omit<
  CacheRuleState,
  "stream" | "statisticalUntil" | "warmSince" | "counts" | "rate" | "fetchMs" | "freshUntil" | "fetching"
>;

/** Lossless sparse payloads retain only written slots; every retained byte is charged.
 * Configuration aliases stay shared with the run, while restore allocates independent mutable state.
 */
export class CacheCheckpoint {
  config: Config;
  values: Float64Array;

  constructor(rule: CacheRuleState) {
    const values: number[] = [];
    const counts = (c: CacheCounts) => values.push(...countKeys.map((key) => c[key]));
    const array = (a: Float64Array) => {
      const entries: number[] = [];
      for (let i = 0; i < a.length; i++) if (!Object.is(a[i], 0)) entries.push(i, a[i]);
      // Negative length marks dense storage; zero-length arrays have no payload.
      if (entries.length >= a.length && a.length) values.push(-a.length, ...a);
      else values.push(a.length, entries.length / 2, ...entries);
    };
    const { id, match, address, types, policy, popularity, tracked } = rule;
    this.config = { id, match, address, types, policy, popularity, tracked };
    values.push(rule.stream, rule.statisticalUntil, rule.warmSince ?? -1);
    counts(rule.counts);
    values.push(rule.rate.second, rule.rate.planned);
    array(rule.rate.buckets);
    values.push(rule.fetchMs.cursor, rule.fetchMs.count, rule.fetchMs.sum, rule.fetchMs.planned);
    array(rule.fetchMs.samples);
    array(rule.freshUntil);
    array(rule.fetching);
    this.values = new Float64Array(values);
  }

  restore(): CacheRuleState {
    let at = 0;
    const next = () => this.values[at++];
    const counts = (): CacheCounts => ({
      requests: next(),
      hits: next(),
      misses: next(),
      notCached: next(),
      fetches: next(),
      fills: next(),
    });
    const array = () => {
      const length = next();
      if (length < 0) {
        const result = this.values.slice(at, at - length);
        at -= length;
        return result;
      }
      const result = new Float64Array(length),
        count = next();
      for (let i = 0; i < count; i++) result[next()] = next();
      return result;
    };
    const stream = next(),
      statisticalUntil = next(),
      warmSince = next();
    return {
      ...this.config,
      stream,
      statisticalUntil,
      ...(warmSince < 0 ? {} : { warmSince }),
      counts: counts(),
      rate: { second: next(), planned: next(), buckets: array() },
      fetchMs: { cursor: next(), count: next(), sum: next(), planned: next(), samples: array() },
      freshUntil: array(),
      fetching: array(),
    };
  }
}
