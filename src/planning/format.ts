import { t } from "../i18n";
import { formatNumber } from "../i18n/format";
import type { Explanation } from "./explanation";

export function explanationRate(rate: number, unit: Explanation["unit"]): string {
  const value = formatNumber(rate, { maximumSignificantDigits: 3 });
  return unit === "req/s" ? t("planning.requestRate", { rate: value }) : t("format.rate", { rate: value });
}

/** Preserve a nonzero denominator even for subsecond service times. */
export const formatProcessingSeconds = (seconds: number) => formatNumber(seconds, { maximumSignificantDigits: 3 });
