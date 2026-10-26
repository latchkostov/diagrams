import { STEP } from "../timing";
import { createLatencyBudget, createLatencyRecorder, recordLatency } from "../latency";
import { roundDots, roundCalls } from "../units";
import { type CompiledRoute } from "../routeMatching";
import { retryWindow } from "../retryPolicy";
import { breakerView } from "../breaker";
import type {
  RouteCounts,
  EngineOptions,
  SimEvent,
  SimEventKind,
  SimFrame,
  SimSnapshot,
  TraceStep,
  TraceStepKind,
} from "../types";
import { type Node, type Edge, type Message } from "./model";
import type { Lineage } from "../lineage";

export interface AccountingQueries {
  countRoute(route: CompiledRoute): RouteCounts;
  latencyBudget(): ReturnType<typeof createLatencyBudget>;
  time(): number;
  allocate(message: Message): Message;
  remove(): void;
  recordEvent(event: SimEvent): void;
  dotsOf(message?: { represented?: number }): number;
  waits(): boolean;
}

export function createAccounting(
  edges: Edge[],
  events: SimEvent[],
  lineage: Lineage,
  opts: Pick<EngineOptions, "onLoss">,
  recordEvent: AccountingQueries["recordEvent"],
  allocate: AccountingQueries["allocate"],
  remove: AccountingQueries["remove"],
  countRoute: AccountingQueries["countRoute"],
  time: AccountingQueries["time"],
  latencyBudget: AccountingQueries["latencyBudget"],
  dotsOf: AccountingQueries["dotsOf"],
  waits: AccountingQueries["waits"],
) {
  /**
   * 1 - Math.exp(-STEP / 1000) as V8 computes it, written out: Math.exp may differ in the last bit between JS
   * engines, and throughput (which expectations read) is built on this (shared Live, docs/PARITY.md).
   */
  const EWMA_ALPHA = 0.009950166250831893;

  function log(kind: SimEventKind, node: Node, message?: Message, detail = ""): void {
    const event: SimEvent = {
      time: time(),
      kind,
      nodeId: node.id,
      ...(message && { messageId: message.id }),
      text: `${node.label} ${kind}${message ? ` ${message.type} #${message.id}` : ""}${detail ? ` (${detail})` : ""}`,
    };
    recordEvent(event);
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
    remove();
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

  /** A fan-out copy with its own id, in the same family (its parent keeps the original id). */
  function copy(node: Node, message: Message): Message {
    const next = allocate(message);
    message.family.alive++;
    if (message.family.trace) step(next, "copy", node.id, { parent: message.id });
    return next;
  }
  return [
    log,
    step /** Before a half-open breaker narrows it, the message keeps completing its current route at the cohort's size. */,
    function creditRoute(message: Message, cohort: { represented?: number }): void {
      if (!message.request) message.routeCohort = undefined;
      else if (message.routeCohort?.route !== message.request.id)
        message.routeCohort = { route: message.request.id, represented: cohort.represented };
    } /** The same message (or copy) with another address: a caller's explicit request route. Counts the call. */,
    function addressed(message: Message, route: CompiledRoute | undefined): Message {
      if (message.request?.id === route?.id) return message;
      if (route) countRoute(route).sent += dotsOf(message);
      // Completion credit belongs to the route it was granted on, never to a new address.
      return { ...message, request: route, routeCohort: undefined };
    },
    copy /** One message per route: the first route keeps the message, the others get new copies. */,
    function fanOut(node: Node, message: Message, routes: number): Message[] {
      const out = [{ ...message, attempts: 0 }];
      for (let i = 1; i < routes; i++) out.push(copy(node, message));
      return out;
    },
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
    },
    gone,
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
    } /** A deny rule on `edge` stops the message at its source: blocked on purpose, not lost. */,
    function block(message: Message, edge: Edge, extra?: Partial<TraceStep>): void {
      const node = edge.from;
      node.blocked += dotsOf(message);
      log("block", node, message, `deny rule to ${edge.to.label}`);
      gone(node, message, "block", "deny rule", extra);
    },
    function finishTickMetrics(node: Node): void {
      node.throughput += EWMA_ALPHA * ((node.completedThisStep * 1000) / STEP - node.throughput);
      node.completedThisStep = 0;
    },
    function snapshot(frame: SimFrame, now: number, scale: number, eventHead: number): SimSnapshot {
      const edgeStates: SimSnapshot["edges"] = Object.create(null);
      for (const edge of edges) {
        const state: SimSnapshot["edges"][string] = (edgeStates[edge.id] = {
          id: edge.id,
          delivered: roundDots(edge.delivered),
          active: edge.active,
          ...(edge.breaker ? { breaker: breakerView(edge.breaker.state, edge.breaker.policy, now) } : {}),
        });
        if (waits() && edge.sync) {
          const w = edge.retry && retryWindow(edge.retry.window, now);
          state.calls = roundCalls(
            w
              ? {
                  ...edge.calls,
                  windowRequests: w.requests / scale,
                  windowAttempts: w.attempts / scale,
                  windowRetried: w.retried / scale,
                  windowSucceeded: w.succeeded / scale,
                }
              : edge.calls,
          );
        }
      }
      return {
        ...frame,
        edges: edgeStates,
        events: events.map((_, i) => ({ ...events[(eventHead + i) % events.length] })),
      };
    },
  ] as const;
}
