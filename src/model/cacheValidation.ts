import { cacheCapable, checkCache, CACHE_LIMITS, type CacheTable } from "./caching";
import type { RoutingDocument } from "./requestRouting";
import { stencilRole } from "../stencils/roles";

/** Files, transactions, paste and saved patches share this path; old revisions preserve dormant rules. */
export function validateCacheDocument(d: RoutingDocument): string | undefined {
  try {
    const nodes = new Map(d.nodes.map((n) => [n.id, n]));
    const check = (id: string, props: Record<string, unknown> | undefined): number => {
      if (props?.cache === undefined) return 0;
      const node = nodes.get(id);
      if (!node || !cacheCapable(node.stencil, stencilRole(node.stencil)))
        throw new Error(`${id}.cache: this stencil cannot cache`);
      checkCache(props.cache, `${id}.cache`);
      const table = props.cache as CacheTable;
      return table.rules.length + (table.default ? 1 : 0);
    };
    const base = new Map(d.nodes.map((n) => [n.id, check(n.id, n.props)]));
    const limit = (sizes: Map<string, number>) => {
      if ([...sizes.values()].reduce((a, b) => a + b, 0) > CACHE_LIMITS.totalRules)
        throw new Error(`cache: at most ${CACHE_LIMITS.totalRules} rules per document`);
    };
    limit(base);
    for (const sim of d.simulations ?? []) {
      const sizes = new Map(base);
      for (const [id, props] of Object.entries(sim.setup?.props ?? {}))
        if (props.cache !== undefined) sizes.set(id, check(id, props));
      limit(sizes);
      for (const step of [...(sim.timeline ?? [])].sort((a, b) => a.atMs - b.atMs)) {
        if (step.action.do !== "props" || step.action.props.cache === undefined) continue;
        sizes.set(step.action.node, check(step.action.node, step.action.props));
        limit(sizes);
      }
    }
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
