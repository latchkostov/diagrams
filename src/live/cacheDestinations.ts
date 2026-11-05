import type { DiagramFile } from "../model/types";
import type { CacheTable } from "../model/caching";
import { chooseAction, compileFilter, compileRoutes, compileTable, matchesRequest } from "../sim/routeMatching";
import { requireCacheRuntime } from "../sim/cache/cacheBridge";
import { acceptsType } from "../sim/topology";
import { cacheOriginIndex } from "./cacheOrigins";
import { cacheAsideOrigins } from "../model/cacheAside";

/** Configured destinations, not delivery counts. Compile only when the document or rules change. */
export function cacheDestinations(
  diagram: DiagramFile,
  id: string,
  index: ReturnType<typeof cacheOriginIndex>,
  table?: CacheTable,
  routeTable?: unknown,
) {
  const outgoing = [
    ...diagram.edges.filter(
      (e) => e.from === id && e.kind === "sync" && (!e.relation || e.relation === "flow") && !e.props?.dlq,
    ),
    ...cacheAsideOrigins(diagram, id),
  ];
  const names = (ids: Iterable<string>) => [...new Set([...ids].map((to) => index.labels.get(to) ?? to))];
  const routes = compileRoutes(diagram.planning);
  const routing = routes && compileTable(routeTable);
  const filters = new Map(outgoing.map((e) => [e.id, compileFilter(e.props?.requestFilter)]));
  const edgesById = new Map(outgoing.map((e) => [e.id, e]));
  const destinations = new Map<string, Set<string>>();
  if (table) {
    const runtime = requireCacheRuntime();
    // Only use the runtime's first-match selection. No-store policies avoid item tables;
    // a zero-size, non-cacheable lookup changes no counts and draws no randomness.
    const cache = runtime.compile(
      {
        rules: table.rules.map((rule) => ({ ...rule, policy: { noStore: true } })),
        ...(table.default ? { default: { noStore: true } } : {}),
      },
      id,
      0,
      1,
      { value: 0 },
    );
    for (const rule of cache.rules) destinations.set(rule.id, new Set());
    // Exact types and trailing-* predicates partition the type space at their literal
    // stems. Sample each stem and its remaining suffix class, including other types.
    const stems = new Set(
      [
        "",
        ...table.rules.flatMap((r) => r.match.types ?? []),
        ...outgoing.flatMap((e) => (e.props?.filter as string[] | undefined) ?? []),
      ].map((pattern) => pattern.replace(/\*$/, "")),
    );
    const types = new Set(stems);
    for (const stem of stems) {
      let other = `${stem}\0`;
      while ([...stems].some((s) => s.startsWith(other))) other += "\0";
      types.add(other);
    }
    for (const route of [...(routes?.values() ?? []), undefined]) {
      const choice = routing ? chooseAction(routing, route, true) : undefined;
      const targets = choice && "action" in choice ? choice.action.targets : undefined;
      const eligible = targets
        ? targets.filter((t) => t.weight > 0).flatMap((t) => edgesById.get(t.edgeId) ?? [])
        : choice
          ? []
          : outgoing;
      for (const type of types) {
        const rule = runtime.lookup(cache, type, route, false, 0, 0).rule;
        if (!rule) continue;
        for (const edge of eligible) {
          const filter = filters.get(edge.id);
          if (!acceptsType(edge.props?.filter, type) || (filter && !matchesRequest(filter, route))) continue;
          destinations.get(rule.id)!.add(edge.to);
        }
      }
    }
  }
  const rules = new Map([...destinations].map(([rule, ids]) => [rule, names(ids)]));
  const all = names(outgoing.map((e) => e.to));
  return { rules, singleOrigin: all.length === 1 ? all[0] : undefined };
}
