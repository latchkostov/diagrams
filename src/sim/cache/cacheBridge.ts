import type { DiagramFile, Simulation } from "../../model/types";
import { hasCacheRules } from "../../model/caching";
import type { CacheLookup, NodeCache, CacheReadout } from "./cacheState";
import type { CompiledRoute } from "../routeMatching";

export interface CacheRuntime {
  compile(
    table: unknown,
    node: string,
    seed: number,
    scale: number,
    remaining: { value: number },
    rates?: Record<string, { rate: number; fetchMs: number }>,
  ): NodeCache;
  lookup(
    cache: NodeCache,
    type: string,
    request: CompiledRoute | undefined,
    sync: boolean,
    now: number,
    size: number,
  ): CacheLookup;
  start(cache: NodeCache, lookup: CacheLookup, size: number, now?: number): void;
  settle(cache: NodeCache, lookup: CacheLookup, now: number, size: number, ok: boolean): void;
  read(cache: NodeCache): CacheReadout;
  plan(
    diagram: DiagramFile,
    simulation?: Simulation,
  ): Record<string, Record<string, { rate: number; fetchMs: number }>>;
  scale(diagram: DiagramFile, simulation: Simulation, scale: number): number;
}
let installed: CacheRuntime | undefined;
export function installCacheRuntime(runtime: CacheRuntime): void {
  installed = runtime;
}
export function requireCacheRuntime(): CacheRuntime {
  if (!installed) throw new Error("Cache runtime must be loaded before starting this run");
  return installed;
}
export function startingCacheRates(diagram: DiagramFile, simulation?: Simulation) {
  return hasCacheRules(diagram) ? requireCacheRuntime().plan(diagram, simulation) : undefined;
}
