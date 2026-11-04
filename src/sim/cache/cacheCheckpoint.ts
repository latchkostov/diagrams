import type { CacheCounts, CacheRuleState } from "./cacheState";

const countKeys = ["requests", "hits", "misses", "coalesced", "notCached", "fetches", "fills"] as const;
type Config = Omit<
  CacheRuleState,
  | "stream"
  | "statisticalUntil"
  | "statisticalCredit"
  | "statisticalPending"
  | "statisticalDue"
  | "warmSince"
  | "counts"
  | "rate"
  | "fetchMs"
  | "freshUntil"
  | "fetching"
  | "purgedAt"
  | "revalidationCredit"
>;

/** Lossless sparse payloads retain only written slots; every retained byte is charged.
 * Configuration aliases stay shared with the run, while restore allocates independent mutable state.
 */
export class CacheCheckpoint {
  config: Config;
  values: Uint8Array;

  constructor(rule: CacheRuleState) {
    const values: number[] = [];
    const counts = (c: CacheCounts) => values.push(...countKeys.map((key) => c[key]));
    const array = (a: Float64Array) => {
      const entries: number[] = [];
      for (let i = 0; i < a.length; i++) if (!Object.is(a[i], 0)) entries.push(i, a[i]);
      const runs: number[] = [];
      for (let i = 0; i < a.length;) {
        const start = i++;
        while (i < a.length && Object.is(a[i], a[start])) i++;
        runs.push(i - start, a[start]);
      }
      // Warm rate buckets and full fetch rings often repeat exactly. Preserve the
      // values bit for bit, including signed zero, without repeating their payload.
      if (runs.length + 3 < Math.min(a.length + 1, entries.length + 2)) {
        values.push(a.length, -1, runs.length / 2, ...runs);
        return;
      }
      // Negative length marks dense storage; zero-length arrays have no payload.
      if (entries.length >= a.length && a.length) values.push(-a.length, ...a);
      else values.push(a.length, entries.length / 2, ...entries);
    };
    const { id, match, address, types, policy, popularity, tracked } = rule;
    this.config = { id, match, address, types, policy, popularity, tracked };
    values.push(
      rule.stream,
      rule.statisticalUntil,
      rule.statisticalCredit,
      rule.statisticalPending,
      rule.statisticalDue,
      rule.warmSince ?? -1,
    );
    counts(rule.counts);
    values.push(rule.rate.second, rule.rate.planned);
    array(rule.rate.buckets);
    values.push(rule.fetchMs.cursor, rule.fetchMs.count, rule.fetchMs.sum, rule.fetchMs.planned);
    array(rule.fetchMs.samples);
    array(rule.freshUntil);
    array(rule.fetching);
    values.push(rule.purgedAt ?? -1, rule.counts.staleHits ?? 0, rule.counts.revalidations ?? 0);
    array(rule.revalidationCredit ?? new Float64Array(0));
    // Simulation clocks/counts are usually small integers. Varints keep full sample
    // rings compact; an IEEE-754 escape preserves fractional values and signed zero.
    const bytes: number[] = [];
    const scratch = new DataView(new ArrayBuffer(8));
    for (const value of values) {
      if (Number.isSafeInteger(value) && Math.abs(value) < 2_251_799_813_685_248 && !Object.is(value, -0)) {
        let encoded = (value < 0 ? -value * 2 - 1 : value * 2) + 1;
        while (encoded >= 128) {
          bytes.push((encoded % 128) + 128);
          encoded = Math.floor(encoded / 128);
        }
        bytes.push(encoded);
      } else {
        bytes.push(0);
        scratch.setFloat64(0, value, true);
        for (let i = 0; i < 8; i++) bytes.push(scratch.getUint8(i));
      }
    }
    this.values = new Uint8Array(bytes);
  }

  restore(): CacheRuleState {
    let at = 0;
    const next = () => {
      let byte = this.values[at++];
      if (byte === 0) {
        const value = new DataView(this.values.buffer, this.values.byteOffset + at, 8).getFloat64(0, true);
        at += 8;
        return value;
      }
      let encoded = byte % 128;
      for (let factor = 128; byte >= 128; factor *= 128) {
        byte = this.values[at++];
        encoded += (byte % 128) * factor;
      }
      encoded--;
      return encoded % 2 ? -(encoded + 1) / 2 : encoded / 2;
    };
    const counts = (): CacheCounts => ({
      requests: next(),
      hits: next(),
      misses: next(),
      coalesced: next(),
      notCached: next(),
      fetches: next(),
      fills: next(),
    });
    const array = () => {
      const length = next();
      if (length < 0) {
        const result = new Float64Array(-length);
        for (let i = 0; i < result.length; i++) result[i] = next();
        return result;
      }
      const result = new Float64Array(length),
        count = next();
      if (count === -1) {
        const runs = next();
        let offset = 0;
        for (let i = 0; i < runs; i++) {
          const size = next();
          result.fill(next(), offset, offset + size);
          offset += size;
        }
        return result;
      }
      for (let i = 0; i < count; i++) result[next()] = next();
      return result;
    };
    const stream = next(),
      statisticalUntil = next(),
      statisticalCredit = next(),
      statisticalPending = next(),
      statisticalDue = next(),
      warmSince = next();
    const rule: CacheRuleState = {
      ...this.config,
      stream,
      statisticalUntil,
      statisticalCredit,
      statisticalPending,
      statisticalDue,
      ...(warmSince < 0 ? {} : { warmSince }),
      counts: counts(),
      rate: { second: next(), planned: next(), buckets: array() },
      fetchMs: { cursor: next(), count: next(), sum: next(), planned: next(), samples: array() },
      freshUntil: array(),
      fetching: array(),
    };
    const purgedAt = next(),
      staleHits = next(),
      revalidations = next(),
      credit = array();
    if (purgedAt >= 0) rule.purgedAt = purgedAt;
    if (staleHits) rule.counts.staleHits = staleHits;
    if (revalidations) rule.counts.revalidations = revalidations;
    if (credit.length) rule.revalidationCredit = credit;
    return rule;
  }
}
