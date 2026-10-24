// Topology edits stay synchronous; routing form helpers load with their optional controls.
import { revisionAtLeast } from "./revisions";
import type { DiagramFile, PlanningModel } from "./types";
import {
  ROUTING_LIMITS,
  routeTargetEdges,
  type RouteTable,
  type RouteAction,
  type RoutingContext,
  type RoutingDocument,
} from "./requestRouting";
import { flowEdges } from "./relations";

/** Routing turned on for a document: its planning with request routes (an empty list counts). */
export function withRouting(planning: PlanningModel | undefined): PlanningModel | undefined {
  if (!planning || !revisionAtLeast(planning.revision, "p3-a1")) return planning;
  return planning.requestRoutes ? planning : { ...planning, requestRoutes: [] };
}

/** A router's ordinary outgoing flows, in diagram order: what Send to may pick. */
export function outgoingFlows(d: Pick<DiagramFile, "edges">, node: string): string[] {
  return flowEdges(d.edges)
    .filter((e) => e.from === node && e.props?.dlq !== true)
    .map((e) => e.id);
}

/**
 * The first table: no rules and a Default that forwards to today's outgoing connections, equally, so adding routes
 * keeps the traffic where it went. Removing that Default is the explicit choice to refuse (404) the rest.
 */
export function firstTable(targets: readonly string[]): RouteTable {
  return targets.length
    ? {
        rules: [],
        default: { targets: targets.slice(0, ROUTING_LIMITS.targets).map((edgeId) => ({ edgeId, weight: 1 })) },
      }
    : { rules: [] };
}

/** A table without the targets `ok` doesn't allow: a rule left with nothing goes, an empty Default becomes 404. */
function strip(table: RouteTable, ok: ReadonlySet<string>): { table: RouteTable; lost: boolean; rules: number } {
  const keep = (a: RouteAction) => a.targets.filter((t) => ok.has(t.edgeId));
  const lost = [...table.rules, ...(table.default ? [table.default] : [])].some(
    (a) => keep(a).length !== a.targets.length,
  );
  if (!lost) return { table, lost, rules: 0 };
  const next: RouteTable = { rules: [] };
  let rules = 0;
  for (const rule of table.rules) {
    const targets = keep(rule);
    if (targets.some((t) => t.weight > 0)) next.rules.push({ ...rule, targets });
    else rules++;
  }
  if (table.default) {
    const targets = keep(table.default);
    if (targets.some((t) => t.weight > 0)) next.default = { ...table.default, targets };
  }
  return { table: next, lost, rules };
}

/**
 * Route tables whose targets an edit took away (a deleted or reconnected connection, a deleted service), on nodes
 * and in saved simulations' setup and timeline: each without those targets. A rule left with nothing to send to
 * is removed, and a Default left empty becomes Reject 404, so nothing is ever widened or sent somewhere else.
 * Undefined when no table lost a target.
 */
export function strippedTables(
  d: RoutingDocument,
  context: RoutingContext,
): { tables: Map<string, RouteTable>; simulations?: DiagramFile["simulations"]; rules: number } | undefined {
  const allowed = routeTargetEdges(d, context.roleOf, context.isDlq);
  const tables = new Map<string, RouteTable>();
  let rules = 0;
  const fix = (node: string, table: unknown): RouteTable | undefined => {
    const t = table as RouteTable | undefined;
    if (!t || !Array.isArray(t.rules)) return undefined;
    const result = strip(t, allowed.get(node) ?? new Set<string>());
    if (!result.lost) return undefined;
    rules += result.rules;
    return result.table;
  };
  for (const node of d.nodes) {
    const table = fix(node.id, node.props?.routeTable);
    if (table) tables.set(node.id, table);
  }
  let changed = false;
  const simulations = d.simulations?.map((sim) => {
    const setup = Object.entries(sim.setup?.props ?? {}).map(([node, patch]) => {
      const table = fix(node, patch.routeTable);
      if (!table) return [node, patch] as const;
      changed = true;
      return [node, { ...patch, routeTable: table }] as const;
    });
    const timeline = (sim.timeline ?? []).map((step) => {
      if (step.action.do !== "props") return step;
      const table = fix(step.action.node, step.action.props.routeTable);
      if (!table) return step;
      changed = true;
      return { ...step, action: { ...step.action, props: { ...step.action.props, routeTable: table } } };
    });
    return {
      ...sim,
      ...(sim.setup
        ? { setup: { ...sim.setup, ...(sim.setup.props ? { props: Object.fromEntries(setup) } : {}) } }
        : {}),
      ...(sim.timeline ? { timeline } : {}),
    };
  });
  if (!tables.size && !changed) return undefined;
  return { tables, ...(changed ? { simulations } : {}), rules };
}

/** The document with a first route table on a router (Default keeps today's connections): one undo step. */
export function withRouteTable(d: DiagramFile, nodeId: string): DiagramFile {
  const next = structuredClone(d);
  next.planning = withRouting(next.planning);
  const node = next.nodes.find((n) => n.id === nodeId);
  if (node) node.props = { ...node.props, routeTable: firstTable(outgoingFlows(next, nodeId)) };
  return next;
}
