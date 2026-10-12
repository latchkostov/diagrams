import type { DiagramEdge, DiagramFile, DiagramNode, SimRole } from "../model/types";
import { stencilRole } from "../stencils/roles";
import { brokerRole, compileTopology, type CompiledEdge, type CompiledTopology } from "../sim/topology";
import { analyzeCapacity, type CapacityAnalysis } from "../sim/capacity";
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
  /** True when a dead-letter route leaves this node. */
  hasDeadLetterRoute(id: string): boolean;
  /** Position in reading order (rows from the top, each left to right; columns in a TB diagram). */
  rank(id: string): number;
  /** The node's label, or its id when it has none. */
  name(id: string): string;
  /**
   * A batch key for a fix's ops that no element id shadows: in edit ops an exact id wins over a key, so a key
   * "dlq" in a diagram with a node "dlq" would point at that node.
   */
  freshKey(base: string): string;
  /**
   * The diagram as capacity planning sees it, as live view's Show capacity does: gateways and stores have no
   * service limit (their capacity is a single-lane estimate), everything else as drawn.
   */
  planning(): DiagramFile;
  /** analyzeCapacity of `planning()` at the diagram's own (free-play) rates. Computed on first use. */
  capacity(): CapacityAnalysis;
}

/** Gateways and stores unlimited, as live view's planning analysis has them (capacityModel's planningSimulation). */
export function planningDiagram(diagram: DiagramFile, role: (id: string) => SimRole): DiagramFile {
  return {
    ...diagram,
    nodes: diagram.nodes.map((n) =>
      role(n.id) === "gateway" || role(n.id) === "store" ? { ...n, props: { ...n.props, latencyMs: 0 } } : n,
    ),
  };
}

export function buildContext(diagram: DiagramFile): CheckContext {
  const nodes = new Map(diagram.nodes.map((n) => [n.id, n]));
  const edges = new Map(diagram.edges.map((e) => [e.id, e]));
  const roles = new Map(diagram.nodes.map((n) => [n.id, stencilRole(n.stencil)]));
  const topology = compileTopology(diagram);
  const incoming = new Map<string, CompiledEdge[]>();
  const deadLetterFrom = new Set<string>();
  for (const e of topology.edges) {
    const into = incoming.get(e.to);
    if (into) into.push(e);
    else incoming.set(e.to, [e]);
    if (e.dlq) deadLetterFrom.add(e.from);
  }
  const order = new Map(
    readingOrder(
      diagram.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, ...estimateCardSize(n.label, n.sublabel) })),
      diagram.direction ?? "LR",
    ).map((b, i) => [b.id, i]),
  );
  const role = (id: string) => roles.get(id) ?? "none";
  let planning: DiagramFile | undefined;
  let capacity: CapacityAnalysis | undefined;
  const plan = () => (planning ??= planningDiagram(diagram, role));
  return {
    diagram,
    nodes,
    edges,
    role,
    topology,
    routes: (id) => topology.outgoing.get(id) ?? [],
    incoming: (id) => incoming.get(id) ?? [],
    hasDeadLetterRoute: (id) => deadLetterFrom.has(id),
    rank: (id) => order.get(id) ?? Infinity,
    name: (id) => nodes.get(id)?.label.trim() || id,
    freshKey(base) {
      const taken = (key: string) =>
        nodes.has(key) ||
        edges.has(key) ||
        !!diagram.groups?.some((g) => g.id === key) ||
        !!diagram.annotations?.some((a) => a.id === key);
      let key = base;
      for (let i = 2; taken(key); i++) key = `${base}-${i}`;
      return key;
    },
    planning: plan,
    capacity: () => (capacity ??= analyzeCapacity(plan())),
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
