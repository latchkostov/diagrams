import { getLocale, t } from "../i18n/core";
import type { DiagramFile } from "./types";
import { faultTarget, type DrillPreset, type Fault } from "./faults";
import { boundaryOutage } from "./faultRuntime";

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
  return t("fault.marker", { action, target: faultTargetLabel(fault, diagram) || faultTarget(fault) });
}

function faultTargetLabel(fault: Fault, diagram?: DiagramFile, ids = true): string | undefined {
  const id = faultTarget(fault);
  return fault.kind === "boundary"
    ? diagram?.groups?.find((g) => g.id === id)?.label
    : fault.kind === "link"
      ? (() => {
          const edge = diagram?.edges.find((e) => e.id === id);
          return (
            edge &&
            (edge.label ||
              `${diagram?.nodes.find((n) => n.id === edge.from)?.label || (ids ? edge.from : t("fault.unnamedTarget"))} → ${diagram?.nodes.find((n) => n.id === edge.to)?.label || (ids ? edge.to : t("fault.unnamedTarget"))}`)
          );
        })()
      : diagram?.nodes.find((n) => n.id === id)?.label;
}

export function boundaryRestoreHint(diagram: DiagramFile, node: string, faults?: readonly Fault[]): string | undefined {
  const outage = boundaryOutage(diagram, node, faults);
  return outage ? t("fault.restoreBoundaryFirst", { boundary: outage.label || outage.id }) : undefined;
}

const faultLabels = new WeakMap<readonly Fault[], { locale: string; labels: ReadonlyMap<string, string> }>();
const NO_FAULTS: readonly Fault[] = [];

export function nodeFaultLabels(faults: readonly Fault[] = NO_FAULTS): ReadonlyMap<string, string> {
  const locale = getLocale();
  const cached = faultLabels.get(faults);
  if (cached?.locale === locale) return cached.labels;
  const parts = new Map<string, string[]>();
  for (const fault of faults) {
    if (fault.kind !== "slow" && fault.kind !== "fail") continue;
    const label =
      fault.kind === "slow"
        ? fault.factor !== 1
          ? t("fault.slowerBadge", { factor: fault.factor })
          : ""
        : fault.rate !== 0
          ? t("fault.failureBadge", { rate: fault.rate * 100 })
          : "";
    if (!label) continue;
    const values = parts.get(fault.node) ?? [];
    values.push(label);
    parts.set(fault.node, values);
  }
  const labels = new Map([...parts].map(([node, values]) => [node, values.join(" · ")]));
  faultLabels.set(faults, { locale, labels });
  return labels;
}

export function nodeFaultLabel(node: string, faults?: readonly Fault[]): string {
  return nodeFaultLabels(faults).get(node) ?? "";
}

/** One translated clause for the hover's single scope line. */
export function faultWindowLabel(fault: Fault, diagram?: DiagramFile): string {
  const label = faultTargetLabel(fault, diagram, false) || t("fault.unnamedTarget");
  switch (fault.kind) {
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
