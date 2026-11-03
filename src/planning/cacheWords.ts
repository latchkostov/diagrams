import { t } from "../i18n";
import type { CachePolicy, Popularity } from "../model/caching";
import { formatNumber } from "../i18n/format";

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
