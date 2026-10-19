import { t } from "../i18n";
import { formatNumber } from "../i18n/format";
export const latencyDuration = (ms: number) =>
  t("latency.seconds", { value: formatNumber(ms / 1000, { maximumFractionDigits: ms < 1000 ? 3 : 1 }) });
import type { LatencySummary, LatencyMetrics } from "../sim/types";

export function latencyLabel(latency: LatencySummary) {
  return t("latency.p95", { duration: latencyDuration(latency.p95) });
}

export function latencySampling(latency: LatencySummary & Pick<Partial<LatencyMetrics>, "sinceFault">) {
  return latency.sinceFault
    ? t("latency.samplingSinceFault", { count: latency.samples })
    : t("latency.sampling", { count: latency.samples });
}
