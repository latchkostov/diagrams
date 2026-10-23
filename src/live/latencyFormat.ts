import { t } from "../i18n";
import { formatNumber } from "../i18n/format";
export const latencyDuration = (ms: number) =>
  t("latency.seconds", { value: formatNumber(ms / 1000, { maximumFractionDigits: ms < 1000 ? 3 : 1 }) });
import type { LatencySummary, LatencyMetrics } from "../sim/types";

export function latencyLabel(latency: LatencySummary) {
  return t("latency.p95", { duration: latencyDuration(latency.p95) });
}

/**
 * Finished messages a readout counts. A sample weighs its dots, so a dot delivered in parts adds up to one and the
 * total can be fractional: it reads whole, and a positive total reads at least one (a part of a dot finished).
 */
export const sampleCount = (latency: Pick<LatencySummary, "samples">): number =>
  latency.samples > 0 ? Math.max(1, Math.round(latency.samples)) : 0;

export function latencySampling(latency: LatencySummary & Pick<Partial<LatencyMetrics>, "sinceFault">) {
  const count = sampleCount(latency);
  return latency.sinceFault ? t("latency.samplingSinceFault", { count }) : t("latency.sampling", { count });
}
