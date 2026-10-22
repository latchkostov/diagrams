import { t } from "../i18n";
import { formatNumber } from "../i18n/format";
export const latencyDuration = (ms: number) =>
  t("latency.seconds", { value: formatNumber(ms / 1000, { maximumFractionDigits: ms < 1000 ? 3 : 1 }) });
import type { LatencySummary, LatencyMetrics } from "../sim/types";

export function latencyLabel(latency: LatencySummary) {
  return t("latency.p95", { duration: latencyDuration(latency.p95) });
}

/** Finished messages a readout counts, whole: a sample weighs its dots, so a dot delivered in parts adds up to one. */
export const sampleCount = (latency: Pick<LatencySummary, "samples">) => Math.round(latency.samples);

export function latencySampling(latency: LatencySummary & Pick<Partial<LatencyMetrics>, "sinceFault">) {
  return latency.sinceFault
    ? t("latency.samplingSinceFault", { count: sampleCount(latency) })
    : t("latency.sampling", { count: sampleCount(latency) });
}
