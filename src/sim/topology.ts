import type { DiagramEdge, DiagramFile, DiagramNode, SimRole } from "../model/types";
import { stencilRole } from "../stencils/roles";
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

export interface CompiledEdge {
  id: string;
  from: string;
  to: string;
  sync: boolean;
  /** True only when excluded from ordinary output. */
  dlq: boolean;
  travelMs: number;
  share?: number;
  filter?: string[];
  emits?: string;
  groupName: string;
}
export interface CompiledGroup {
  broker: string;
  name: string;
  edges: CompiledEdge[];
  /** Distinct consumers, in stable diagram order. */
  members: string[];
}
export interface CompiledTopology {
  edges: CompiledEdge[];
  outgoing: Map<string, CompiledEdge[]>;
  groups: Map<string, CompiledGroup[]>;
  /** Consumers reached exclusively through topic/stream ordinary routes. */
  restricted: Set<string>;
}

/** Normalize and classify routes once, identically for planning and playback. */
export function compileTopology(diagram: DiagramFile, roleOf = stencilRole): CompiledTopology {
  const nodes = new Map(diagram.nodes.map((node) => [node.id, node]));
  const roles = new Map(diagram.nodes.map((node) => [node.id, roleOf(node.stencil)]));
  const edges: CompiledEdge[] = [];
  const outgoing = new Map<string, CompiledEdge[]>();
  const groups = new Map<string, CompiledGroup[]>();
  const ids = new Set<string>(),
    restricted = new Set<string>(),
    unrestricted = new Set<string>();
  for (const input of diagram.edges) {
    const from = roles.get(input.from),
      to = roles.get(input.to),
      target = nodes.get(input.to);
    if (from === undefined || to === undefined || !target || ids.has(input.id)) continue;
    ids.add(input.id);
    const value = input.props?.travelMs;
    const edge: CompiledEdge = {
      id: input.id,
      from: input.from,
      to: input.to,
      sync: input.kind === "sync",
      dlq: (brokerRole(from) || from === "processor") && isDlqEdge(input, from, target, to),
      travelMs:
        typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : input.kind === "sync" ? 450 : 900,
      share:
        typeof input.props?.share === "number" && Number.isFinite(input.props.share)
          ? Math.max(0, Math.min(1, input.props.share))
          : undefined,
      filter: Array.isArray(input.props?.filter)
        ? input.props.filter.filter((value): value is string => typeof value === "string")
        : undefined,
      emits: typeof input.props?.emits === "string" ? input.props.emits : undefined,
      groupName: from === "queue" ? "queue" : typeof input.props?.group === "string" ? input.props.group : input.id,
    };
    edges.push(edge);
    if (edge.dlq) continue;
    const routes = outgoing.get(edge.from) ?? [];
    routes.push(edge);
    outgoing.set(edge.from, routes);
    if (from === "topic" || from === "stream") restricted.add(edge.to);
    else unrestricted.add(edge.to);
  }
  for (const [id, routes] of outgoing) {
    if (!brokerRole(roles.get(id)!)) continue;
    const named = new Map<string, CompiledGroup>();
    for (const edge of routes) {
      let group = named.get(edge.groupName);
      if (!group) {
        group = { broker: id, name: edge.groupName, edges: [], members: [] };
        named.set(edge.groupName, group);
      }
      group.edges.push(edge);
    }
    for (const group of named.values()) group.members = [...new Set(group.edges.map((edge) => edge.to))];
    groups.set(id, [...named.values()]);
  }
  for (const id of unrestricted) restricted.delete(id);
  return { edges, outgoing, groups, restricted };
}

/** Both consumers use the same normalized member budgets and stable assignment policy. */
export function allocateGroupReplicas(
  role: SimRole,
  partitions: number,
  members: { id: string; role: SimRole; replicas: number }[],
): Map<string, number> {
  const budgets = members.map((member) => ({
    id: member.id,
    replicas: member.role === "processor" ? member.replicas : partitions,
  }));
  return allocateReplicas(
    budgets,
    role === "queue" ? budgets.reduce((sum, member) => sum + member.replicas, 0) : partitions,
  );
}
