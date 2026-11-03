import type { DiagramFile } from "../model/types";
import type { LiveState } from "../live/controller";
import { configuredPlanning } from "./cache";
import { explainNode } from "./explanation";
import { cacheDuration, popularityLabel } from "./cacheWords";
import { t } from "../i18n";
import { formatNumber } from "../i18n/format";

export function CacheDerivations({
  diagram,
  state,
  id,
}: {
  diagram: DiagramFile;
  state?: LiveState | null;
  id?: string;
}) {
  const configured = configuredPlanning(diagram, state);
  if (!configured) return null;
  const number = (n: number) => formatNumber(n, { maximumFractionDigits: 0 });
  return (
    <>
      {diagram.nodes
        .filter((n) => (!id || n.id === id) && configured.analysis.cacheDemand?.[n.id])
        .map((node) => {
          const x = explainNode(diagram, node.id, {
            analysis: configured.analysis,
            sim: configured.sim,
            includeCache: true,
            fixes: false,
          });
          return (
            <div className="insp-note" data-testid={`cache-derivation-${node.id}`} key={node.id}>
              {x?.cache
                ?.filter((r) => !r.policy.noStore)
                .map((r) => (
                  <p key={r.id} data-testid={`cache-derivation-${node.id}-${r.id}`}>
                    {r.rate
                      ? t("cache.derivation", {
                          name: r.label,
                          rate: number(r.rate),
                          ttl: cacheDuration(r.policy.ttlMs!),
                          count: r.policy.keys ?? 1000,
                          popularity: popularityLabel(r.policy.popularity ?? "typical"),
                          hit: Math.round(r.hitRatio * 100),
                          fetch: number(r.rate * (1 - r.hitRatio)),
                          origin: r.origin || t("cache.origin"),
                        })
                      : t("cache.noTraffic")}
                  </p>
                ))}
              {x?.cache?.some((r) => r.rate > 0) && (
                <p>
                  {t("cache.coldDerivation", {
                    origin: x.cache[0].origin || t("cache.origin"),
                    rate: number(configured.analysis.nodes[node.id].offered),
                  })}
                </p>
              )}
            </div>
          );
        })}
    </>
  );
}
