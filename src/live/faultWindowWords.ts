import { t } from "../i18n";
import type { Fault } from "../model/faults";
import type { DiagramFile } from "../model/types";
import { faultTargetLabel } from "../model/faultWords";

/** One translated clause for the hover's single scope line. */
export function faultWindowLabel(fault: Fault, diagram?: DiagramFile): string {
  const label = faultTargetLabel(fault, diagram, false) || t("fault.unnamedTarget");
  switch (fault.kind) {
    case "purge":
      return t("cache.purgeWindow", { label });
    case "boundary":
      return fault.down ? t("latency.windowDown", { label }) : t("latency.windowRestored", { label });
    case "link":
      return fault.cut ? t("latency.windowCut", { label }) : t("latency.windowRestored", { label });
    case "slow":
      return fault.factor === 1
        ? t("latency.windowRestored", { label })
        : t("latency.windowSlow", { label, factor: fault.factor });
    case "fail":
      return fault.rate === 0
        ? t("latency.windowRestored", { label })
        : t("latency.windowFail", { label, rate: fault.rate * 100 });
  }
}
