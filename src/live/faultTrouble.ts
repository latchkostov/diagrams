import type { DiagramFile } from "../model/types";
import { type Fault } from "../model/faults";
import { outageMembership } from "../model/faultRuntime";
import { nodeFaultLabel } from "../model/faultWords";
import { t } from "../i18n";
import type { Trouble } from "./observedTrouble";
import type { CacheDetails } from "../sim/cache/cacheState";
import { formatNumber } from "../i18n/number";
import { isolate } from "./bidi";

export function faultTrouble(
  trouble: Trouble | undefined,
  diagram: DiagramFile,
  faults: readonly Fault[] = [],
  nodes: Record<string, { dropped: number; cacheDetails?: CacheDetails }> = {},
  now?: number,
): Trouble | undefined {
  if (!trouble) return;
  const members = trouble.kind === "down" ? outageMembership(diagram, faults) : undefined;
  const boundary = members?.get(trouble.node);
  if (boundary) {
    const label = boundary.label || boundary.id;
    let dropped = 0;
    for (const [id, outage] of members!) {
      if (outage.id === boundary.id) dropped += nodes[id]?.dropped ?? 0;
    }
    return {
      ...trouble,
      headline: t("fault.boundaryDown", { label }),
      detail: dropped ? t("fault.droppedCount", { count: dropped }) : t("fault.routedElsewhere"),
      action: { kind: "restore-boundary", boundary: boundary.id, label },
    };
  }
  if (trouble.kind === "down") return trouble;
  const node = [trouble.node, ...(trouble.related ?? [])].find((id) => nodeFaultLabel(id, faults));
  if (!node) {
    if (now !== undefined && (trouble.kind === "threads-exhausted" || trouble.kind === "lag"))
      for (const [id, state] of Object.entries(nodes)) {
        const purge = state.cacheDetails?.purge;
        if (!purge || diagram.edges.find((e) => e.id === purge.edge)?.to !== trouble.node) continue;
        return {
          ...trouble,
          detail: t("cache.afterPurge", {
            detail: trouble.detail,
            node: isolate(diagram.nodes.find((n) => n.id === id)?.label ?? id),
            seconds: isolate(formatNumber(Math.max(0, now - purge.atMs) / 1000, { maximumFractionDigits: 1 })),
          }),
        };
      }
    return trouble;
  }
  const label = diagram.nodes.find((n) => n.id === node)?.label || node;
  return {
    ...trouble,
    detail: t("fault.cause", { label, fault: nodeFaultLabel(node, faults) }),
    action: { kind: "clear-fault", node },
  };
}
