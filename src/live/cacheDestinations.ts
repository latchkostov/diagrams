import type { DiagramFile } from "../model/types";
import type { CacheTable } from "../model/caching";
import {
  chooseAction,
  compileFilter,
  compileMatch,
  compileRoutes,
  compileTable,
  matchesRequest,
} from "../sim/routeMatching";
import { cacheOriginIndex } from "./cacheOrigins";

/** Configured destinations, not delivery counts. Compile only when the document or rules change. */
export function cacheDestinations(
  diagram: DiagramFile,
  id: string,
  index: ReturnType<typeof cacheOriginIndex>,
  table?: CacheTable,
  routeTable?: unknown,
) {
  const outgoing = diagram.edges.filter(
    (e) => e.from === id && e.kind === "sync" && (!e.relation || e.relation === "flow") && !e.props?.dlq,
  );
  const names = (ids: Iterable<string>) => [...new Set([...ids].map((to) => index.labels.get(to) ?? to))];
  const routes = compileRoutes(diagram.planning);
  const routing = routes && compileTable(routeTable);
  const filters = new Map(outgoing.map((e) => [e.id, compileFilter(e.props?.requestFilter)]));
  const edgesById = new Map(outgoing.map((e) => [e.id, e]));
  const rules = new Map<string, string[]>();
  for (const rule of [...(table?.rules ?? []), ...(table?.default ? [{ id: "", match: {} }] : [])]) {
    const match = compileMatch(rule.match);
    const addressed = Object.keys(rule.match).some((key) => key !== "types");
    const candidates = routes ? [...routes.values()].filter((r) => matchesRequest(match, r)) : [];
    // Type-only rules and Default can also see unaddressed requests.
    const destinations = new Set<string>();
    for (const route of [...candidates, ...(!addressed ? [undefined] : [])]) {
      const choice = routing ? chooseAction(routing, route, true) : undefined;
      const targets = choice && "action" in choice ? choice.action.targets : undefined;
      const eligible = targets
        ? targets.filter((t) => t.weight > 0).flatMap((t) => edgesById.get(t.edgeId) ?? [])
        : choice
          ? []
          : outgoing;
      for (const edge of eligible) {
        const filter = filters.get(edge.id);
        if (filter && !matchesRequest(filter, route)) continue;
        destinations.add(edge.to);
      }
    }
    // Without addressed routing, ordinary flows remain the only configured destinations.
    rules.set(rule.id, names(!routes ? outgoing.map((e) => e.to) : destinations));
  }
  const all = names(outgoing.map((e) => e.to));
  return { rules, singleOrigin: all.length === 1 ? all[0] : undefined };
}
