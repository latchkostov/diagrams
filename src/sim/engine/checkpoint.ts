/** Whole-graph checkpoint boundary; all facade state is read and installed explicitly. */
import type { Fault } from "../../model/faults";
import type { Attempt } from "../attempt";
import type { AdmissionState } from "../admission";
import type { LedgerState } from "../ledger";
import type { LineageState } from "../lineage";
import type { createCpuPartBudget } from "../resourceWork";
import { shareLatencyRecorder, type createLatencyBudget } from "../latency";
import { ShedQueue } from "../shedQueue";
import { Deque } from "../deque";
import type { EngineCheckpoint, LatencyMetrics, RouteCounts, SimEvent } from "../types";
import type { Node, Edge, Trip, EchoExpiry, Logical, Call, Message, Injection, Work } from "./model";

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
export interface CheckpointClock {
  time: number;
  incomingAt: number | undefined;
  incomingBeforeReleases: boolean;
  accumulator: number;
  speed: number;
  traffic: boolean;
  sourceRate: number;
  sourceEmitted: number;
  drawn: number;
  nextMessage: number;
  nextParticle: number;
  nextInjection: number;
  nextCall: number;
  nextAttempt: number;
  nextLogical: number;
  inSystem: number;
  eventHead: number;
  seed: number;
  randomCalls: number;
  topology: number;
  scale: number;
  capacityMultiplier: number;
  sinceFault: LatencyMetrics["sinceFault"];
}

// structuredClone preserves the graph's shared/cyclic references. Deque methods are
// reattached on restore; its queue contents and head are ordinary own properties.
// Clone family identity with messages, but share recordings. Lineage copies a record on its
// first write after capture, so finished history is never deep-cloned during playback.
function cloneGraph(source: CheckpointGraph): CheckpointGraph {
  const records = new Map([...source.lineage.store].map(([id, f]) => [id, f.trace]));
  const latencies = new Map([...source.nodes].map(([id, node]) => [id, node.latency]));
  let copy: CheckpointGraph;
  try {
    // Synchronous, internal-only graph: omit records just for structuredClone's traversal.
    for (const family of source.lineage.store.values()) family.trace = undefined;
    for (const node of source.nodes.values()) node.latency = undefined;
    copy = structuredClone(source);
  } finally {
    for (const [id, family] of source.lineage.store) family.trace = records.get(id);
    for (const [id, node] of source.nodes) node.latency = latencies.get(id);
  }
  for (const [id, family] of copy.lineage.store) family.trace = records.get(id);
  for (const [id, node] of copy.nodes) {
    const recorder = latencies.get(id);
    node.latency = recorder ? shareLatencyRecorder(recorder) : undefined;
  }
  return copy;
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
      if ("queues" in node.pending) {
        Object.setPrototypeOf(node.pending, ShedQueue.prototype);
        (node.pending as ShedQueue<Work>).restore();
      } else Object.setPrototypeOf(node.pending, Deque.prototype);
      Object.setPrototypeOf(node.resume, Deque.prototype);
      for (const group of node.groups) {
        Object.setPrototypeOf(group.pending, Deque.prototype);
        for (const queue of group.staged.values()) Object.setPrototypeOf(queue, Deque.prototype);
        // structuredClone gives dictionaries Object.prototype back: a consumer called "constructor" must stay a key.
        Object.setPrototypeOf(group.activeByNode, null);
      }
      Object.setPrototypeOf(node.rejectionReasons, null);
      Object.setPrototypeOf(node.routeRejections, null);
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
      const graph = cloneGraph(readGraph());
      const clock = readClock();
      const token = Object.freeze({ time: clock.time });
      checkpoints.set(token, () => {
        if (topology() !== clock.topology) throw new Error("Checkpoint belongs to a previous diagram");
        const copy = cloneGraph(graph);
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
