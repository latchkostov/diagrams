import { cacheEnabled, checkCache, type CacheTable, type CachePolicy } from "../../model/caching";
import type { DiagramFile, Simulation } from "../../model/types";
import { stencilRole } from "../../stencils/roles";
import { compileMatch, matchesRequest, type CompiledRoute } from "../routeMatching";
import { acceptsType } from "../topology";

/** Match once per traffic class in analysis, or per request in playback. */
export function effectiveCacheTable(d: DiagramFile, node: DiagramFile["nodes"][number], simulation?: Simulation) {
  const props = { ...node.props, ...simulation?.setup?.props?.[node.id] };
  if (!cacheEnabled(d.planning, node.stencil, stencilRole(node.stencil), props.cache)) return;
  checkCache(props.cache);
  return props.cache as CacheTable;
}

export function analysisCache(d: DiagramFile, node: DiagramFile["nodes"][number], simulation?: Simulation) {
  const table = effectiveCacheTable(d, node, simulation);
  if (!table) return;
  return compileCacheMatcher(table);
}

/** One effective configuration for demand matching and the waiting graph, including saved setup. */
export function compileCacheConfiguration(d: DiagramFile, simulation?: Simulation) {
  const tables = new Map<string, CacheTable>();
  const matchers = new Map<string, ReturnType<typeof compileCacheMatcher>>();
  for (const node of d.nodes) {
    const table = effectiveCacheTable(d, node, simulation);
    if (!table) continue;
    tables.set(node.id, table);
    matchers.set(node.id, compileCacheMatcher(table));
  }
  return { tables, matchers };
}

function compileCacheMatcher(table: CacheTable) {
  const rules = table.rules.map((r) => {
    const { types, ...address } = r.match;
    return {
      id: r.id,
      policy: r.policy,
      types,
      address: Object.keys(address).length > 0,
      match: compileMatch(address),
    };
  });
  return (
    type: string,
    route: CompiledRoute | undefined,
    sync: boolean,
  ): { id: string; policy: CachePolicy } | undefined => {
    if (!sync || (route && route.method !== "GET" && route.method !== "HEAD")) return;
    const rule = rules.find((r) => (!r.address || matchesRequest(r.match, route)) && acceptsType(r.types, type));
    return rule ?? (table.default ? { id: "", policy: table.default } : undefined);
  };
}
