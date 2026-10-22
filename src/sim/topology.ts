import { isDenyRule } from "../stencils/netDevices";
import type { DiagramFile, SimRole } from "../model/types";
import { stencilRole } from "../stencils/roles";
import { flowEdges } from "../model/relations";
/**
 * An edge's travel time at 1x when it doesn't set `travelMs`: a request 200 ms, a message 300 ms (what the public
 * examples set by hand). Travel is animation, never a throughput limit: see the engine's pipeline allowance.
 */
export const DEFAULT_TRAVEL_MS = { async: 300, sync: 200 } as const;
import { brokerRole, isDlqEdge } from "../model/brokerRoutes";
export { brokerRole, isDlqEdge } from "../model/brokerRoutes";
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
  endpointId?: string;
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
  /** A deny rule: what's routed here is blocked at the source node. */
  deny: boolean;
  groupName: string;
}

/** Terminals finish locally; brokers deliver through their consumer groups, never as callers. */
export function callEligible(role: SimRole, edge: Pick<CompiledEdge, "sync" | "dlq">): boolean {
  return (role === "processor" || role === "source" || role === "gateway" || role === "none") && edge.sync && !edge.dlq;
}
/** A call waiting plans and Checks count: eligible, not denied at its source, and forwarding some share. */
export function activeCall(role: SimRole, edge: Pick<CompiledEdge, "sync" | "dlq" | "deny" | "share">): boolean {
  return callEligible(role, edge) && !edge.deny && edge.share !== 0;
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
  // Dependencies (config, secret, identity...) carry no traffic: routing and capacity never see them.
  for (const input of flowEdges(diagram.edges)) {
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
      endpointId:
        input.kind !== "sync" || input.props?.endpointId === undefined
          ? undefined
          : typeof input.props.endpointId === "string"
            ? input.props.endpointId
            : "", // Invalid reference; never the untargeted API.
      dlq: (brokerRole(from) || from === "processor") && isDlqEdge(input, from, target, to),
      travelMs:
        typeof value === "number" && Number.isFinite(value)
          ? Math.max(0, value)
          : DEFAULT_TRAVEL_MS[input.kind === "sync" ? "sync" : "async"],
      share:
        typeof input.props?.share === "number" && Number.isFinite(input.props.share)
          ? Math.max(0, Math.min(1, input.props.share))
          : undefined,
      filter: Array.isArray(input.props?.filter)
        ? input.props.filter.filter((value): value is string => typeof value === "string")
        : undefined,
      emits: typeof input.props?.emits === "string" ? input.props.emits : undefined,
      deny: isDenyRule(input.props),
      groupName: from === "queue" ? "queue" : typeof input.props?.group === "string" ? input.props.group : input.id,
    };
    edges.push(edge);
    if (edge.dlq) continue;
    const routes = outgoing.get(edge.from) ?? [];
    routes.push(edge);
    outgoing.set(edge.from, routes);
    // A deny rule delivers nothing, so its target isn't a consumer: it takes no partition and isn't restricted by one.
    if (edge.deny && brokerRole(from)) continue;
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
    // Members are the consumers: a deny rule's target in the group (and nowhere else in it) isn't one.
    for (const group of named.values())
      group.members = [...new Set(group.edges.filter((edge) => !edge.deny).map((edge) => edge.to))];
    groups.set(id, [...named.values()]);
  }
  for (const id of unrestricted) restricted.delete(id);
  return { edges, outgoing, groups, restricted };
}

/**
 * Where each node's exhausted messages go: its first dead-letter route, as playback uses it (a message that runs
 * out of deliveries travels it when its filter accepts the type, and is dropped otherwise). Only a broker's
 * route catches failed deliveries; a processor's dead-letter edge is never used for them.
 */
export function deadLetterRoutes(compiled: CompiledTopology): Map<string, CompiledEdge> {
  const routes = new Map<string, CompiledEdge>();
  for (const edge of compiled.edges) if (edge.dlq && !routes.has(edge.from)) routes.set(edge.from, edge);
  return routes;
}

/** Both consumers use the same normalized member budgets and stable assignment policy. */
export function allocateGroupReplicas(
  role: SimRole,
  partitions: number,
  members: { id: string; role: SimRole; replicas: number }[],
  partitioned = true,
): Map<string, number> {
  if (!partitioned) return new Map(members.map((member) => [member.id, member.replicas]));
  const budgets = members.map((member) => ({
    id: member.id,
    replicas: member.role === "processor" ? member.replicas : partitions,
  }));
  return allocateReplicas(
    budgets,
    role === "queue" ? budgets.reduce((sum, member) => sum + member.replicas, 0) : partitions,
  );
}

/**
 * How messages reach each node, as playback delivers them: for a node every flow route into which comes from a
 * queue, topic or stream (dead-letter routes and deny rules aside), the brokers that keep its messages while it's
 * down (they stop delivering to it); `null` for a node something pushes to (a down node fails or drops what's pushed).
 * Nodes no flow reaches aren't listed. The live callout, the capacity callout and the `capacity` check share it.
 */
export function brokerFeeds(compiled: CompiledTopology, roleOf: (id: string) => SimRole | undefined) {
  const indexed = new Map<string, Set<string> | null>();
  for (const edge of compiled.edges) {
    if (edge.dlq || edge.deny) continue;
    const role = roleOf(edge.from);
    const known = indexed.get(edge.to);
    if (known === null) continue;
    if (role === undefined || !brokerRole(role)) indexed.set(edge.to, null);
    else if (!known) indexed.set(edge.to, new Set([edge.from]));
    else known.add(edge.from);
  }
  return new Map([...indexed].map(([id, brokers]) => [id, brokers ? [...brokers] : null]));
}
