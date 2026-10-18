import { t } from "../i18n";
import { formatPercent } from "../i18n/format";
import type { LatencyMetrics } from "../sim/types";
import { latencyDuration, latencyLabel, latencySampling } from "./latencyFormat";

/** The same sampled paths supply all percentiles and the breakdown. */
export function LatencyReadout({
  id,
  latency,
  compact = false,
}: {
  id: string;
  latency: LatencyMetrics;
  compact?: boolean;
}) {
  const total = latency.waitMs + latency.workMs + latency.travelMs;
  const share = (ms: number) => formatPercent(total > 0 ? ms / total : 0);
  return (
    <div className="lv-latency" data-testid={`node-latency-detail-${id}`}>
      <strong>{t("latency.heading")}</strong>
      <div className="lv-latency-strip mono" data-testid={`node-latency-percentiles-${id}`}>
        <span>{t("latency.p50", { duration: latencyDuration(latency.p50) })}</span>
        <span>{latencyLabel(latency)}</span>
        <span>{t("latency.p99", { duration: latencyDuration(latency.p99) })}</span>
      </div>
      {!compact && <small>{latencySampling(latency)}</small>}
      {latency.typesLimited && <small data-testid={`node-latency-limited-${id}`}>{t("latency.typesLimited")}</small>}
      <div data-testid={`node-latency-breakdown-${id}`}>
        {compact
          ? t("latency.compactBreakdown", { wait: share(latency.waitMs), work: share(latency.workMs) })
          : t("latency.breakdown", {
              wait: share(latency.waitMs),
              work: share(latency.workMs),
              travel: share(latency.travelMs),
            })}
      </div>
      <small>{compact ? t("latency.finishedScope", { count: latency.samples }) : t("latency.scope")}</small>
    </div>
  );
}
