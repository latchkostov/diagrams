import type { Quota } from "../model/admission";
import type { PlanningModel } from "../model/types";
import {
  checkRouteMatch,
  checkRouteTable,
  checkTrafficMix,
  routingEnabled,
  type HttpMethod,
  type PathMatchKind,
  type RouteMarker,
  type RouteMatch,
  type RouteTable,
  type TrafficMix,
} from "../model/requestRouting";
import { addressText, routeLook } from "../model/routingAppearance";

/**
 * Request routing's compiled forms, shared by playback (engine.ts) and configured analysis (capacity.ts): one
 * compilation per configuration change, then matching that costs O(rules × bounded field length) per decision and
 * draws one seeded number per weighted choice. Nothing here allocates per message or reads a clock.
 */

/** Work counters for the bounds tests: compilations and predicate evaluations (docs/QUALITY.md, count the work). */
export const routingCounters = { compiles: 0, predicates: 0, actionBuckets: 0 };

/** A request route ready to match: its address normalized once (lower-case host and header names, split path). */
export interface CompiledRoute {
  id: string;
  /** "POST /orders". */
  text: string;
  color: string;
  marker: RouteMarker;
  method: HttpMethod;
  path: string;
  segments: string[];
  host?: string;
  headers?: Map<string, string>;
  query?: Map<string, string>;
}

/** The document's request routes by id, or undefined when routing is off (every routing setting is then dormant). */
export function compileRoutes(planning: PlanningModel | undefined): Map<string, CompiledRoute> | undefined {
  if (!routingEnabled(planning)) return undefined;
  const routes = new Map<string, CompiledRoute>();
  for (const route of planning!.requestRoutes ?? []) {
    const { address } = route;
    const look = routeLook(route);
    routes.set(route.id, {
      id: route.id,
      text: addressText(address),
      color: look.color,
      marker: look.marker,
      method: address.method,
      path: address.path,
      segments: address.path.split("/"),
      ...(address.host === undefined ? {} : { host: address.host.toLowerCase() }),
      ...(address.headers
        ? { headers: new Map(Object.entries(address.headers).map(([k, v]) => [k.toLowerCase(), v])) }
        : {}),
      ...(address.query ? { query: new Map(Object.entries(address.query)) } : {}),
    });
  }
  return routes;
}

export interface CompiledMatch {
  methods?: HttpMethod[];
  kind?: PathMatchKind;
  value?: string;
  /** Template segments; null is a parameter (one nonempty segment). */
  segments?: (string | null)[];
  hosts?: string[];
  headers?: [string, string][];
  query?: [string, string][];
}

export function compileMatch(match: RouteMatch): CompiledMatch {
  return {
    ...(match.methods ? { methods: [...match.methods] } : {}),
    ...(match.path
      ? {
          kind: match.path.kind,
          value: match.path.value,
          ...(match.path.kind === "template"
            ? { segments: match.path.value.split("/").map((s) => (s.startsWith("{") ? null : s)) }
            : {}),
        }
      : {}),
    ...(match.hosts ? { hosts: match.hosts.map((h) => h.toLowerCase()) } : {}),
    ...(match.headers ? { headers: Object.entries(match.headers).map(([k, v]) => [k.toLowerCase(), v]) } : {}),
    ...(match.query ? { query: Object.entries(match.query) } : {}),
  };
}

/**
 * Whether a request matches: methods and hosts OR within their list; every field ANDs. Paths are case-sensitive:
 * exact equality, a literal prefix (`/api` also matches `/apian`), or a template whose parameters take one nonempty
 * segment each, with no backtracking. Hosts compare case-insensitively; header names too, their values exactly.
 * Unaddressed traffic matches nothing. One call is one predicate evaluation.
 */
export function matchesRequest(m: CompiledMatch, r: CompiledRoute | undefined): boolean {
  routingCounters.predicates++;
  if (!r) return false;
  if (m.methods && !m.methods.includes(r.method)) return false;
  if (m.kind !== undefined) {
    const value = m.value!;
    if (m.kind === "exact") {
      if (r.path !== value) return false;
    } else if (m.kind === "prefix") {
      if (!r.path.startsWith(value)) return false;
    } else {
      const want = m.segments!;
      if (want.length !== r.segments.length) return false;
      for (let i = 0; i < want.length; i++) {
        const segment = want[i];
        if (segment === null ? r.segments[i] === "" : segment !== r.segments[i]) return false;
      }
    }
  }
  if (m.hosts && (r.host === undefined || !m.hosts.includes(r.host))) return false;
  if (m.headers) for (const [name, value] of m.headers) if (r.headers?.get(name) !== value) return false;
  if (m.query) for (const [name, value] of m.query) if (r.query?.get(name) !== value) return false;
  return true;
}

export interface CompiledAction {
  /** The selection stream's key: the rule id, or "" for Default (a rule id is never empty). */
  key: string;
  targets: { edgeId: string; weight: number }[];
  quotas: Quota[];
}
export interface CompiledTable {
  rules: { id: string; match: CompiledMatch; action: CompiledAction }[];
  fallback?: CompiledAction;
}

/** A valid table compiled, or undefined for a malformed one (refused by validation; never played). */
export function compileTable(table: unknown): CompiledTable | undefined {
  try {
    checkRouteTable(table);
  } catch {
    return undefined;
  }
  routingCounters.compiles++;
  const t = table as RouteTable;
  return {
    rules: t.rules.map((rule) => ({
      id: rule.id,
      match: compileMatch(rule.match),
      action: { key: rule.id, targets: rule.targets.map((x) => ({ ...x })), quotas: rule.quotas ?? [] },
    })),
    ...(t.default
      ? {
          fallback: {
            key: "",
            targets: t.default.targets.map((x) => ({ ...x })),
            quotas: t.default.quotas ?? [],
          },
        }
      : {}),
  };
}

/** A connection's request filter compiled, or undefined when it has none (or a malformed one, refused on read). */
export function compileFilter(filter: unknown): CompiledMatch | undefined {
  if (filter === undefined) return undefined;
  try {
    checkRouteMatch(filter as RouteMatch, "requestFilter");
  } catch {
    return undefined;
  }
  return compileMatch(filter as RouteMatch);
}

export type RouteChoice =
  | { action: CompiledAction; rule: string }
  | { reject: "route-not-found" }
  /** Unaddressed async traffic: the table invents no HTTP metadata, so today's routing applies. */
  | { legacy: true };

/**
 * First match wins, in table order, independent of outgoing edge order; Default only when no rule matches. A
 * request without an address can only use Default (rejected 404 without one). Async traffic without an address
 * isn't HTTP: legacy routing. At most one predicate evaluation per rule.
 */
export function chooseAction(table: CompiledTable, route: CompiledRoute | undefined, sync: boolean): RouteChoice {
  if (route)
    for (const rule of table.rules)
      if (matchesRequest(rule.match, route)) return { action: rule.action, rule: rule.id };
  if (!route && !sync) return { legacy: true };
  return table.fallback ? { action: table.fallback, rule: "" } : { reject: "route-not-found" };
}

/** The seed of one router action's selection stream: run seed + router id + rule key, so streams never interact. */
export function streamSeed(seed: number, node: string, key: string): number {
  let h = (2166136261 ^ seed) >>> 0;
  const text = `${node}\u0000${key}`;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** One Mulberry32 draw from an explicit state (so the state checkpoints as a number). */
export function drawStream(state: number): { value: number; state: number } {
  const next = (state + 0x6d2b79f5) >>> 0;
  let value = Math.imul(next ^ (next >>> 15), next | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return { value: ((value ^ (value >>> 14)) >>> 0) / 4294967296, state: next };
}

/**
 * Picks one of `weights` (positive entries only) with one draw `u` in [0, 1): the first whose running sum passes
 * u × total. Scaling every weight by the same factor picks the same index for the same draw.
 */
export function pickWeighted(weights: readonly number[], u: number): number {
  let total = 0;
  for (const w of weights) total += w;
  const x = u * total;
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    if (!(weights[i] > 0)) continue;
    sum += weights[i];
    if (x < sum) return i;
  }
  for (let i = weights.length - 1; i >= 0; i--) if (weights[i] > 0) return i;
  return -1;
}

export interface CompiledMix {
  mode: TrafficMix["mode"];
  routes: CompiledRoute[];
  /** Shares (0..1, summing to 1) or real rates per second, in mix order. */
  values: number[];
  /** Each row's fraction of the source's total: shares, or rates ÷ their sum (all 0 when the sum is 0). */
  proportions: number[];
}

/** A source's mix compiled against the document's routes, or undefined when it has none or it's malformed. */
export function compileMix(mix: unknown, routes: Map<string, CompiledRoute> | undefined): CompiledMix | undefined {
  if (mix === undefined || !routes) return undefined;
  try {
    checkTrafficMix(mix);
  } catch {
    return undefined;
  }
  const m = mix as TrafficMix;
  const rows = m.mode === "shares" ? m.entries.map((e) => e.share) : m.entries.map((e) => e.ratePerSec);
  const resolved: CompiledRoute[] = [];
  for (const entry of m.entries) {
    const route = routes.get(entry.routeId);
    if (!route) return undefined;
    resolved.push(route);
  }
  const total = rows.reduce((sum, v) => sum + v, 0);
  return {
    mode: m.mode,
    routes: resolved,
    values: rows,
    proportions: m.mode === "shares" ? rows : rows.map((v) => (total > 0 ? v / total : 0)),
  };
}

/**
 * The weighted-deficit choice for a fixed total (a burst, a profile, a manual injection): every row earns its
 * proportion, the row with the most credit goes next and pays one. Deterministic, no randomness, and each row's
 * count stays within one message of its proportion of the total at every prefix.
 */
export function nextByDeficit(proportions: readonly number[], deficit: number[]): number {
  let best = -1;
  for (let i = 0; i < proportions.length; i++) {
    deficit[i] += proportions[i];
    if (proportions[i] > 0 && (best < 0 || deficit[i] > deficit[best] + 1e-12)) best = i;
  }
  if (best >= 0) deficit[best] -= 1;
  return best;
}
