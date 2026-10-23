import type { DiagramFile } from "../model/types";
import { faultWindowLabel } from "../model/faultWords";
import { t } from "../i18n";
import { formatPercent } from "../i18n/format";
import type { LatencyMetrics } from "../sim/types";
import { latencyDuration, latencyLabel, latencySampling, sampleCount } from "./latencyFormat";

/** The same sampled paths supply all percentiles and the breakdown. */
export function LatencyReadout({
  id,
  latency,
  compact = false,
  diagram,
}: {
  id: string;
  latency: LatencyMetrics;
  compact?: boolean;
  diagram?: DiagramFile;
}) {
  const total =
    latency.waitMs +
    latency.workMs +
    (latency.callMs ?? 0) +
    (latency.backoffMs ?? 0) +
    (compact ? 0 : latency.travelMs);
  const share = (ms: number) => formatPercent(total > 0 ? ms / total : 0);
  const count = sampleCount(latency);
  const change = latency.sinceFault && faultWindowLabel(latency.sinceFault.fault, diagram);
  return (
    <div className="lv-latency" data-testid={`node-latency-detail-${id}`}>
      <strong>{latency.callMs === undefined ? t("latency.heading") : t("threads.latency")}</strong>
      <div className="lv-latency-strip mono" data-testid={`node-latency-percentiles-${id}`}>
        <span>{t("latency.p50", { duration: latencyDuration(latency.p50) })}</span>
        <span>{latencyLabel(latency)}</span>
        <span>{t("latency.p99", { duration: latencyDuration(latency.p99) })}</span>
      </div>
      {!compact && !latency.sinceFault && <small>{latencySampling(latency)}</small>}
      {latency.typesLimited && <small data-testid={`node-latency-limited-${id}`}>{t("latency.typesLimited")}</small>}
      <div data-testid={`node-latency-breakdown-${id}`}>
        {latency.backoffMs !== undefined
          ? t("resilience.latencyBreakdown", {
              queued: share(latency.waitMs),
              calls: share(latency.callMs ?? 0),
              backoff: share(latency.backoffMs),
              work: share(latency.workMs),
              travel: share(compact ? 0 : latency.travelMs),
            })
          : latency.callMs !== undefined
            ? t("threads.latencyBreakdown", {
                queued: share(latency.waitMs),
                calls: share(latency.callMs),
                work: share(latency.workMs),
                travel: share(compact ? 0 : latency.travelMs),
              })
            : compact
              ? t("latency.compactBreakdown", { wait: share(latency.waitMs), work: share(latency.workMs) })
              : t("latency.breakdown", {
                  wait: share(latency.waitMs),
                  work: share(latency.workMs),
                  travel: share(latency.travelMs),
                })}
      </div>
      <small data-testid={`node-latency-scope-${id}`}>
        {change !== undefined
          ? t("latency.faultScope", { count, change })
          : compact
            ? t("latency.finishedScope", { count })
            : t("latency.scope")}
      </small>
    </div>
  );
}
