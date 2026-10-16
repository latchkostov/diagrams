import type { DiagramEdge, DiagramNode, SimRole } from "./types";
export const brokerRole = (role: SimRole) => role === "queue" || role === "topic" || role === "stream";
/** Explicit false wins; infer labels only on broker-to-broker/store paths. */
export function isDlqEdge(
  edge: DiagramEdge,
  fromRole: SimRole,
  target: Pick<DiagramNode, "label" | "sublabel">,
  toRole: SimRole,
): boolean {
  return (
    edge.props?.dlq === true ||
    (edge.props?.dlq !== false &&
      brokerRole(fromRole) &&
      (brokerRole(toRole) || toRole === "store") &&
      /dlq|dead.?letter/i.test(`${target.label} ${target.sublabel ?? ""}`))
  );
}
