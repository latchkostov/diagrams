import { type Fault } from "../../model/faults";
import { resourceReadout, fleetReadout } from "../autoscaling";
import { createLatencyBudget, createLatencyRecorder, recordLatency, latencyMetrics } from "../latency";
import { roundDots, roundCounts, roundCalls, roundRoute } from "../units";
import { type CompiledRoute } from "../routeMatching";
import { retryWindow } from "../retryPolicy";
import { breakerView } from "../breaker";
import { STEP } from "../timing";
import type {
  RouteCounts,
  EngineOptions,
  NodeSimState,
  Particle,
  SimEvent,
  SimEventKind,
  SimFrame,
  SimSnapshot,
  TraceStep,
  TraceStepKind,
} from "../types";
import { isBroker, type Node, type Edge, type Message, type Trip } from "./model";
import type { Lineage } from "../lineage";

declare const __TEST_ORACLES__: boolean | undefined;
const TEST_ORACLES = typeof __TEST_ORACLES__ === "boolean" && __TEST_ORACLES__;

export interface AccountingQueries {
  routeCounts(): Map<string, RouteCounts>;
  latencyBudget(): ReturnType<typeof createLatencyBudget>;
  scale(): number;
  time(): number;
  spend(): void;
  observeEvent(event: SimEvent): void;
  dotsOf(message?: { represented?: number }): number;
  threadOccupancy(node: Node): number;
  queueBacklog(node: Node): number;
  slots(node: Node): number;
  held(node: Node): boolean;
  memoryRequests(node: Node): number;
  waits(): boolean;
  readFrame(): SimFrame;
}
/** Data-only accounting scalars; the facade checkpoints and restores each original field. */
export interface AccountingState {
  inSystem: number;
  nextMessage: number;
  eventHead: number;
}

/**
 * 1 - Math.exp(-STEP / 1000) as V8 computes it, written out: Math.exp may differ in the last bit between JS
 * engines, and throughput (which expectations read) is built on this (shared Live, docs/PARITY.md).
 */
const EWMA_ALPHA = 0.009950166250831893;

/** Before a half-open breaker narrows it, the message keeps completing its current route at the cohort's size. */
export function creditRoute(message: Message, cohort: { represented?: number }): void {
  if (!message.request) message.routeCohort = undefined;
  else if (message.routeCohort?.route !== message.request.id)
    message.routeCohort = { route: message.request.id, represented: cohort.represented };
}

function topWaiting(node: Node): [string, number][] {
  const top: [string, number][] = [];
  for (const entry of node.waitingOn) {
    let i = 0;
    while (i < top.length && top[i][1] >= entry[1]) i++;
    if (i < 3) {
      top.splice(i, 0, entry);
      if (top.length > 3) top.pop();
    }
  }
  return top;
}

function retryWindowView(edge: Edge, time: number, scale: number) {
  const w = retryWindow(edge.retry!.window, time);
  return {
    windowRequests: w.requests / scale,
    windowAttempts: w.attempts / scale,
    windowRetried: w.retried / scale,
    windowSucceeded: w.succeeded / scale,
  };
}

export function finishTickMetrics(node: Node): void {
  node.throughput += EWMA_ALPHA * ((node.completedThisStep * 1000) / STEP - node.throughput);
  node.completedThisStep = 0;
}

export function createAccounting(
  state: AccountingState,
  graph: {
    nodes: Map<string, Node>;
    edges: Edge[];
    events: SimEvent[];
  },
  lineage: Lineage,
  opts: Pick<EngineOptions, "onLoss">,
  queries: AccountingQueries,
) {
  const { nodes, edges, events } = graph;
  const {
    time,
    latencyBudget,
    routeCounts,
    spend,
    observeEvent,
    dotsOf,
    threadOccupancy,
    queueBacklog,
    slots,
    held,
    memoryRequests,
    waits,
    readFrame,
  } = queries;
  const EVENT_CAP = 200;
  function log(kind: SimEventKind, node: Node, message?: Message, detail = ""): void {
    const event: SimEvent = {
      time: time(),
      kind,
      nodeId: node.id,
      ...(message ? { messageId: message.id } : {}),
      text: `${node.label} ${kind}${message ? ` ${message.type} #${message.id}` : ""}${detail ? ` (${detail})` : ""}`,
    };
    if (TEST_ORACLES) observeEvent(event);
    if (events.length < EVENT_CAP) events.push(event);
    else {
      events[state.eventHead] = event;
      state.eventHead = (state.eventHead + 1) % EVENT_CAP;
    }
  }

  function processed(node: Node, message: Message): void {
    const units = dotsOf(message);
    node.processed += units;
    node.completedThisStep += units;
    log("process", node, message);
    if (message.family.trace) step(message, "done", node.id);
    // Each node reports the root-to-here path on successful handling, including terminal arrivals.
    // This also lets an intermediate worker explain its queue without composing hop percentiles.
    if (
      !message.requested &&
      (node.role === "processor" || node.role === "gateway" || node.role === "store" || node.role === "sink")
    ) {
      const elapsed = time() - message.family.bornAt;
      const work = Math.min(message.workMs, Math.max(0, elapsed - message.travelMs));
      recordLatency(
        (node.latency ??= createLatencyRecorder()),
        message.type,
        Math.max(0, elapsed - message.travelMs - work),
        work,
        message.travelMs,
        latencyBudget(),
        message.callMs,
        message.backoffMs,
        dotsOf(message),
      );
    }
  }

  /** Records a lineage step for a message whose family is being traced (callers check first). */
  function step(message: Message, kind: TraceStepKind, node: string, extra?: Partial<TraceStep>): void {
    lineage.record(message.family, {
      t: time(),
      kind,
      id: message.id,
      type: message.type,
      node,
      ...extra,
      ...(message.request ? { route: message.request.id } : {}),
    });
  }

  /** A message's journey ends at `node`: consumed ("end") or lost ("drop"). */
  function gone(
    node: Node,
    message: Message,
    kind: "end" | "drop" | "block" | "reject",
    reason: string,
    extra?: Partial<TraceStep>,
  ): void {
    state.inSystem--;
    message.family.alive--;
    // A journey finishes its route once, however many copies fan out and end.
    if (kind === "end" && message.request) {
      const done = (message.family.routesDone ??= []);
      if (!done.includes(message.request.id)) {
        done.push(message.request.id);
        const credit = message.routeCohort?.route === message.request.id ? message.routeCohort : message;
        countRoute(message.request).completed += dotsOf(credit);
      }
    }
    if (message.family.trace) {
      step(message, kind, node.id, { reason, ...extra });
      lineage.settle(message.family);
    }
  }

  function countRoute(route: CompiledRoute): RouteCounts {
    let counts = routeCounts().get(route.id);
    if (!counts) routeCounts().set(route.id, (counts = { sent: 0, rejected: 0, completed: 0 }));
    return counts;
  }

  /** The same message (or copy) with another address: a caller's explicit request route. Counts the call. */
  function addressed(message: Message, route: CompiledRoute | undefined): Message {
    if (message.request?.id === route?.id) return message;
    if (route) countRoute(route).sent += dotsOf(message);
    // Completion credit belongs to the route it was granted on, never to a new address.
    return { ...message, request: route, routeCohort: undefined };
  }

  /** A fan-out copy with its own id, in the same family (its parent keeps the original id). */
  function copy(node: Node, message: Message): Message {
    spend();
    const next = { ...message, id: state.nextMessage++, attempts: 0 };
    state.inSystem++;
    message.family.alive++;
    if (message.family.trace) step(next, "copy", node.id, { parent: message.id });
    return next;
  }

  /** One message per route: the first route keeps the message, the others get new copies. */
  function fanOut(node: Node, message: Message, routes: number): Message[] {
    const out = [{ ...message, attempts: 0 }];
    for (let i = 1; i < routes; i++) out.push(copy(node, message));
    return out;
  }

  function drop(node: Node, message: Message, reason: string, via?: Edge, timeoutOrigin?: string): void {
    const units = dotsOf(message);
    if (timeoutOrigin) node.timeoutLosses.set(timeoutOrigin, (node.timeoutLosses.get(timeoutOrigin) ?? 0) + units);
    node.dropped += units;
    if (reason === "node down") node.outageDropped += units;
    if (opts.onLoss) {
      const boundary = node.outages.values().next().value;
      const fault =
        reason === "link cut" && via
          ? { kind: "link" as const, edge: via.id, cut: true }
          : reason === "node down" && boundary
            ? { kind: "boundary" as const, boundary, down: true }
            : reason === "processing failed" && node.faultRate !== undefined
              ? { kind: "fail" as const, node: node.id, rate: node.faultRate as 0.1 | 0.5 }
              : undefined;
      opts.onLoss({
        node: node.id,
        connection: via?.id,
        reason,
        fault,
        dots: units,
        intentional:
          reason === "link cut" || reason === "node down"
            ? "down"
            : reason === "processing failed" && (node.faultRate !== undefined || node.scriptedFailure)
              ? "fails"
              : undefined,
      });
    }
    log("drop", node, message, reason);
    gone(node, message, "drop", reason);
  }

  /** A deny rule on `edge` stops the message at its source: blocked on purpose, not lost. */
  function block(message: Message, edge: Edge, extra?: Partial<TraceStep>): void {
    const node = edge.from;
    node.blocked += dotsOf(message);
    log("block", node, message, `deny rule to ${edge.to.label}`);
    gone(node, message, "block", "deny rule", extra);
  }

  function frame(
    time: number,
    scale: number,
    drawnTrips: Map<number, Trip>,
    sinceFault: import("../types").LatencyMetrics["sinceFault"],
    faults: Map<string, Fault>,
    routes: Map<string, CompiledRoute> | undefined,
    routeCounts: Map<string, RouteCounts>,
  ) {
    const particles: Particle[] = [];
    for (const trip of drawnTrips.values())
      if (trip.start <= time)
        particles.push({
          id: trip.id,
          edgeId: trip.edge.id,
          messageId: trip.message.id,
          rootId: trip.message.family.root,
          kind: trip.kind,
          ...((trip.message.callAttempt ?? 1) > 1 && trip.kind === "message"
            ? { callAttempt: trip.message.callAttempt }
            : {}),
          progress: Math.min(1, Math.max(0, (time - trip.start) / (trip.end - trip.start))),
          type: trip.message.type,
          color: trip.message.request?.color ?? trip.message.color,
          ...(trip.message.request ? { route: trip.message.request.id, marker: trip.message.request.marker } : {}),
          ...(trip.code ? { code: trip.code } : {}),
        });
    const nodeStates: Record<string, NodeSimState> = Object.create(null);
    for (const node of nodes.values()) {
      const lag: Record<string, number> = Object.create(null);
      const backlog = queueBacklog(node);
      for (const group of node.groups) lag[group.name] = roundDots(group.pendingUnits);
      if (node.role === "queue" && !node.groups.length) lag.queue = backlog;
      nodeStates[node.id] = {
        ...(node.latency
          ? {
              latency: sinceFault
                ? { ...latencyMetrics(node.latency), sinceFault: sinceFault }
                : latencyMetrics(node.latency),
            }
          : {}),
        id: node.id,
        role: node.role,
        status: node.status,
        backlog,
        lag,
        inFlight: threadOccupancy(node),
        ...(node.waits && node.role === "processor"
          ? {
              threads: {
                slots: slots(node) / scale,
                working: node.threadWeight.work / scale,
                waiting: node.threadWeight.wait / scale,
                waitingOn: topWaiting(node).map(([id, weight]) => [id, weight / scale]),
                queued: backlog,
                ...(node.freeFlight > 0 ? { inFlight: node.freeFlight } : {}),
              },
            }
          : {}),
        processed: roundDots(node.processed),
        failed: roundDots(node.failed),
        deadLettered: roundDots(node.deadLettered),
        dropped: roundDots(node.dropped),
        ...(node.outageDropped ? { outageDropped: roundDots(node.outageDropped) } : {}),
        ...(node.blocked ? { blocked: roundDots(node.blocked) } : {}),
        ...(node.props.queue || node.shed
          ? {
              shed: roundDots(node.shed),
              queueDepth: roundDots(node.queueUnits / scale),
              ...(node.shedLost ? { shedLost: roundDots(node.shedLost) } : {}),
              ...(node.props.queue?.limit === undefined ? {} : { queueLimit: node.props.queue.limit }),
            }
          : {}),
        ...(node.props.admission || node.table || node.props.queue || node.shed
          ? { rejected: roundDots(node.rejected), rejectionReasons: roundCounts(node.rejectionReasons) }
          : {}),
        ...(node.table ? { routeRejections: roundCounts(node.routeRejections) } : {}),
        ...(held(node) ? { failingOver: true } : {}),
        throughput: node.throughput,
        ...(node.fleet && node.props.resources
          ? {
              fleet: fleetReadout(node.fleet),
              resources: resourceReadout(node.fleet, node.props.resources, memoryRequests(node), time, scale),
            }
          : {}),
        replicas: node.replicas,
        activeReplicas: node.activeReplicas,
        idleReplicas: node.replicas - node.activeReplicas,
        ...(isBroker(node) && !node.groups.length ? { noConsumer: true as const } : {}),
      };
    }
    const frame: SimFrame = {
      time: time,
      particles,
      nodes: nodeStates,
      inSystem: state.inSystem,
      scale: scale,
    };
    if (faults.size) frame.faults = structuredClone([...faults.values()]);
    if (routes) {
      const counts: Record<string, RouteCounts> = Object.create(null);
      for (const id of routes.keys()) {
        const c = routeCounts.get(id);
        counts[id] = c ? roundRoute(c) : { sent: 0, rejected: 0, completed: 0 };
      }
      frame.routes = counts;
    }
    return frame;
  }

  function snapshot(): SimSnapshot {
    const frame = readFrame();
    const time = queries.time();
    const scale = queries.scale();
    const edgeStates: SimSnapshot["edges"] = Object.create(null);
    for (const edge of edges)
      edgeStates[edge.id] = {
        id: edge.id,
        delivered: roundDots(edge.delivered),
        active: edge.active,
        ...(edge.breaker ? { breaker: breakerView(edge.breaker.state, edge.breaker.policy, time) } : {}),
        ...(waits() && edge.sync
          ? { calls: roundCalls({ ...edge.calls, ...(edge.retry ? retryWindowView(edge, time, scale) : {}) }) }
          : {}),
      };
    const recent: SimEvent[] = [];
    for (let i = 0; i < events.length; i++) recent.push({ ...events[(state.eventHead + i) % events.length] });
    return { ...frame, edges: edgeStates, events: recent };
  }
  return {
    log,
    processed,
    step,
    gone,
    countRoute,
    addressed,
    copy,
    fanOut,
    drop,
    block,
    frame,
    snapshot,
  };
}
