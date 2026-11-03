import type { NodeSimState } from "../sim/types";
import { t } from "../i18n";

export function cacheReadout(s: NodeSimState) {
  const w = s.cacheDetails?.window;
  if (!w || !(w.hits + w.misses)) return;
  const hit = Math.round((100 * w.hits) / (w.hits + w.misses));
  const offload = w.requests ? Math.round(100 * (1 - w.fetches / w.requests)) : 0;
  const warming = hit < (s.cacheDetails?.expected ?? 0) * 100 - 20;
  return {
    hit,
    offload,
    warming,
    label: t("cache.semantics", { hit, state: warming ? "warming" : "steady" }),
    text: t("cache.chip", { hit, state: warming ? "warming" : "steady" }),
  };
}
