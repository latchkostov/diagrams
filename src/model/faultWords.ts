import { t } from "../i18n/core";
import type { DiagramFile } from "./types";
import { boundaryOutage, faultTarget, type DrillPreset, type Fault } from "./faults";

export function drillName(preset: DrillPreset): string {
  switch (preset) {
    case "zone-outage":
      return t("fault.zoneOutage");
    case "region-connectivity":
      return t("fault.regionConnectivity");
    case "slow-dependency":
      return t("fault.slowDependency");
    case "error-spike":
      return t("fault.errorSpike");
  }
}

/** Shared marker words for playback, headless runs and the authored timeline. */
export function faultLabel(fault: Fault, preset?: DrillPreset): string {
  const action = preset
    ? drillName(preset)
    : fault.kind === "boundary"
      ? fault.down
        ? t("fault.takeDown")
        : t("fault.restore")
      : fault.kind === "link"
        ? fault.cut
          ? t("fault.cut")
          : t("fault.reconnect")
        : fault.kind === "slow"
          ? t("fault.slow")
          : t("fault.fail");
  return t("fault.marker", { action, target: faultTarget(fault) });
}

export function boundaryRestoreHint(diagram: DiagramFile, node: string, faults?: readonly Fault[]): string | undefined {
  const outage = boundaryOutage(diagram, node, faults);
  return outage ? t("fault.restoreBoundaryFirst", { boundary: outage.label || outage.id }) : undefined;
}
