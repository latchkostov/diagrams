import type { DiagramFile } from "../model/types";
import { outageMembership, type Fault } from "../model/faults";
import { nodeFaultLabel } from "../model/faultWords";
import { t } from "../i18n";
import type { Trouble } from "./observedTrouble";

export function faultTrouble(
  trouble: Trouble | undefined,
  diagram: DiagramFile,
  faults: readonly Fault[] = [],
  nodes: Record<string, { dropped: number }> = {},
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
  if (!node) return trouble;
  const label = diagram.nodes.find((n) => n.id === node)?.label || node;
  return {
    ...trouble,
    detail: t("fault.cause", { label, fault: nodeFaultLabel(node, faults) }),
    action: { kind: "clear-fault", node },
  };
}
