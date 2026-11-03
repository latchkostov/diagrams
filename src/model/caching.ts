import { baseStencilId } from "../stencils/vendorParents";
import type { DiagramFile, SimRole } from "./types";
import { revisionAtLeast } from "./revisions";
import { checkJsonSchema, type JsonSchema } from "./jsonSchema";
import { checkRouteMatch, routeMatchSchema, ROUTING_LIMITS, type RouteMatch } from "./requestRouting";

export type Popularity = "even" | "gentle" | "typical" | "steep";
export interface CachePolicy {
  ttlMs?: number;
  noStore?: true;
  keys?: number;
  popularity?: Popularity;
}
export interface CacheRule {
  id: string;
  label?: string;
  match: RouteMatch & { types?: string[] };
  policy: CachePolicy;
}
export interface CacheTable {
  rules: CacheRule[];
  default?: CachePolicy;
}
export const CACHE_LIMITS = { rules: 32, totalRules: 256, tracked: 256, totalTracked: 4096 } as const;
const capable = new Set([
  "generic.cdn",
  "cloudflare",
  "azure.front-door",
  "redis.cache",
  "azure.redis",
  "generic.cache",
]);
export const cacheCapable = (stencil: string | undefined, role: SimRole): boolean =>
  (role === "gateway" || role === "store") && !!stencil && capable.has(baseStencilId(stencil));
export const cacheEnabled = (
  planning: DiagramFile["planning"],
  stencil: string,
  role: SimRole,
  value: unknown,
): value is CacheTable => revisionAtLeast(planning?.revision, "p3-w3") && cacheCapable(stencil, role) && !!value;

const policySchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    ttlMs: { type: "number", minimum: 100, maximum: 86_400_000 },
    noStore: { enum: [true] },
    keys: { type: "integer", minimum: 1, maximum: 1_000_000 },
    popularity: { enum: ["even", "gentle", "typical", "steep"] },
  },
};
export const cacheSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["rules"],
  properties: {
    rules: {
      type: "array",
      maxItems: CACHE_LIMITS.rules,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "match", "policy"],
        properties: {
          id: { type: "string", minLength: 1, maxLength: ROUTING_LIMITS.text },
          label: { type: "string", maxLength: ROUTING_LIMITS.text },
          match: {
            ...routeMatchSchema,
            properties: {
              ...(routeMatchSchema.properties as Record<string, JsonSchema>),
              types: {
                type: "array",
                minItems: 1,
                maxItems: ROUTING_LIMITS.entries,
                uniqueItems: true,
                items: { type: "string", minLength: 1, maxLength: ROUTING_LIMITS.text, pattern: "^[^*]+\\*?$|^\\*$" },
              },
            },
          },
          policy: policySchema,
        },
      },
    },
    default: policySchema,
  },
};
export function checkCache(value: unknown, where = "cache"): void {
  checkJsonSchema(value, cacheSchema, where);
  const table = value as CacheTable;
  const ids = new Set<string>();
  for (const [i, rule] of table.rules.entries()) {
    if (ids.has(rule.id)) throw new Error(`${where}: rule ids must be unique`);
    ids.add(rule.id);
    const { types, ...address } = rule.match;
    if (Object.keys(address).length || !types) checkRouteMatch(address, `${where}.rules[${i}].match`);
  }
  for (const policy of [...table.rules.map((r) => r.policy), ...(table.default ? [table.default] : [])])
    if ((policy.ttlMs === undefined) === (policy.noStore === undefined))
      throw new Error(`${where}: exactly one of ttlMs and noStore is required`);
}
export function cacheProblem(value: unknown): string | undefined {
  try {
    checkCache(value);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Includes dormant saved patches: a later run must never start before its runtime is ready. */
export function hasCacheRules(d: Pick<DiagramFile, "nodes" | "simulations">): boolean {
  return (
    d.nodes.some((n) => n.props?.cache !== undefined) ||
    (d.simulations ?? []).some(
      (s) =>
        Object.values(s.setup?.props ?? {}).some((p) => p.cache !== undefined) ||
        (s.timeline ?? []).some((e) => e.action.do === "props" && e.action.props.cache !== undefined),
    )
  );
}
