import type { DiagramFile, PlanningModel } from "./types";
import {
  addressText,
  nextAppearance,
  ROUTING_LIMITS,
  type HttpMethod,
  type PathMatch,
  type RequestAddress,
  type RequestRoute,
  type RouteAction,
  type RouteMatch,
  type RouteRule,
  type RouteTable,
  type TrafficMix,
  routeTargetEdges,
  type RoutingContext,
  type RoutingDocument,
} from "./requestRouting";
import { flowEdges } from "./relations";

/**
 * Pure edits behind the routing inspector, agents and fixes: every one returns new records and leaves its input
 * untouched, so a single undo step can carry a route, a mix row and a table together.
 */

/** A readable, unique id for a new route: "post-orders", then "post-orders-2". */
export function routeId(address: Pick<RequestAddress, "method" | "path">, taken: Iterable<string>): string {
  const used = new Set(taken);
  const slug = `${address.method}-${address.path}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const base = slug || "route";
  let id = base;
  for (let i = 2; used.has(id); i++) id = `${base}-${i}`;
  return id;
}

/** The document's routes with one more, its id and appearance allocated (an unused colour/marker pair). */
export function addRoute(
  routes: readonly RequestRoute[],
  address: RequestAddress,
  label?: string,
): { routes: RequestRoute[]; id: string } {
  const id = routeId(
    address,
    routes.map((r) => r.id),
  );
  const route: RequestRoute = {
    id,
    ...(label?.trim() ? { label: label.trim() } : {}),
    address,
    appearance: nextAppearance(routes),
  };
  return { routes: [...routes, route], id };
}

/** Routing turned on for a document: its planning with request routes (an empty list counts). */
export function withRouting(planning: PlanningModel | undefined): PlanningModel | undefined {
  if (planning?.revision !== "p3-a1" && planning?.revision !== "p3-w1") return planning;
  return planning.requestRoutes ? planning : { ...planning, requestRoutes: [] };
}

/** Where a route is used: mixes, caller addresses, and simulation patches. Deleting a used route is refused. */
export function routeUsage(d: Pick<DiagramFile, "nodes" | "edges" | "simulations">, id: string): string[] {
  const out: string[] = [];
  for (const n of d.nodes)
    if ((n.props?.trafficMix as TrafficMix | undefined)?.entries.some((e) => e.routeId === id))
      out.push(n.label || n.id);
  for (const e of d.edges) if (e.props?.requestRouteId === id) out.push(e.label || e.id);
  for (const sim of d.simulations ?? []) {
    const patches = [
      ...Object.values(sim.setup?.props ?? {}),
      ...(sim.timeline ?? []).flatMap((s) => (s.action.do === "props" ? [s.action.props] : [])),
    ];
    if (patches.some((p) => (p.trafficMix as TrafficMix | undefined)?.entries.some((e) => e.routeId === id)))
      out.push(sim.title || sim.id);
  }
  return out;
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

/** A new rule matching `match`, sending to `targets`, with a router-scoped id that never repeats. */
export function addRule(table: RouteTable, match: RouteMatch, targets: string[]): { table: RouteTable; id: string } {
  const used = new Set(table.rules.map((r) => r.id));
  let n = table.rules.length + 1;
  while (used.has(`rule-${n}`)) n++;
  const id = `rule-${n}`;
  const rule: RouteRule = { id, match, targets: targets.map((edgeId) => ({ edgeId, weight: 1 })) };
  return { table: { ...table, rules: [...table.rules, rule] }, id };
}

export function updateRule(table: RouteTable, id: string, patch: Partial<Omit<RouteRule, "id">>): RouteTable {
  return { ...table, rules: table.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) };
}

export function removeRule(table: RouteTable, id: string): RouteTable {
  return { ...table, rules: table.rules.filter((r) => r.id !== id) };
}

/** Moves a rule up (-1) or down (+1); out of range is a no-op. Rule ids never change. */
export function moveRule(table: RouteTable, id: string, delta: -1 | 1): RouteTable {
  const from = table.rules.findIndex((r) => r.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= table.rules.length) return table;
  const rules = [...table.rules];
  [rules[from], rules[to]] = [rules[to], rules[from]];
  return { ...table, rules };
}

/** Sets one target's weight on an action, adding it (or removing it at undefined); keeps at least one positive. */
export function setTarget(action: RouteAction, edgeId: string, weight: number | undefined): RouteAction {
  const rest = action.targets.filter((t) => t.edgeId !== edgeId);
  const targets =
    weight === undefined
      ? rest
      : action.targets.some((t) => t.edgeId === edgeId)
        ? action.targets.map((t) => (t.edgeId === edgeId ? { ...t, weight } : t))
        : [...action.targets, { edgeId, weight }];
  return { ...action, targets };
}

/** Each rule's weights as percentages of its total ("90 / 10"). */
export function splitText(action: RouteAction): string {
  const total = action.targets.reduce((s, t) => s + t.weight, 0);
  if (action.targets.length === 1 || !total) return "100%";
  return action.targets.map((t) => Math.round((t.weight / total) * 100)).join(" / ");
}

const covers = (outer: PathMatch | undefined, inner: PathMatch | undefined): boolean => {
  if (!outer) return true;
  if (!inner) return false;
  if (outer.kind === "prefix") {
    const literal = inner.kind === "template" ? inner.value.split("{")[0] : inner.value;
    return literal.startsWith(outer.value);
  }
  return outer.kind === inner.kind && outer.value === inner.value;
};
const subset = (outer: readonly string[] | undefined, inner: readonly string[] | undefined) =>
  !outer || (!!inner && inner.every((v) => outer.includes(v)));
const within = (outer: Record<string, string> | undefined, inner: Record<string, string> | undefined, fold = false) =>
  Object.entries(outer ?? {}).every(([k, v]) =>
    Object.entries(inner ?? {}).some(
      ([k2, v2]) => (fold ? k.toLowerCase() === k2.toLowerCase() : k === k2) && v === v2,
    ),
  );

/**
 * Rules that can never match because an earlier one catches everything they would (by the documented grammar):
 * index of the shadowed rule → index of the rule that shadows it. Conservative: says so only when certain.
 */
export function shadowedRules(table: RouteTable): Map<number, number> {
  const out = new Map<number, number>();
  table.rules.forEach((rule, j) => {
    for (let i = 0; i < j; i++) {
      const a = table.rules[i].match,
        b = rule.match;
      if (
        subset(a.methods, b.methods) &&
        subset(
          a.hosts?.map((h) => h.toLowerCase()),
          b.hosts?.map((h) => h.toLowerCase()),
        ) &&
        covers(a.path, b.path) &&
        within(a.headers, b.headers, true) &&
        within(a.query, b.query)
      ) {
        out.set(j, i);
        return;
      }
    }
  });
  return out;
}

/** Shares scaled to add up to exactly 1 (the editor's explicit Normalize action). */
export function normalizeShares(mix: TrafficMix): TrafficMix {
  if (mix.mode !== "shares") return mix;
  const total = mix.entries.reduce((s, e) => s + e.share, 0);
  if (!(total > 0)) {
    const even = 1 / mix.entries.length;
    return {
      mode: "shares",
      entries: mix.entries.map((e, i, all) => ({
        ...e,
        share: i === all.length - 1 ? 1 - even * (all.length - 1) : even,
      })),
    };
  }
  const entries = mix.entries.map((e) => ({ ...e, share: e.share / total }));
  const last = entries.length - 1;
  entries[last].share = Math.max(0, 1 - entries.slice(0, last).reduce((s, e) => s + e.share, 0));
  return { mode: "shares", entries };
}

/** A mix switched between shares and rates at the same total, so the traffic doesn't change. */
export function switchMixMode(mix: TrafficMix, total: number): TrafficMix {
  if (mix.mode === "shares")
    return { mode: "rates", entries: mix.entries.map((e) => ({ routeId: e.routeId, ratePerSec: e.share * total })) };
  const sum = mix.entries.reduce((s, e) => s + e.ratePerSec, 0);
  return normalizeShares({
    mode: "shares",
    entries: mix.entries.map((e) => ({ routeId: e.routeId, share: sum > 0 ? e.ratePerSec / sum : 0 })),
  });
}

/** A mix with one more route: its share taken from nothing (the person splits it), or a rate of 1/s. */
export function addMixRow(mix: TrafficMix | undefined, routeId: string): TrafficMix {
  if (!mix) return { mode: "shares", entries: [{ routeId, share: 1 }] };
  if (mix.mode === "rates") return { mode: "rates", entries: [...mix.entries, { routeId, ratePerSec: 1 }] };
  // An equal share for the new row, the others scaled down to make room: the total stays 100%.
  const n = mix.entries.length + 1;
  return normalizeShares({
    mode: "shares",
    entries: [...mix.entries.map((e) => ({ ...e, share: (e.share * (n - 1)) / n })), { routeId, share: 1 / n }],
  });
}

export function removeMixRow(mix: TrafficMix, routeId: string): TrafficMix | undefined {
  const rest = mix.entries.filter((e) => e.routeId !== routeId);
  if (!rest.length) return undefined;
  return mix.mode === "shares"
    ? normalizeShares({ mode: "shares", entries: rest as { routeId: string; share: number }[] })
    : { mode: "rates", entries: rest as { routeId: string; ratePerSec: number }[] };
}

/** "POST /orders" for the address; methods offered by the editors, in order. */
export const METHODS: readonly HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE"];
export { addressText };

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

/** The document with a traffic mix on a source: one new route (GET /, to rename) at 100%. One undo step. */
export function withTrafficMix(d: DiagramFile, nodeId: string): DiagramFile {
  const next = structuredClone(d);
  next.planning = withRouting(next.planning);
  const added = addRoute(next.planning?.requestRoutes ?? [], { method: "GET", path: "/" });
  next.planning = { ...next.planning!, requestRoutes: added.routes };
  const node = next.nodes.find((n) => n.id === nodeId);
  if (node) node.props = { ...node.props, trafficMix: addMixRow(undefined, added.id) };
  return next;
}
