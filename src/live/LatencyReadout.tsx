import { t } from "../i18n";
import { formatDuration, formatPercent } from "../i18n/format";
import type { LatencyMetrics } from "../sim/types";
import { latencyLabel, latencySampling } from "./latencyFormat";

/** The same sampled paths supply all percentiles and the breakdown. */
export function LatencyReadout({ id, latency }: { id: string; latency: LatencyMetrics }) {
  const total = latency.waitMs + latency.workMs + latency.travelMs;
  const share = (ms: number) => formatPercent(total > 0 ? ms / total : 0);
  return (
    <div className="lv-latency" data-testid={`node-latency-detail-${id}`}>
      <strong>{t("latency.heading")}</strong>
      <div className="lv-latency-strip mono" data-testid={`node-latency-percentiles-${id}`}>
        <span>{t("latency.p50", { duration: formatDuration(latency.p50) })}</span>
        <span>{latencyLabel(latency)}</span>
        <span>{t("latency.p99", { duration: formatDuration(latency.p99) })}</span>
      </div>
      <small>{latencySampling(latency)}</small>
      {latency.typesLimited && <small data-testid={`node-latency-limited-${id}`}>{t("latency.typesLimited")}</small>}
      <div data-testid={`node-latency-breakdown-${id}`}>
        {t("latency.breakdown", {
          wait: share(latency.waitMs),
          work: share(latency.workMs),
          travel: share(latency.travelMs),
        })}
      </div>
      <small>{t("latency.scope")}</small>
    </div>
  );
}
