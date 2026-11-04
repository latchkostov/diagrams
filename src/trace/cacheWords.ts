import { t } from "../i18n";
import type { CacheTrace } from "../sim/types";
import type { DiagramLike } from "./journey";
import type { CacheTable } from "../model/caching";

export function cacheTraceWords(cache: CacheTrace, id: string, diagram: DiagramLike) {
  const node = diagram.nodes.find((n) => n.id === id);
  const name = node?.label ?? id;
  const rule =
    (node?.props?.cache as CacheTable | undefined)?.rules.find((r) => r.id === cache.rule)?.label ?? cache.rule ?? "";
  if (cache.fetches) return t("cache.herdEvent", { node: name, count: cache.fetches, rule });
  if (cache.outcome === "coalesced") return t("cache.coalesced", { mode: "waiting", count: 0 });
  if (cache.outcome === "stale") return t("cache.staleTrace");
  if (cache.outcome === "hit")
    return cache.item && cache.freshMs !== undefined
      ? t("cache.hitFresh", {
          node: name,
          rule,
          item: cache.item,
          ttl: t("format.importSeconds", { duration: Math.round(cache.freshMs / 1000) }),
        })
      : t("cache.hitTrace", { node: name });
  if (cache.outcome === "miss")
    return t("cache.missTrace", {
      node: name,
      origin: diagram.nodes.find((n) => n.id === cache.origin)?.label ?? cache.origin ?? t("cache.origin"),
    });
  return t("cache.passTrace", {
    reason:
      cache.reason === "no-store"
        ? t("cache.noStore")
        : cache.reason === "method"
          ? t("cache.method")
          : t("cache.noMatch"),
  });
}
