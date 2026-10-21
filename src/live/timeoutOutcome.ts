import type { DiagramFile } from "../model/types";
import type { SimSnapshot } from "../sim/types";
import { t } from "../i18n";
import { stencilRole } from "../stencils/roles";

/** A gateway's own expired calls are passed to its callers as 504s; do not infer this from dropped counts. */
export function timeoutOutcome(
  diagram: DiagramFile,
  snapshot: Pick<SimSnapshot, "edges">,
  node: string,
): string | undefined {
  const gateway = diagram.nodes.some((n) => n.id === node && stencilRole(n.stencil) === "gateway")
    ? node
    : diagram.edges.find(
        (e) => e.from === node && diagram.nodes.some((n) => n.id === e.to && stencilRole(n.stencil) === "gateway"),
      )?.to;
  if (!gateway) return;
  const expired = diagram.edges.find((e) => e.from === gateway && (snapshot.edges[e.id]?.calls?.timedOut ?? 0) > 0);
  if (!expired) return;
  const caller = expired.props?.caller as { deadlineMs?: number } | undefined;
  if (caller?.deadlineMs == null) return;
  return t("threads.gatewayOutcome", {
    name: diagram.nodes.find((n) => n.id === gateway)?.label ?? gateway,
    count: snapshot.edges[expired.id].calls!.timedOut,
    seconds: caller.deadlineMs / 1000,
  });
}
