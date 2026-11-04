import { useMemo } from "react";
import type { DiagramFile } from "../model/types";
import type { NodeSimState } from "../sim/types";
import type { CacheTable } from "../model/caching";
import { t } from "../i18n";
import { formatNumber, formatPercent } from "../i18n/format";
import { cacheReadout } from "./cacheReadout";
import { cacheLatency, cacheRate, policyWords } from "../planning/cacheWords";
import { configuredPlanning } from "../planning/cache";
import { planningHost } from "./planningHost";
import { ReadoutDisclosure } from "./ReadoutDisclosure";
import { isolate } from "./bidi";
import { cacheOriginIndex } from "./cacheOrigins";
import { cacheDestinations } from "./cacheDestinations";
import { formatList } from "../i18n/format";

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
  const node = useMemo(() => diagram.nodes.find((n) => n.id === id), [diagram, id]);
  const table = (properties?.cache ?? node?.props?.cache) as CacheTable | undefined;
  const routeTable = properties?.routeTable ?? node?.props?.routeTable;
  const index = useMemo(() => cacheOriginIndex(diagram), [diagram]);
  const destinations = useMemo(
    () => cacheDestinations(diagram, id, index, table, routeTable),
    [diagram, id, index, table, routeTable],
  );
  const live = planningHost.get();
  const planned = configuredPlanning(diagram, live?.controller.getState())?.analysis.cacheDemand?.[id];
  const w = s.cacheDetails?.window;
  const latency = s.cacheDetails?.latency;
  const rate = (n: number) => cacheRate(n / (w?.seconds ?? 10));
  const rules = table && [
    ...table.rules,
    ...(table.default ? [{ id: "", label: t("cache.everythingElse"), policy: table.default }] : []),
  ];
  const ruleList = rules?.map((rule) => {
    const counts = s.cache?.rules[rule.id];
    const total = (counts?.hits ?? 0) + (counts?.misses ?? 0) + (counts?.coalesced ?? 0);
    const name = isolate(rule.label || rule.id);
    return (
      <p key={rule.id} dir="auto" data-testid={`cache-live-rule-${rule.id}`}>
        {!counts?.requests
          ? t("cache.ruleNoRequests", { name })
          : rule.policy.noStore
            ? t("cache.ruleNotCached", {
                name,
                count: isolate(formatNumber(counts.requests)),
                origin: formatList((destinations.rules.get(rule.id) ?? []).map(isolate)) || t("cache.origin"),
              })
            : t("cache.ruleMeasured", {
                name,
                policy: isolate(policyWords(rule.policy)),
                hit: isolate(formatPercent(total ? counts.hits / total : 0)),
                expected: planned ? isolate(formatPercent(planned[rule.id]?.hitRatio ?? 0)) : "unavailable",
              })}
      </p>
    );
  });
  return (
    <div data-testid="cache-readout" dir="auto">
      {!!s.cache?.coalesced && (
        <p data-testid="cache-coalesced">{t("cache.coalesced", { mode: "count", count: s.cache.coalesced })}</p>
      )}
      {w && (
        <>
          <p data-testid="cache-window-counts">
            {t("cache.counts", {
              hits: rate(w.hits),
              misses: rate(w.fetches),
              notCached: rate(Math.max(0, w.requests - w.hits - w.misses)),
            })}
          </p>
          <p data-testid="cache-offload-counts">
            {destinations.singleOrigin
              ? t("cache.keptAway", {
                  node: isolate(destinations.singleOrigin),
                  rate: rate(Math.max(0, w.requests - w.fetches)),
                })
              : t("cache.keptAwayAggregate", { rate: rate(Math.max(0, w.requests - w.fetches)) })}
          </p>
        </>
      )}
      {rules && rules.length > 3 ? (
        <ReadoutDisclosure title={t("cache.rules")} testId="cache-live-rules">
          {ruleList}
        </ReadoutDisclosure>
      ) : (
        ruleList
      )}
      <p data-testid="cache-latency">
        {t("cache.latency", {
          hit: latency?.hit?.samples ? isolate(cacheLatency(latency.hit.p95, true)) : "—",
          miss: latency?.miss?.samples ? isolate(cacheLatency(latency.miss.p95)) : "—",
        })}
      </p>
      <p className="insp-note">{t("cache.p95Hint")}</p>
      {readout && readout.hit < 95 && <p className="insp-note">{t("cache.missTail", { miss: 100 - readout.hit })}</p>}
    </div>
  );
}
