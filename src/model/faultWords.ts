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
export function faultLabel(fault: Fault, preset?: DrillPreset, diagram?: DiagramFile): string {
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
  const id = faultTarget(fault);
  const target =
    fault.kind === "boundary"
      ? diagram?.groups?.find((g) => g.id === id)?.label
      : fault.kind === "link"
        ? (() => {
            const edge = diagram?.edges.find((e) => e.id === id);
            return (
              edge &&
              (edge.label ||
                `${diagram?.nodes.find((n) => n.id === edge.from)?.label || edge.from} → ${diagram?.nodes.find((n) => n.id === edge.to)?.label || edge.to}`)
            );
          })()
        : diagram?.nodes.find((n) => n.id === id)?.label;
  return t("fault.marker", { action, target: target || id });
}

export function boundaryRestoreHint(diagram: DiagramFile, node: string, faults?: readonly Fault[]): string | undefined {
  const outage = boundaryOutage(diagram, node, faults);
  return outage ? t("fault.restoreBoundaryFirst", { boundary: outage.label || outage.id }) : undefined;
}

export function nodeFaultLabel(node: string, faults: readonly Fault[] = []): string {
  return faults
    .flatMap((fault) =>
      fault.kind === "slow" && fault.node === node && fault.factor !== 1
        ? [t("fault.slowerBadge", { factor: fault.factor })]
        : fault.kind === "fail" && fault.node === node && fault.rate !== 0
          ? [t("fault.failureBadge", { rate: fault.rate * 100 })]
          : [],
    )
    .join(" · ");
}
