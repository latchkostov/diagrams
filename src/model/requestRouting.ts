import type { DiagramEdge, DiagramFile, DiagramNode, PlanningModel, SimRole } from "./types";
import type { Quota } from "./admission";
import { quotaSchema } from "./quotaSchema";
import { checkJsonSchema, type JsonSchema } from "./jsonSchema";
import { SIM_LIMITS } from "./simLimits";
import { flowEdges } from "./relations";

/**
 * Request routing R1 (docs/research/routing.md): optional request routes (addressed traffic classes), traffic mixes
 * on sources, ordered route tables on HTTP routers and an explicit caller address on Request connections. Every field
 * is optional: a diagram without them plays exactly as before. A document opts in with `planning.requestRoutes` (an
 * array, possibly empty) on revision p3-a1; older readers refuse that key, so they never play routed traffic wrong.
 */

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];
export type PathMatchKind = "exact" | "prefix" | "template";
export interface PathMatch {
  kind: PathMatchKind;
  value: string;
}
/** A concrete request: method, pathname (no query), optional host, headers and query. */
export interface RequestAddress {
  method: HttpMethod;
  path: string;
  host?: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}
export const ROUTE_MARKERS = ["circle", "square", "diamond", "triangle"] as const;
export type RouteMarker = (typeof ROUTE_MARKERS)[number];
/** A diagram-scoped traffic class. Its id joins mixes, colours, counters and traces; the address is what routers match. */
export interface RequestRoute {
  id: string;
  label?: string;
  address: RequestAddress;
  appearance?: { paletteSlot: number; marker: RouteMarker };
}
/** Fields AND together; methods and hosts OR within their list; header and query entries AND. Absent = any. */
export interface RouteMatch {
  methods?: HttpMethod[];
  path?: PathMatch;
  hosts?: string[];
  headers?: Record<string, string>;
  query?: Record<string, string>;
}
export interface RouteTarget {
  /** An ordinary outgoing flow of this router. */
  edgeId: string;
  /** Nonnegative integer; normalized among the action's eligible targets. */
  weight: number;
}
export interface RouteAction {
  targets: RouteTarget[];
  /** P3 token buckets charged with the router's own and shared budgets, atomically. */
  quotas?: Quota[];
}
export interface RouteRule extends RouteAction {
  /** Router-scoped, stable under reorder and rename. */
  id: string;
  label?: string;
  match: RouteMatch;
}
export interface RouteTable {
  /** First match wins, in this order. */
  rules: RouteRule[];
  /** Used only when no rule matches. Absent: rejected 404. */
  default?: RouteAction;
}
export type TrafficMix =
  | { mode: "shares"; entries: { routeId: string; share: number }[] }
  | { mode: "rates"; entries: { routeId: string; ratePerSec: number }[] };

/** Simulator bounds (not vendor limits). Validation errors name the field and the bound. */
export const ROUTING_LIMITS = {
  routes: 500,
  mixRows: 64,
  rules: 256,
  targets: 16,
  quotas: 8,
  text: 200,
  entries: 16,
  name: 64,
  value: 200,
  weight: 10_000,
  /** Across the whole document, so per-node caps can't multiply into an unbounded configuration. */
  totalRules: 4_096,
  totalMixRows: 4_096,
  shareEpsilon: 1e-9,
} as const;

/** The stencils whose profile routes HTTP by host and path (research § "Which stencils get a route table?"). */
export const ROUTE_TABLE_STENCILS: ReadonlySet<string> = new Set([
  "kong",
  "azure.api-management",
  "aws.api-gateway",
  "nginx",
  "envoy",
  "traefik",
  "haproxy",
  "istio",
  "aws.elb",
  "azure.app-gateway",
  "load-balancer",
  "azure.front-door",
  "cloudflare",
  "generic.cdn",
  "generic.adc",
  "f5.bigip",
  "netscaler.adc",
  "gcp.cloud-load-balancing",
]);

export const routeTableCapable = (stencil: string | undefined, role: SimRole): boolean =>
  role === "gateway" && !!stencil && ROUTE_TABLE_STENCILS.has(stencil);
export const trafficMixCapable = (role: SimRole): boolean => role === "source";

/** Routing is on for a p3-a1 document that declares its request routes (an empty list counts). */
export function routingEnabled(planning: PlanningModel | undefined): boolean {
  return planning?.revision === "p3-a1" && Array.isArray(planning.requestRoutes);
}

// ---------------------------------------------------------------- grammar

// eslint-disable-next-line no-control-regex -- control characters are exactly what a path or header refuses
const CONTROL = /[\u0000-\u001f\u007f]/u;
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;
const HOST = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,198}[A-Za-z0-9])?$/u;
const PARAM = /^\{[A-Za-z_][A-Za-z0-9_]{0,63}\}$/u;
const text = { type: "string", minLength: 1, maxLength: ROUTING_LIMITS.text };
const id = { type: "string", minLength: 1, maxLength: ROUTING_LIMITS.text };
const record = { type: "object", additionalProperties: { type: "string", maxLength: ROUTING_LIMITS.value } };
const methods = {
  type: "array",
  minItems: 1,
  maxItems: HTTP_METHODS.length,
  uniqueItems: true,
  items: { enum: [...HTTP_METHODS] },
};

export const requestAddressSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["method", "path"],
  properties: {
    method: { enum: [...HTTP_METHODS] },
    path: { ...text, pattern: "^/" },
    host: text,
    headers: record,
    query: record,
  },
};
export const requestRouteSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "address"],
  properties: {
    id,
    label: { type: "string", maxLength: ROUTING_LIMITS.text },
    address: requestAddressSchema,
    appearance: {
      type: "object",
      additionalProperties: false,
      required: ["paletteSlot", "marker"],
      properties: {
        paletteSlot: { type: "integer", minimum: 0, maximum: 6 },
        marker: { enum: [...ROUTE_MARKERS] },
      },
    },
  },
};
export const requestRoutesSchema: JsonSchema = {
  type: "array",
  maxItems: ROUTING_LIMITS.routes,
  items: requestRouteSchema,
};
export const routeMatchSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    methods,
    path: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "value"],
      properties: { kind: { enum: ["exact", "prefix", "template"] }, value: { ...text, pattern: "^/" } },
    },
    hosts: { type: "array", minItems: 1, maxItems: ROUTING_LIMITS.entries, items: text },
    headers: record,
    query: record,
  },
};
const action = {
  targets: {
    type: "array",
    minItems: 1,
    maxItems: ROUTING_LIMITS.targets,
    items: {
      type: "object",
      additionalProperties: false,
      required: ["edgeId", "weight"],
      properties: { edgeId: id, weight: { type: "integer", minimum: 0, maximum: ROUTING_LIMITS.weight } },
    },
  },
  quotas: { type: "array", maxItems: ROUTING_LIMITS.quotas, items: quotaSchema },
};
export const routeTableSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["rules"],
  properties: {
    rules: {
      type: "array",
      maxItems: ROUTING_LIMITS.rules,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "match", "targets"],
        properties: {
          id,
          label: { type: "string", maxLength: ROUTING_LIMITS.text },
          match: routeMatchSchema,
          ...action,
        },
      },
    },
    default: { type: "object", additionalProperties: false, required: ["targets"], properties: action },
  },
};
export const trafficMixSchema: JsonSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["mode", "entries"],
      properties: {
        mode: { const: "shares" },
        entries: {
          type: "array",
          minItems: 1,
          maxItems: ROUTING_LIMITS.mixRows,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["routeId", "share"],
            properties: { routeId: id, share: { type: "number", minimum: 0, maximum: 1 } },
          },
        },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["mode", "entries"],
      properties: {
        mode: { const: "rates" },
        entries: {
          type: "array",
          minItems: 1,
          maxItems: ROUTING_LIMITS.mixRows,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["routeId", "ratePerSec"],
            properties: {
              routeId: id,
              ratePerSec: { type: "number", minimum: 0, maximum: SIM_LIMITS.ratePerSec },
            },
          },
        },
      },
    },
  ],
};

/** A request path: starts with "/", no query or fragment, no whitespace or control characters. */
function checkPath(value: string, where: string, template: boolean): void {
  if (!value.startsWith("/") || /[\s?#]/u.test(value) || CONTROL.test(value))
    throw new Error(`${where}: a path starts with "/" and has no spaces, "?" or "#"`);
  const braces = /[{}]/u.test(value);
  if (!braces) return;
  if (!template) throw new Error(`${where}: a concrete path can't contain "{" or "}"`);
  for (const segment of value.split("/"))
    if (/[{}]/u.test(segment) && !PARAM.test(segment))
      throw new Error(`${where}: a template parameter is a whole segment, like /orders/{id}`);
}

function checkEntries(value: Record<string, string> | undefined, where: string, headers: boolean): void {
  if (!value) return;
  const names = Object.keys(value);
  if (names.length > ROUTING_LIMITS.entries) throw new Error(`${where}: at most ${ROUTING_LIMITS.entries} entries`);
  const seen = new Set<string>();
  for (const name of names) {
    if (!name || name.length > ROUTING_LIMITS.name || (headers ? !TOKEN.test(name) : CONTROL.test(name)))
      throw new Error(
        `${where}: "${name.slice(0, 64)}" isn't a valid name (at most ${ROUTING_LIMITS.name} characters)`,
      );
    const folded = headers ? name.toLowerCase() : name;
    if (seen.has(folded)) throw new Error(`${where}: "${name}" appears twice`);
    seen.add(folded);
    if (CONTROL.test(value[name])) throw new Error(`${where}.${name}: no control characters`);
  }
}

function checkHost(value: string, where: string): void {
  if (!HOST.test(value)) throw new Error(`${where}: a host name without a scheme or port, like api.example.com`);
}

export function checkAddress(address: RequestAddress, where: string): void {
  checkJsonSchema(address, requestAddressSchema, where);
  checkPath(address.path, `${where}.path`, false);
  if (address.host !== undefined) checkHost(address.host, `${where}.host`);
  checkEntries(address.headers, `${where}.headers`, true);
  checkEntries(address.query, `${where}.query`, false);
}

export function checkRouteMatch(match: RouteMatch, where: string): void {
  checkJsonSchema(match, routeMatchSchema, where);
  if (
    !match.methods &&
    !match.path &&
    !match.hosts &&
    !Object.keys(match.headers ?? {}).length &&
    !Object.keys(match.query ?? {}).length
  )
    throw new Error(`${where}: a rule needs at least one condition (use Default for everything else)`);
  if (match.path) checkPath(match.path.value, `${where}.path`, match.path.kind === "template");
  for (const host of match.hosts ?? []) checkHost(host, `${where}.hosts`);
  if (match.hosts && new Set(match.hosts.map((h) => h.toLowerCase())).size !== match.hosts.length)
    throw new Error(`${where}.hosts: a host appears twice`);
  checkEntries(match.headers, `${where}.headers`, true);
  checkEntries(match.query, `${where}.query`, false);
}

function checkAction(value: RouteAction, where: string): void {
  if (!value.targets.some((target) => target.weight > 0))
    throw new Error(`${where}.targets: at least one target needs a weight above 0`);
  if (new Set(value.targets.map((target) => target.edgeId)).size !== value.targets.length)
    throw new Error(`${where}.targets: a connection appears twice`);
  if (new Set((value.quotas ?? []).map((quota) => quota.id)).size !== (value.quotas ?? []).length)
    throw new Error(`${where}.quotas: quota ids must be unique`);
}

/** Shape and bounds of a node's route table, without references (checkRouting adds those). */
export function checkRouteTable(value: unknown, where = "routeTable"): void {
  checkJsonSchema(value, routeTableSchema, where);
  const table = value as RouteTable;
  const ids = new Set<string>();
  table.rules.forEach((rule, i) => {
    const at = `${where}.rules[${i}]`;
    if (ids.has(rule.id)) throw new Error(`${at}.id: rule ids must be unique in a table`);
    ids.add(rule.id);
    checkRouteMatch(rule.match, `${at}.match`);
    checkAction(rule, at);
  });
  if (table.default) checkAction(table.default, `${where}.default`);
}

/** Shape and bounds of a source's traffic mix, without references. */
export function checkTrafficMix(value: unknown, where = "trafficMix"): void {
  checkJsonSchema(value, trafficMixSchema, where);
  const mix = value as TrafficMix;
  const ids = mix.entries.map((entry) => entry.routeId);
  if (new Set(ids).size !== ids.length) throw new Error(`${where}.entries: a route appears twice`);
  if (mix.mode === "shares") {
    const sum = mix.entries.reduce((total, entry) => total + entry.share, 0);
    if (Math.abs(sum - 1) > ROUTING_LIMITS.shareEpsilon)
      throw new Error(`${where}: shares add up to ${Math.round(sum * 1e6) / 1e4}%, not 100% (use Normalize)`);
  } else {
    const sum = mix.entries.reduce((total, entry) => total + entry.ratePerSec, 0);
    if (sum > SIM_LIMITS.ratePerSec)
      throw new Error(`${where}: the rates add up to ${sum.toLocaleString("en-US")}, over the 10,000,000 limit`);
  }
}

// ---------------------------------------------------------------- document validation

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Routing settings on a node, edge or patch: what the opt-in gate looks for. */
export const ROUTING_NODE_KEYS = ["trafficMix", "routeTable"] as const;
export const ROUTING_EDGE_KEYS = ["requestRouteId", "requestFilter"] as const;

export const hasNodeRouting = (props: Record<string, unknown> | undefined) =>
  !!props && (props.trafficMix !== undefined || props.routeTable !== undefined);
export const hasEdgeRouting = (props: Record<string, unknown> | undefined) =>
  !!props && (props.requestRouteId !== undefined || props.requestFilter !== undefined);

/** The ordinary outgoing flows a route table may target, by router: dependencies, DLQ paths and shapes excluded. */
export function routeTargetEdges(
  diagram: Pick<DiagramFile, "nodes" | "edges">,
  roleOf: (stencil: string) => SimRole,
  isDlq: (edge: DiagramEdge, from: SimRole, target: DiagramNode, to: SimRole) => boolean,
): Map<string, Set<string>> {
  const nodes = new Map(diagram.nodes.map((n) => [n.id, n]));
  const out = new Map<string, Set<string>>();
  for (const edge of flowEdges(diagram.edges)) {
    const from = nodes.get(edge.from),
      to = nodes.get(edge.to);
    if (!from || !to) continue;
    if (isDlq(edge, roleOf(from.stencil), to, roleOf(to.stencil))) continue;
    let set = out.get(edge.from);
    if (!set) out.set(edge.from, (set = new Set()));
    set.add(edge.id);
  }
  return out;
}

export interface RoutingContext {
  roleOf: (stencil: string) => SimRole;
  isDlq: (edge: DiagramEdge, from: SimRole, target: DiagramNode, to: SimRole) => boolean;
}

/**
 * The one validation path for request routing, shared by file reads, editor transactions, clipboard pastes and
 * agent batches: the opt-in gate, every bound, and every reference (route ids, rule targets as ordinary outgoing
 * flows of their router, shared quotas). Saved simulation patches are checked the same way. Returns the problem in
 * words, naming the field and bound, or undefined.
 */
/** What request routing reads from a document (the editor passes its candidate without layout fields). */
export type RoutingDocument = Pick<DiagramFile, "planning" | "nodes" | "edges" | "simulations">;

export function routingProblem(diagram: RoutingDocument, context: RoutingContext): string | undefined {
  try {
    checkRouting(diagram, context);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function checkRouting(diagram: RoutingDocument, context: RoutingContext): void {
  const planning = diagram.planning;
  const enabled = routingEnabled(planning);
  const declared = planning?.requestRoutes;
  if (declared !== undefined && planning?.revision !== "p3-a1")
    throw new Error("planning.requestRoutes: request routing needs the current planning model (p3-a1)");
  const anyPatch = (diagram.simulations ?? []).some(
    (sim) =>
      Object.values(sim.setup?.props ?? {}).some((p) => hasNodeRouting(p)) ||
      (sim.timeline ?? []).some((step) => step.action.do === "props" && hasNodeRouting(step.action.props)),
  );
  const nodesRouted = diagram.nodes.some((n) => hasNodeRouting(n.props));
  const edgesRouted = diagram.edges.some((e) => hasEdgeRouting(e.props));
  if (!enabled) {
    if (nodesRouted || edgesRouted || anyPatch)
      throw new Error(
        "Request routing settings need the diagram's request routes (planning.requestRoutes) on the current planning model",
      );
    return;
  }
  checkJsonSchema(declared, requestRoutesSchema, "planning.requestRoutes");
  const routes = new Map<string, RequestRoute>();
  declared!.forEach((route, i) => {
    if (routes.has(route.id)) throw new Error(`planning.requestRoutes[${i}].id: "${route.id}" appears twice`);
    checkAddress(route.address, `planning.requestRoutes[${i}].address`);
    routes.set(route.id, route);
  });
  const shared = new Map((planning?.sharedQuotas ?? []).map((quota) => [quota.id, quota]));
  const targets = routeTargetEdges(diagram, context.roleOf, context.isDlq);
  const budget = { rules: 0, rows: 0 };
  const checkNode = (nodeId: string, stencil: string | undefined, props: Record<string, unknown>, where: string) => {
    if (props.trafficMix !== undefined) {
      checkTrafficMix(props.trafficMix, `${where}.trafficMix`);
      const mix = props.trafficMix as TrafficMix;
      budget.rows += mix.entries.length;
      for (const entry of mix.entries)
        if (!routes.has(entry.routeId))
          throw new Error(`${where}.trafficMix: route "${entry.routeId}" isn't one of the diagram's request routes`);
    }
    if (props.routeTable !== undefined) {
      checkRouteTable(props.routeTable, `${where}.routeTable`);
      const table = props.routeTable as RouteTable;
      budget.rules += table.rules.length;
      const allowed = targets.get(nodeId) ?? new Set<string>();
      const actions: [RouteAction, string][] = [
        ...table.rules.map((rule, i): [RouteAction, string] => [rule, `${where}.routeTable.rules[${i}]`]),
        ...(table.default ? [[table.default, `${where}.routeTable.default`] as [RouteAction, string]] : []),
      ];
      for (const [act, at] of actions) {
        for (const target of act.targets)
          if (!allowed.has(target.edgeId))
            throw new Error(
              `${at}.targets: "${target.edgeId}" isn't an ordinary connection out of ${stencil ? `"${nodeId}"` : "this node"}`,
            );
        for (const quota of act.quotas ?? [])
          if (quota.sharedGroup !== undefined) {
            const definition = shared.get(quota.sharedGroup);
            if (!definition || !sameQuota(definition, quota))
              throw new Error(
                `${at}.quotas: shared quota "${quota.sharedGroup}" must match a definition in planning.sharedQuotas`,
              );
          }
      }
    }
  };
  for (const node of diagram.nodes) if (node.props) checkNode(node.id, node.stencil, node.props, `Node "${node.id}"`);
  const byId = new Map(diagram.nodes.map((n) => [n.id, n]));
  for (const sim of diagram.simulations ?? []) {
    for (const [nodeId, patch] of Object.entries(sim.setup?.props ?? {}))
      if (hasNodeRouting(patch))
        checkNode(nodeId, byId.get(nodeId)?.stencil, patch, `Simulation "${sim.id}" setup "${nodeId}"`);
    for (const step of sim.timeline ?? [])
      if (step.action.do === "props" && hasNodeRouting(step.action.props))
        checkNode(
          step.action.node,
          byId.get(step.action.node)?.stencil,
          step.action.props,
          `Simulation "${sim.id}" timeline "${step.action.node}"`,
        );
    // A profile's total is spread over the mix's proportions: an all-zero rates mix has none.
    for (const profile of sim.traffic) {
      const node = byId.get(profile.node);
      const mix = (sim.setup?.props?.[profile.node]?.trafficMix ?? node?.props?.trafficMix) as TrafficMix | undefined;
      if (mix?.mode === "rates" && !mix.entries.some((entry) => entry.ratePerSec > 0))
        throw new Error(
          `Simulation "${sim.id}" traffic "${profile.id}": the traffic mix at "${profile.node}" has no rate above 0 to split it by`,
        );
    }
  }
  if (budget.rules > ROUTING_LIMITS.totalRules)
    throw new Error(`The diagram has ${budget.rules} route rules; the limit is ${ROUTING_LIMITS.totalRules}`);
  if (budget.rows > ROUTING_LIMITS.totalMixRows)
    throw new Error(`The diagram has ${budget.rows} traffic mix rows; the limit is ${ROUTING_LIMITS.totalMixRows}`);
  for (const edge of diagram.edges) {
    const props = edge.props;
    if (!props || !hasEdgeRouting(props)) continue;
    const where = `Connection "${edge.id}"`;
    if (props.requestRouteId !== undefined) {
      checkJsonSchema(props.requestRouteId, id, `${where}.requestRouteId`);
      if (!routes.has(props.requestRouteId as string))
        throw new Error(
          `${where}.requestRouteId: route "${String(props.requestRouteId)}" isn't one of the diagram's request routes`,
        );
    }
    if (props.requestFilter !== undefined) {
      if (!isObject(props.requestFilter)) throw new Error(`${where}.requestFilter: expected an object`);
      checkRouteMatch(props.requestFilter as RouteMatch, `${where}.requestFilter`);
    }
  }
}

const sameQuota = (a: Quota, b: Quota) =>
  a.unit === b.unit &&
  a.amount === b.amount &&
  a.windowMs === b.windowMs &&
  (a.burst ?? a.amount) === (b.burst ?? b.amount) &&
  a.algorithm === b.algorithm;

// ---------------------------------------------------------------- appearance

/** Okabe–Ito colour-universal palette: distinct under common colour-vision deficiencies. */
export const ROUTE_PALETTE = ["#E69F00", "#56B4E9", "#009E73", "#F0E442", "#0072B2", "#D55E00", "#CC79A7"] as const;
/** Every colour once per marker before any pair repeats: 28 distinct pairs. */
export const ROUTE_PAIRS = ROUTE_PALETTE.length * ROUTE_MARKERS.length;

export interface RouteLook {
  color: string;
  marker: RouteMarker;
}
const pair = (index: number): { paletteSlot: number; marker: RouteMarker } => ({
  paletteSlot: index % ROUTE_PALETTE.length,
  marker: ROUTE_MARKERS[Math.floor(index / ROUTE_PALETTE.length) % ROUTE_MARKERS.length],
});
function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return h >>> 0;
}
/** A route's saved colour and marker, or a deterministic one from its id when none was saved. */
export function routeLook(route: Pick<RequestRoute, "id" | "appearance">): RouteLook {
  const a = route.appearance ?? pair(hash(route.id) % ROUTE_PAIRS);
  return { color: ROUTE_PALETTE[a.paletteSlot] ?? ROUTE_PALETTE[0], marker: a.marker };
}
/** The first colour/marker pair no route uses yet, in stable order (after all 28, they repeat in order). */
export function nextAppearance(routes: readonly RequestRoute[]): { paletteSlot: number; marker: RouteMarker } {
  const used = new Set(
    routes.map((r) => {
      const a = r.appearance ?? pair(hash(r.id) % ROUTE_PAIRS);
      return a.paletteSlot + ROUTE_PALETTE.length * ROUTE_MARKERS.indexOf(a.marker);
    }),
  );
  for (let i = 0; i < ROUTE_PAIRS; i++) if (!used.has(i)) return pair(i);
  return pair(routes.length % ROUTE_PAIRS);
}

/** "POST /orders" (method and path); a label, when given, names it in lists. */
export const addressText = (address: Pick<RequestAddress, "method" | "path">) => `${address.method} ${address.path}`;
export const routeName = (route: RequestRoute) => route.label?.trim() || addressText(route.address);

/** The compact text of a match: "POST /orders", "GET /api/*", "Any /search". */
export function matchText(match: RouteMatch): string {
  const methods = match.methods?.join("|") ?? "*";
  const path = !match.path ? "*" : match.path.kind === "prefix" ? `${match.path.value}*` : match.path.value;
  const host = match.hosts?.length ? ` @${match.hosts.join("|")}` : "";
  const extra = Object.keys(match.headers ?? {}).length + Object.keys(match.query ?? {}).length;
  return `${methods} ${path}${host}${extra ? ` +${extra}` : ""}`;
}

/** A rates-mode mix with every row × factor (the Inputs panel's entry rate, Traffic ×): one scaling, all rows. */
export function scaleMix(mix: TrafficMix, factor: number): TrafficMix {
  if (mix.mode !== "rates") return mix;
  const f = Number.isFinite(factor) ? Math.max(0, factor) : 1;
  return {
    mode: "rates",
    entries: mix.entries.map((e) => ({ ...e, ratePerSec: Math.min(SIM_LIMITS.ratePerSec, e.ratePerSec * f) })),
  };
}
