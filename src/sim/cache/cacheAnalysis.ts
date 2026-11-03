import { cacheEnabled, checkCache, type CacheTable, type CachePolicy } from "../../model/caching";
import type { DiagramFile } from "../../model/types";
import { stencilRole } from "../../stencils/roles";
import { compileMatch, matchesRequest, type CompiledRoute } from "../routeMatching";
import { acceptsType } from "../topology";

/** Match once per traffic class in analysis, or per request in playback. */
export function analysisCache(d: DiagramFile, node: DiagramFile["nodes"][number]) {
  if (!cacheEnabled(d.planning, node.stencil, stencilRole(node.stencil), node.props?.cache)) return;
  checkCache(node.props.cache);
  const table = node.props.cache as CacheTable;
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
