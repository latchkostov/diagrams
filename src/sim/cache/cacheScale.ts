import type { DiagramFile, Simulation } from "../../model/types";
import { cacheEnabled } from "../../model/caching";
import { stencilRole } from "../../stencils/roles";
import { popularityTable } from "./popularity";

export type CacheScaleRates = Record<string, Record<string, { rate: number }>>;

/** Authoring needs peak demand and must not depend on the lazy playback runtime. */
export function cacheScale(
  diagram: DiagramFile,
  simulation: Simulation,
  scale: number,
  rates: CacheScaleRates,
): number {
  for (const node of diagram.nodes) {
    const table = simulation.setup?.props?.[node.id]?.cache ?? node.props?.cache;
    if (!cacheEnabled(diagram.planning, node.stencil, stencilRole(node.stencil), table)) continue;
    for (const rule of [...table.rules, ...(table.default ? [{ id: "", policy: table.default }] : [])]) {
      const rate = rates[node.id]?.[rule.id]?.rate ?? 0;
      if (rule.policy.noStore || !rate) continue;
      const hottest = popularityTable(rule.policy.keys, rule.policy.popularity).hottestShare;
      scale = Math.min(scale, Math.max(1, (rate * hottest * rule.policy.ttlMs!) / 1000 / 50));
    }
  }
  return scale;
}
