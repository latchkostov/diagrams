import { t } from "../i18n";
import { formatDuration } from "../i18n/format";
import type { LatencySummary } from "../sim/types";

export function latencyLabel(latency: LatencySummary) {
  return t("latency.p95", { duration: formatDuration(latency.p95) });
}

export function latencySampling(latency: LatencySummary) {
  return t("latency.sampling", { count: latency.samples });
}
