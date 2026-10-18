import type { DiagramFile } from "../model/types";
import { boundaryOutage, type Fault } from "../model/faults";
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
  const boundary = trouble.kind === "down" ? boundaryOutage(diagram, trouble.node, faults) : undefined;
  if (boundary) {
    const label = boundary.label || boundary.id;
    const dropped = diagram.nodes
      .filter((n) => boundaryOutage(diagram, n.id, faults)?.id === boundary.id)
      .reduce((sum, n) => sum + (nodes[n.id]?.dropped ?? 0), 0);
    return {
      ...trouble,
      headline: t("fault.boundaryDown", { label }),
      detail: dropped ? t("fault.droppedCount", { count: dropped }) : t("fault.routedElsewhere"),
      action: { kind: "restore-boundary", boundary: boundary.id, label },
    };
  }
  const node = [trouble.node, ...(trouble.related ?? [])].find((id) => nodeFaultLabel(id, faults));
  if (!node) return trouble;
  const label = diagram.nodes.find((n) => n.id === node)?.label || node;
  return {
    ...trouble,
    detail: t("fault.cause", { label, fault: nodeFaultLabel(node, faults) }),
    action: { kind: "clear-fault", node },
  };
}
