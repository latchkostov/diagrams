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

/** Exactly the existing capture list: one clone preserves aliases across every slice. */
export interface CheckpointGraph {
  nodes: Map<string, Node>;
  partBudget: ReturnType<typeof createCpuPartBudget>;
  latencyBudget: ReturnType<typeof createLatencyBudget>;
  edges: Edge[];
  trips: Trip[];
  echoExpiries: EchoExpiry[];
  echoByTime: Map<number, EchoExpiry>;
  drawnTrips: Map<number, Trip>;
  logical: Logical[];
  logicalIndices: Map<number, number>;
  ledger: LedgerState;
  calls: Map<number, Call>;
  outcomeChecks?: Map<number, Attempt<Message>>;
  injections: Injection[];
  events: SimEvent[];
  admission: Pick<AdmissionState, "buckets" | "inFlight" | "retainedExcess">;
  lineage: LineageState;
  routeCounts: Map<string, RouteCounts>;
  faults: Map<string, Fault>;
}

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
];

/** Data-only engine graphs: count while copying, preserving cycles, aliases and queue
 * prototypes. Estimate 32 B/object, 8 B/slot, 32 B/map entry, 16 B/set entry and UTF-16
 * strings plus their 16 B header. Shared/COW payloads are charged in full per token.
 * An explicit shared list requests a copy; omission only measures the graph.
 */
function cloneSized<T>(source: T, shared?: readonly (readonly [object, object])[]): [T, number] {
  const seen = new Map<object, unknown>();
  let bytes = 0;
  let clone = false;
  function visit(value: unknown): unknown {
    if (!value || typeof value !== "object") {
      if (typeof value === "string") bytes += 16 + value.length * 2;
      return value;
    }
    const prior = seen.get(value);
    if (prior) return prior;
    bytes += 32;
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
          : { __proto__: Object.getPrototypeOf(value) as object | null, ...value }
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

function cloneGraph(source: CheckpointGraph): [CheckpointGraph, number] {
  const shared: [object, object][] = [];
  for (const { trace } of source.lineage.store.values()) if (trace) shared.push([trace, trace]);
  for (const node of source.nodes.values()) {
    // Resolved configuration and its descendants are replaced on edits, never mutated.
    shared.push([node.props, node.props]);
    if (node.latency) shared.push([node.latency, shareLatencyRecorder(node.latency)]);
  }
  return cloneSized(source, shared);
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
    for (const [id, node] of copy.nodes) {
      nodes.set(id, node);
    }
    reindexGroups();
    edges.splice(0, edges.length, ...copy.edges);
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
        const [copy] = cloneGraph(graph);
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
