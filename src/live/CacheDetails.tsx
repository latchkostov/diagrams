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
  const rate = (n: number) => cacheRate(n / (w?.seconds ?? 10));
  const origin =
    diagram.edges
      .filter((edge) => edge.from === id && edge.kind === "sync" && (!edge.relation || edge.relation === "flow"))
      .map((edge) => diagram.nodes.find((node) => node.id === edge.to)?.label ?? edge.to)
      .join(", ") || t("cache.origin");
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
            ? t("cache.ruleNotCached", { name, count: isolate(formatNumber(counts.requests)), origin: isolate(origin) })
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
              misses: rate(w.misses),
              notCached: rate(Math.max(0, w.requests - w.hits - w.misses)),
            })}
          </p>
          <p data-testid="cache-offload-counts">
            {t("cache.keptAway", { node: isolate(origin), rate: rate(Math.max(0, w.requests - w.fetches)) })}
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
