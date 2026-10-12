import type { DiagramEdge, DiagramFile, DiagramNode, SimRole, Simulation } from "../model/types";
import { stencilRole } from "../stencils/roles";
import {
  brokerRole,
  compileTopology,
  deadLetterRoutes,
  type CompiledEdge,
  type CompiledTopology,
} from "../sim/topology";
import { analyzeCapacity, type CapacityAnalysis } from "../sim/capacity";
import { planningSimulation, sourceTraffic } from "../sim/capacityPlanning";
import { readingOrder } from "../canvas/keyboardNav";
import { estimateCardSize } from "../canvas/nodes/size";

/**
 * What every rule reads, built once per run: roles, the simulation's compiled topology (consumers,
 * consumer groups, dead-letter routes), reading order and, on first use, the capacity analysis. Rules
 * share the simulation's model, so a check and the live view never disagree.
 */
export interface CheckContext {
  diagram: DiagramFile;
  nodes: ReadonlyMap<string, DiagramNode>;
  edges: ReadonlyMap<string, DiagramEdge>;
  role(id: string): SimRole;
  topology: CompiledTopology;
  /** Ordinary (non dead-letter) routes out of a node. */
  routes(id: string): readonly CompiledEdge[];
  /** Every compiled flow into a node, dead-letter routes included. */
  incoming(id: string): readonly CompiledEdge[];
  /** The requests (sync flows) out of a node, in diagram order. Built on first use. */
  requests(id: string): readonly CompiledEdge[];
  /** The dead-letter route playback sends this broker's exhausted messages to (deadLetterRoutes). */
  deadLetterRoute(id: string): CompiledEdge | undefined;
  /**
   * The message types that reach a node: in free play and in each saved simulation (capacity analysis, so
   * emits and filters count). Computed on first use.
   */
  typesAt(id: string): ReadonlySet<string>;
  /** Position in reading order (rows from the top, each left to right; columns in a TB diagram); a connection's is its start's. */
  rank(id: string): number;
  /** The node's label, or its id when it has none. */
  name(id: string): string;
  /**
   * A batch key for a fix's ops that no element id shadows: in edit ops an exact id wins over a key, so a key
   * "dlq" in a diagram with a node "dlq" would point at that node.
   */
  freshKey(base: string): string;
  /**
   * Whether a connection's id names it alone. Edit ops resolve an id to a node before a connection, and a file may
   * reuse one id for both: a fix that updates or removes a connection by such an id would change or delete the node
   * (and its connections) instead, so it offers no ops.
   */
  edgeRef(id: string): boolean;
  /** Free play as capacity planning sees it, as live view's Show capacity does (src/sim/capacityPlanning.ts). */
  planning(): Simulation;
  /** analyzeCapacity of `planning()`: the diagram's own (free-play) rates. Computed on first use. */
  capacity(): CapacityAnalysis;
}

export function buildContext(diagram: DiagramFile): CheckContext {
  const nodes = new Map(diagram.nodes.map((n) => [n.id, n]));
  const edges = new Map(diagram.edges.map((e) => [e.id, e]));
  const roles = new Map(diagram.nodes.map((n) => [n.id, stencilRole(n.stencil)]));
  const topology = compileTopology(diagram);
  const incoming = new Map<string, CompiledEdge[]>();
  for (const e of topology.edges) {
    const into = incoming.get(e.to);
    if (into) into.push(e);
    else incoming.set(e.to, [e]);
  }
  const deadLetter = deadLetterRoutes(topology);
  const order = new Map(
    readingOrder(
      diagram.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, ...estimateCardSize(n.label, n.sublabel) })),
      diagram.direction ?? "LR",
    ).map((b, i) => [b.id, i]),
  );
  const role = (id: string) => roles.get(id) ?? "none";
  let planning: Simulation | undefined;
  let capacity: CapacityAnalysis | undefined;
  let types: Map<string, Set<string>> | undefined;
  let requests: Map<string, CompiledEdge[]> | undefined;
  /** Boundary and annotation ids, for freshKey and edgeRef. */
  let others: Set<string> | undefined;
  /** Connection ids the file uses more than once. */
  let twice: Set<string> | undefined;
  const repeated = () => {
    if (twice) return twice;
    const seen = new Set<string>();
    twice = new Set();
    for (const e of diagram.edges) (seen.has(e.id) ? twice : seen).add(e.id);
    return twice;
  };
  const otherIds = () =>
    (others ??= new Set([...(diagram.groups ?? []), ...(diagram.annotations ?? [])].map((x) => x.id)));
  const plan = () =>
    (planning ??= planningSimulation(diagram, {
      id: "free-play",
      title: "Free play",
      traffic: sourceTraffic(diagram),
    }));
  return {
    diagram,
    nodes,
    edges,
    role,
    topology,
    routes: (id) => topology.outgoing.get(id) ?? [],
    incoming: (id) => incoming.get(id) ?? [],
    requests(id) {
      if (!requests) {
        requests = new Map();
        for (const e of topology.edges) {
          if (!e.sync) continue;
          const list = requests.get(e.from);
          if (list) list.push(e);
          else requests.set(e.from, [e]);
        }
      }
      return requests.get(id) ?? [];
    },
    deadLetterRoute: (id) => deadLetter.get(id),
    typesAt(id) {
      if (!types) {
        types = new Map();
        const analyses = [
          capacity ?? analyzeCapacity(diagram, plan()),
          ...(diagram.simulations ?? []).map((sim) => analyzeCapacity(diagram, planningSimulation(diagram, sim))),
        ];
        for (const analysis of analyses)
          for (const [node, list] of Object.entries(analysis.offeredTypes)) {
            const set = types.get(node) ?? new Set<string>();
            for (const type of list) set.add(type);
            types.set(node, set);
          }
      }
      return types.get(id) ?? new Set();
    },
    // A connection reads where it starts.
    rank: (id) => order.get(id) ?? order.get(edges.get(id)?.from ?? "") ?? Infinity,
    name: (id) => nodes.get(id)?.label.trim() || id,
    edgeRef: (id) => edges.has(id) && !nodes.has(id) && !otherIds().has(id) && !repeated().has(id),
    freshKey(base) {
      const taken = (key: string) => nodes.has(key) || edges.has(key) || otherIds().has(key);
      let key = base;
      for (let i = 2; taken(key); i++) key = `${base}-${i}`;
      return key;
    },
    planning: plan,
    capacity: () => (capacity ??= analyzeCapacity(diagram, plan())),
  };
}

export const isBroker = (ctx: CheckContext, id: string) => brokerRole(ctx.role(id));

/** "A", "A and B", "A, B and 2 more". */
export function listNames(names: readonly string[], max = 2): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length <= max) return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
}

/** A rate for a sentence: "0.5/s", "12/s", "2.4k/s". */
export function formatRate(perSec: number): string {
  const trim = (v: string) => v.replace(/\.0+$|(\.\d*?)0+$/, "$1");
  if (perSec >= 1000) return `${trim((perSec / 1000).toFixed(1))}k/s`;
  if (perSec >= 10) return `${Math.round(perSec)}/s`;
  return `${trim(perSec.toFixed(perSec >= 1 ? 1 : 2))}/s`;
}

/** An edge for a sentence: its label, or "From → To". */
export function edgeName(ctx: CheckContext, edge: { id: string; from: string; to: string }): string {
  const label = ctx.edges.get(edge.id)?.label?.trim();
  return label || `${ctx.name(edge.from)} → ${ctx.name(edge.to)}`;
}
