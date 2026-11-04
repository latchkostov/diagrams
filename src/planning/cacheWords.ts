import { t } from "../i18n";
import type { CachePolicy, Popularity } from "../model/caching";
import { formatNumber } from "../i18n/format";
import { isolate } from "../live/bidi";

export const popularityLabel = (value: Popularity) =>
  ({ even: t("cache.even"), gentle: t("cache.gentle"), typical: t("cache.typical"), steep: t("cache.steep") })[value];
export const cacheDuration = (ms: number) =>
  ms >= 3_600_000
    ? t("cache.hours", { n: formatNumber(ms / 3_600_000) })
    : ms >= 60_000
      ? t("format.importMinutes", { duration: formatNumber(ms / 60_000) })
      : t("format.importSeconds", { duration: formatNumber(ms / 1000) });
export const policyWords = (p: CachePolicy) =>
  p.noStore ? t("cache.noStore") : t("cache.policy", { ttl: cacheDuration(p.ttlMs!), count: p.keys ?? 1000 });

export const cacheRate = (
  rate: number,
  requests = false,
  options: Intl.NumberFormatOptions = { maximumFractionDigits: 1 },
) =>
  isolate(
    requests
      ? t("cache.requestsRate", { rate: formatNumber(rate, options) })
      : t("cache.perSecond", { rate: formatNumber(rate, options) }),
  );

/** Histogram bucket zero contains only actual zero samples, never rounded positive values. */
export const cacheLatency = (ms: number, lookup = false) =>
  ms === 0 && lookup
    ? t("cache.zeroLookup")
    : ms < 1000
      ? t("cache.milliseconds", {
          value: formatNumber(ms, ms > 0 && ms < 1 ? { maximumSignificantDigits: 2 } : { maximumFractionDigits: 1 }),
        })
      : t("latency.seconds", { value: formatNumber(ms / 1000, { maximumFractionDigits: 1 }) });
