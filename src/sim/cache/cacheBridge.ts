import type { DiagramFile, Simulation } from "../../model/types";
import { hasCacheRules } from "../../model/caching";
import type { CacheLookup, NodeCache, CacheReadout, CacheDetails, CacheItemObservation } from "./cacheState";
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
  forgetFlight(work: import("../engine/model").Work): void;
  flightKey(rule: string, item: number, refreshId?: number): string;
  flight(
    work: import("../engine/model").Work,
    now: number,
    id: number,
    refresh?: boolean,
  ): import("../engine/model").Work;
  refreshReady(cache: NodeCache, lookup: CacheLookup, now: number, capacity: number): boolean;
  reconfigure(cache: NodeCache, table: unknown): boolean;
  purge(cache: NodeCache, now: number, rule?: string, mode?: "hard" | "soft"): void;
  lookup(
    cache: NodeCache,
    type: string,
    request: CompiledRoute | undefined,
    sync: boolean,
    now: number,
    size: number,
  ): CacheLookup;
  start(cache: NodeCache, lookup: CacheLookup, size: number, now?: number): number | undefined;
  settle(cache: NodeCache, lookup: CacheLookup, now: number, size: number, ok: boolean): void;
  read(cache: NodeCache): CacheReadout;
  itemFetches(cache: NodeCache): number;
  observeItem(cache: NodeCache, rule: string, item: number): CacheItemObservation | undefined;
  window(cache: NodeCache, now: number): CacheDetails["window"];
  invalidateSummary(cache: NodeCache): void;
  details(cache: NodeCache, now: number, sinceFault?: CacheDetails["sinceFault"]): CacheDetails;
  updateExpected(cache: NodeCache, rates: Record<string, { rate: number; fetchMs: number }>): void;
  plan(
    diagram: DiagramFile,
    simulation?: Simulation,
  ): Record<string, Record<string, { rate: number; fetchMs: number }>>;
  scale(diagram: DiagramFile, simulation: Simulation, scale: number): number;
}
let installed: CacheRuntime | undefined;
export function installCacheRuntime(runtime: CacheRuntime | undefined): void {
  installed = runtime;
}
export function requireCacheRuntime(): CacheRuntime {
  if (!installed) throw new Error("Cache runtime must be loaded before starting this run");
  return installed;
}
export function startingCacheRates(diagram: DiagramFile, simulation?: Simulation) {
  return hasCacheRules(diagram) ? requireCacheRuntime().plan(diagram, simulation) : undefined;
}
/** Non-Live browser entry points (the main-thread Checks fallback) share the same runtime. */
export async function ensureCacheRuntime(diagram: DiagramFile): Promise<void> {
  if (hasCacheRules(diagram) && !installed) await import("./cacheRuntime");
}
