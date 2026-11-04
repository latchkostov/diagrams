import type { DiagramFile } from "../model/types";
import type { NodeSimState } from "../sim/types";
import type { CacheTable } from "../model/caching";
import { t } from "../i18n";
import { formatNumber } from "../i18n/format";
import { cacheReadout } from "./cacheReadout";
import { latencyDuration } from "./latencyFormat";
import { configuredPlanning } from "../planning/cache";
import { planningHost } from "./planningHost";
import { policyWords } from "../planning/cacheWords";

/** Shared by the hover card and docked Live details. */
export function CacheDetails({
  diagram,
  id,
  s,
  properties,
}: {
  diagram: DiagramFile;
  id: string;
  s: NodeSimState;
  properties?: Record<string, unknown>;
}) {
  const readout = cacheReadout(s);
  const table = (properties?.cache ?? diagram.nodes.find((n) => n.id === id)?.props?.cache) as CacheTable | undefined;
  const live = planningHost.get();
  const planned = configuredPlanning(diagram, live?.controller.getState())?.analysis.cacheDemand?.[id];
  const w = s.cacheDetails?.window;
  const latency = s.cacheDetails?.latency;
  const sinceFault = s.cacheDetails?.sinceFault;
  const rate = (n: number) => formatNumber(n / (w?.seconds ?? 10), { maximumFractionDigits: 1 });
  return (
    <div data-testid="cache-readout">
      <p>{readout ? t("cache.summary", { ...readout, mode: "window" }) : t("cache.noCacheable")}</p>
      {!!s.cache?.coalesced && (
        <p data-testid="cache-coalesced">{t("cache.coalesced", { mode: "count", count: s.cache.coalesced })}</p>
      )}
      {w && (
        <p data-testid="cache-window-counts">
          {t("cache.counts", {
            hits: rate(w.hits),
            misses: rate(w.misses),
            notCached: rate(Math.max(0, w.requests - w.hits - w.misses)),
          })}
        </p>
      )}
      {table &&
        [
          ...table.rules,
          ...(table.default ? [{ id: "", label: t("cache.everythingElse"), policy: table.default }] : []),
        ].map((rule) => {
          const counts = s.cache?.rules[rule.id];
          const total = (counts?.hits ?? 0) + (counts?.misses ?? 0) + (counts?.coalesced ?? 0);
          return (
            <p key={rule.id} data-testid={`cache-live-rule-${rule.id}`}>
              {rule.policy.noStore
                ? `${rule.label || rule.id}: ${t("cache.noStore")}`
                : t("cache.ruleMeasured", {
                    name: rule.label || rule.id,
                    policy: policyWords(rule.policy),
                    hit: total ? Math.round((100 * counts!.hits) / total) : 0,
                    expected: planned ? Math.round(100 * (planned[rule.id]?.hitRatio ?? 0)) : "unavailable",
                  })}
            </p>
          );
        })}
      <p data-testid="cache-latency">
        {t("cache.latency", {
          scope: sinceFault ? "fault" : "restart",
          at: formatNumber((sinceFault?.atMs ?? 0) / 1000, { maximumFractionDigits: 2 }),
          hit: latency?.hit?.samples ? latencyDuration(latency.hit.p95) : "—",
          miss: latency?.miss?.samples ? latencyDuration(latency.miss.p95) : "—",
        })}
      </p>
      {readout && readout.hit < 95 && <p className="insp-note">{t("cache.missTail", { miss: 100 - readout.hit })}</p>}
    </div>
  );
}
