import { cloneWork } from "./model";
import { cloneReservation } from "../ledger";
/** Whole-graph checkpoint boundary; all facade state is read and installed explicitly. */
import type { Fault } from "../../model/faults";
import type { Attempt } from "../attempt";
import type { AdmissionState } from "../admission";
import type { LedgerState } from "../ledger";
import type { LineageState } from "../lineage";
import type { createCpuPartBudget } from "../resourceWork";
import { shareLatencyRecorder, type createLatencyBudget } from "../latency";
import type { EngineCheckpoint, LatencyMetrics, RouteCounts, SimEvent } from "../types";
import type { Node, Edge, Trip, EchoExpiry, Logical, Call, Message, Injection } from "./model";
import { CacheCheckpoint } from "../cache/cacheCheckpoint";

/** Named slots keep internal graph keys out of shipped code. One clone preserves all aliases.
 * Slots and object fields have identical byte charges; the oracle slot stays absent in production.
 */
export type CheckpointGraph = [
  nodes: Map<string, Node>,
  partBudget: ReturnType<typeof createCpuPartBudget>,
  latencyBudget: ReturnType<typeof createLatencyBudget>,
  edges: Edge[],
  trips: Trip[],
  echoExpiries: EchoExpiry[],
  echoByTime: Map<number, EchoExpiry>,
  drawnTrips: Map<number, Trip>,
  logical: Logical[],
  logicalIndices: Map<number, number>,
  ledger: LedgerState,
  calls: Map<number, Call>,
  injections: Injection[],
  events: SimEvent[],
  admission: Pick<AdmissionState, "buckets" | "inFlight" | "retainedExcess">,
  lineage: LineageState,
  routeCounts: Map<string, RouteCounts>,
  faults: Map<string, Fault>,
  outcomeChecks?: Map<number, Attempt<Message>>,
];

/** Scalars captured after the graph, including topology's token scope. */
export type CheckpointClock = readonly [
  time: number,
  topology: number,
  incomingAt: number | undefined,
  incomingBeforeReleases: boolean,
  accumulator: number,
  speed: number,
  traffic: boolean,
  sourceRate: number,
  sourceEmitted: number,
  drawn: number,
  nextMessage: number,
  nextParticle: number,
  nextInjection: number,
  nextCall: number,
  nextAttempt: number,
  nextLogical: number,
  inSystem: number,
  eventHead: number,
  seed: number,
  randomCalls: number,
  scale: number,
  capacityMultiplier: number,
  sinceFault: LatencyMetrics["sinceFault"],
  classifies: boolean,
];

/** Data-only engine graphs: count while copying, preserving cycles, aliases and queue
 * prototypes. Estimate 32 B/object, 8 B/slot, 32 B/map entry, 16 B/set entry and UTF-16
 * strings plus their 16 B header. Shared/COW payloads are charged in full per token.
 * An explicit shared list requests a copy; omission only measures the graph.
 */
function cloneSized<T>(
  source: T,
  shared?: readonly (readonly [object, object])[],
  immutable: readonly object[] = [],
  restore = false,
): [T, number] {
  const seen = new Map<object, unknown>();
  // Compiled popularity is immutable configuration, owned once by the run. All
  // 24 tokens retain that same table; none allocates another table's payload.
  for (const value of immutable) seen.set(value, value);
  let bytes = 0;
  let clone = false;
  function visit(value: unknown): unknown {
    if (!value || typeof value !== "object") {
      if (typeof value === "string") bytes += 16 + value.length * 2;
      return value;
    }
    const prior = seen.get(value);
    if (prior) return prior;
    if (restore && value instanceof CacheCheckpoint) {
      const result = visit(value.restore());
      seen.set(value, result);
      return result;
    }
    bytes += 32;
    if (value instanceof Float64Array || value instanceof Uint8Array) {
      const result = clone ? value.slice() : value;
      seen.set(value, result);
      bytes += value.byteLength;
      return result;
    }
    if (value instanceof Map) {
      const result = clone ? new Map<unknown, unknown>() : value;
      seen.set(value, result);
      bytes += value.size * 32;
      for (const [key, item] of value) {
        const k = visit(key),
          v = visit(item);
        if (clone) result.set(k, v);
      }
      return result;
    }
    if (value instanceof Set) {
      const result = clone ? new Set<unknown>() : value;
      seen.set(value, result);
      bytes += value.size * 16;
      for (const item of value) {
        const v = visit(item);
        if (clone) result.add(v);
      }
      return result;
    }
    const array = Array.isArray(value);
    const keys = Object.keys(value);
    const result = (
      clone
        ? array
          ? Array(value.length)
          : (cloneWork(value) ??
            cloneReservation(value) ?? { __proto__: Object.getPrototypeOf(value) as object | null, ...value })
        : value
    ) as Record<string, unknown>;
    seen.set(value, result);
    bytes += (array ? value.length : keys.length) * 8;
    for (const key of keys) {
      const v = visit((value as Record<string, unknown>)[key]);
      if (clone) result[key] = v;
    }
    return result;
  }
  // Seed entire immutable subgraphs first, including aliases from mutable rawProps.
  for (const [original, replacement] of shared ?? []) seen.set(original, visit(replacement));
  clone = !!shared;
  return [visit(source) as T, bytes];
}

export const checkpointBytes = (source: unknown): number => cloneSized(source)[1];

function cloneGraph(source: CheckpointGraph, restore = false): [CheckpointGraph, number] {
  const shared: [object, object][] = [];
  const immutable: object[] = [];
  for (const { trace } of source[15].store.values()) if (trace) shared.push([trace, trace]);
  for (const node of source[0].values()) {
    for (const saved of node.cache?.rules ?? []) {
      const rule = saved instanceof CacheCheckpoint ? saved.config : saved;
      if (rule.popularity) immutable.push(rule.popularity);
      // Compiled predicates and saved cache configuration never mutate during a run.
      for (const value of [rule.match, rule.types, rule.policy, node.rawProps.cache])
        if (value && typeof value === "object") immutable.push(value);
      // The graph is opaque while retained: every alias to a rule (including in-flight
      // work) maps to the same packed payload, then to the same restored rule.
      if (!restore) shared.push([saved, new CacheCheckpoint(saved)]);
    }
    // Resolved configuration and its descendants are replaced on edits, never mutated.
    shared.push([node.props, node.props]);
    if (node.latency) shared.push([node.latency, shareLatencyRecorder(node.latency)]);
    if (node.responseLatency) shared.push([node.responseLatency, shareLatencyRecorder(node.responseLatency)]);
    if (node.cache?.latency) shared.push([node.cache.latency, shareLatencyRecorder(node.cache.latency)]);
  }
  return cloneSized(source, shared, immutable, restore);
}

/** Positional hooks keep internal function names out of shipped object properties. */
export function createCheckpoints(
  nodes: Map<string, Node>,
  edges: Edge[],
  faultEdges: Map<string, Edge>,
  readGraph: () => CheckpointGraph,
  readClock: () => CheckpointClock,
  installGraph: (copy: CheckpointGraph, clock: CheckpointClock, repair: (copy: CheckpointGraph) => void) => void,
  reindexGroups: () => void,
  topology: () => number,
): readonly [() => EngineCheckpoint, (token: EngineCheckpoint) => void] {
  function repair(copy: CheckpointGraph): void {
    nodes.clear();
    for (const [id, node] of copy[0]) {
      nodes.set(id, node);
    }
    reindexGroups();
    edges.splice(0, edges.length, ...copy[3]);
    faultEdges.clear();
    for (const edge of edges) {
      faultEdges.set(edge.id, edge);
    }
  }
  const checkpoints = new WeakMap<EngineCheckpoint, () => void>();
  return [
    () => {
      const [graph, bytes] = cloneGraph(readGraph());
      const clock = readClock();
      const token = Object.freeze({ time: clock[0], bytes: bytes + 128 });
      checkpoints.set(token, () => {
        if (topology() !== clock[1]) throw new Error("Checkpoint belongs to a previous diagram");
        const [copy] = cloneGraph(graph, true);
        installGraph(copy, clock, repair);
      });
      return token;
    },
    (checkpoint) => {
      const restore = checkpoints.get(checkpoint);
      if (!restore) throw new Error("Checkpoint belongs to another engine");
      restore();
    },
  ];
}
