import type { DiagramEdge, DiagramFile, DiagramNode, SimRole, Simulation } from "../model/types";
import type { CheckRuleId } from "../model/checks";
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
import { scenarioPlans, type ScalingPlan } from "../sim/scalingPlanner";
import { readingOrder } from "../canvas/keyboardNav";
import { estimateCardSize } from "../canvas/nodes/size";
import { messageTypesAt, type MessageTypes } from "../model/messageTypes";

/**
 * What every rule reads, built once per run: roles, the simulation's compiled topology (consumers,
 * consumer groups, dead-letter routes), reading order and, on first use, the capacity analysis. Rules
 * share the simulation's model, so a check and the live view never disagree.
 */
export interface CheckContext {
  /** When applying a fix, generate candidates only for this finding. Safety still analyzes the whole graph. */
  fixTarget?: string;
  /** Worker-unavailable fallback (and the worker itself): request checks may replay simulations on this thread. */
  local?: boolean;
  /** The rules this run checks, set by runChecks; rules that defer to another read it (unset: every rule). */
  ran?: ReadonlySet<CheckRuleId>;
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
   * The message types that reach a node: the shared static propagation in free play and each saved
   * simulation's configured inputs, emits and filters. Computed on first use.
   */
  typesAt(id: string): ReadonlySet<string>;
  messageTypes(): MessageTypes;
  /** Position in reading order (rows from the top, each left to right; columns in a TB diagram); a connection's is its start's. */
  rank(id: string): number;
  /** The node's label, or its id when it has none. */
  name(id: string): string;
  /**
   * A batch key for a fix's ops that no element id shadows: in edit ops an exact id wins over a key, so a key
   * "dlq" in a diagram with a node "dlq" would point at that node.
   */
  freshKey(base: string): string;
  /** Whether a boundary has this id. Indexed on first use. */
  isBoundary(id: string): boolean;
  /** Free play as capacity planning sees it, as live view's Show capacity does (src/sim/capacityPlanning.ts). */
  planning(): Simulation;
  /** analyzeCapacity of `planning()`: the diagram's own (free-play) rates. Computed on first use. */
  capacity(): CapacityAnalysis;
  /**
   * Scenario sizing for the saved simulations, on first use only (it plays them). In the editor's main thread, what
   * the checks worker already worked out (src/lib/scenarioPlanner.ts); where checks run locally (the worker, the
   * no-worker fallback: src/checks/execute.ts), worked out here when a check reads it.
   */
  plans(): ScalingPlan[] | undefined;
}

/** edit_diagram's limits (src/ai/schemas.ts): a batch's operations, and a reference's length. */
export const MAX_BATCH = 100;
const MAX_REF = 200;

/** Whether ops can name an element by this id: a longer one is past the operation schema's limit. */
export const fitsRef = (id: string) => id.length <= MAX_REF;

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
  let scenario: ScalingPlan[] | undefined | null = null;
  let messages: MessageTypes | undefined;
  let requests: Map<string, CompiledEdge[]> | undefined;
  /** Boundary and annotation ids, for freshKey. */
  let others: Set<string> | undefined;
  let boundaries: Set<string> | undefined;
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
    messageTypes: () => (messages ??= messageTypesAt(diagram)),
    typesAt: (id) => (messages ??= messageTypesAt(diagram)).arriving.get(id) ?? new Set(),
    // A connection reads where it starts.
    rank: (id) => order.get(id) ?? order.get(edges.get(id)?.from ?? "") ?? Infinity,
    name: (id) => nodes.get(id)?.label.trim() || id,
    freshKey(base) {
      const taken = (key: string) => nodes.has(key) || edges.has(key) || otherIds().has(key);
      let key = base;
      for (let i = 2; taken(key); i++) key = `${base}-${i}`;
      return key;
    },
    isBoundary: (id) => (boundaries ??= new Set((diagram.groups ?? []).map((g) => g.id))).has(id),
    planning: plan,
    capacity: () => (capacity ??= analyzeCapacity(diagram, plan())),
    plans: () => (scenario === null ? (scenario = scenarioPlans(diagram)) : scenario),
  };
}

export const isBroker = (ctx: CheckContext, id: string) => brokerRole(ctx.role(id));

/**
 * The boundary every one of `ids` sits in, when they share one (a node a fix adds goes in it, beside them), else
 * undefined.
 */
export function sharedBoundary(ctx: CheckContext, ids: readonly string[]): string | undefined {
  const group = ctx.nodes.get(ids[0])?.group;
  if (!group || !fitsRef(group) || !ctx.isBoundary(group)) return undefined;
  return ids.every((id) => ctx.nodes.get(id)?.group === group) ? group : undefined;
}

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
