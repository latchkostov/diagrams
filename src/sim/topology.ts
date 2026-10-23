import { matchesRequest, type CompiledMatch, type CompiledRoute } from "./routeMatching";
import { isDenyRule } from "../stencils/netDevices";
import type { DiagramFile, SimRole, Simulation } from "../model/types";
import type { NodeSimProps } from "./types";
import { revisionAtLeast } from "../model/revisions";
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

/** Node output is renamed before connection filters, for services and pass-through nodes only. */
export function outputType(role: SimRole, emits: unknown, type: string): string {
  return role === "processor" || role === "none" ? emittedType(emits, type) : type;
}

/**
 * Pure forwarding decision: the fraction a route may carry (zero excludes it).
 * Deny routes stay eligible so playback and planning can count their blocked share.
 * Tables and brokers ignore fan-out shares; stores publish only async change feeds.
 * Request matching is evaluated after the type filter. Random draws stay in playback. Static message-type
 * analysis calls this for the role gate and share, then checks both filters with a budgeted, compiled matcher.
 */
export function forwardingShare(
  role: SimRole,
  edge: Pick<CompiledEdge, "sync" | "filter" | "share">,
  type: string,
  mode: ForwardingMode = "output",
  requestFilter?: CompiledMatch,
  route?: CompiledRoute,
): number {
  if (mode === "output" && (role === "sink" || (role === "store" && edge.sync))) return 0;
  if (!acceptsType(edge.filter, type) || (requestFilter && !matchesRequest(requestFilter, route))) return 0;
  return mode === "routed" || role === "gateway" || brokerRole(role) ? 1 : (edge.share ?? 1);
}

export type ForwardingMode = "output" | "injected" | "routed";

/** A table action considers positive-weight targets in authored order; no fallback after filtering. */
export function forwardingTargets<Edge>(
  targets: readonly { edgeId: string; weight: number }[],
  edgeAt: (id: string) => Edge | undefined,
  accepts: (edge: Edge) => boolean,
): { eligible: Edge[]; weights: number[] } {
  const eligible: Edge[] = [],
    weights: number[] = [];
  for (const target of targets) {
    if (!(target.weight > 0)) continue;
    const edge = edgeAt(target.edgeId);
    if (!edge || !accepts(edge)) continue;
    eligible.push(edge);
    weights.push(target.weight);
  }
  return { eligible, weights };
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

// Saved-simulation configuration lives here, beside the routes it configures: every playback and analysis chunk
// already shares this module, so the one implementation adds no chunk of its own.
const effectiveDiagrams = new WeakMap<DiagramFile, WeakMap<object, DiagramFile>>();

export function simulationEdges(diagram: DiagramFile, simulation?: Simulation): DiagramFile {
  const overrides = simulation?.setup?.edges;
  if (!overrides || !revisionAtLeast(diagram.planning?.revision, "p3-w1")) return diagram;
  const cache = effectiveDiagrams.get(diagram) ?? new WeakMap<object, DiagramFile>();
  effectiveDiagrams.set(diagram, cache);
  const cached = cache.get(overrides);
  if (cached) return cached;
  const result = {
    ...diagram,
    edges: diagram.edges.map((e) =>
      Object.hasOwn(overrides, e.id)
        ? {
            ...e,
            props: { ...e.props, caller: { ...(e.props?.caller as object | undefined), ...overrides[e.id].caller } },
          }
        : e,
    ),
  };
  cache.set(overrides, result);
  return result;
}

/**
 * How playback configures a saved simulation, in one place: the diagram with the run's caller overrides
 * (simulationEdges), then the run's node patches. Playback loads the first and hands the second to the engine's
 * setNodePropsBatch. A static analysis uses configuredDiagram, so any edit to the diagram is followed by the run's
 * overrides, exactly as when the edited diagram plays.
 */
export function simulationSetup(
  diagram: DiagramFile,
  simulation: Simulation,
): { diagram: DiagramFile; props: Record<string, NodeSimProps> } {
  return {
    diagram: simulationEdges(diagram, simulation),
    props: (simulation.setup?.props ?? {}) as Record<string, NodeSimProps>,
  };
}
