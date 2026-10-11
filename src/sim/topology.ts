import type { DiagramEdge, DiagramNode, SimRole } from "../model/types";
export const brokerRole = (role: SimRole) => role === "queue" || role === "topic" || role === "stream";
/** Explicit false wins; infer labels only on broker-to-broker/store paths. */
export function isDlqEdge(edge: DiagramEdge, fromRole: SimRole, target: DiagramNode, toRole: SimRole): boolean {
  return (
    edge.props?.dlq === true ||
    (edge.props?.dlq !== false &&
      brokerRole(fromRole) &&
      (brokerRole(toRole) || toRole === "store") &&
      /dlq|dead.?letter/i.test(`${target.label} ${target.sublabel ?? ""}`))
  );
}
/** Fair, stable partition assignment across distinct nodes in one consumer group. */
export function allocateReplicas(members: { id: string; replicas: number }[], partitions: number): Map<string, number> {
  const unique = [...new Map(members.map((member) => [member.id, member])).values()];
  const result = new Map(unique.map((member) => [member.id, 0]));
  let remaining = partitions;
  while (remaining > 0) {
    const eligible = unique.filter((member) => result.get(member.id)! < member.replicas);
    if (!eligible.length) break;
    const batch = Math.max(1, Math.floor(remaining / eligible.length));
    for (const member of eligible) {
      const count = Math.min(remaining, batch, member.replicas - result.get(member.id)!);
      result.set(member.id, result.get(member.id)! + count);
      remaining -= count;
    }
  }
  return result;
}
export function acceptsType(filter: unknown, type: string): boolean {
  return (
    !Array.isArray(filter) ||
    filter.some(
      (pattern) =>
        typeof pattern === "string" &&
        (pattern.endsWith("*") ? type.startsWith(pattern.slice(0, -1)) : type === pattern),
    )
  );
}
export function emittedType(emits: unknown, type: string): string {
  if (typeof emits === "string") return emits;
  if (emits && typeof emits === "object" && !Array.isArray(emits)) {
    const mapping = emits as Record<string, unknown>;
    const value = Object.hasOwn(mapping, type) ? mapping[type] : mapping["*"];
    if (typeof value === "string") return value;
  }
  return type;
}
