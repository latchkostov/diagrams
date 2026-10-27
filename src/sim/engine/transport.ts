import { messageColor } from "../colors";
import { pushDue, popDue } from "../dueHeap";
import { forwardingShare, outputType } from "../topology";
import { nextByDeficit, type CompiledMix, type CompiledRoute } from "../routeMatching";
import { classifyOutcome } from "../retryPolicy";
import { STEP } from "../timing";
import type { RouteCounts, EngineOptions, ParticleKind, TraceStep } from "../types";
import {
  type Message,
  type Delivery,
  type Work,
  type RouteDecision,
  type Node,
  type Logical,
  type Edge,
  type Trip,
  type EchoExpiry,
  type Injection,
} from "./model";
import type { Lineage } from "../lineage";
import type { InjectOptions } from "../types";

declare const __TEST_ORACLES__: boolean | undefined;
const TEST_ORACLES = typeof __TEST_ORACLES__ === "boolean" && __TEST_ORACLES__;
export const SOURCE_VOLUME_CAP = 200_000;

/** Synchronous transport bodies; the facade retains the ordered tick and restorable roots. */
export function createTransport(
  trips: () => Trip[],
  logical: () => Logical[],
  injections: Injection[],
  waits: () => boolean,
  block: (message: Message, edge: Edge, extra?: Partial<TraceStep>) => void,
  scheduleLogical: (event: Logical) => void,
  logicalId: () => number,
  time: () => number,
  classifies: () => boolean,
  cut: (edge: Edge) => boolean,
  drawn: (delta?: number) => number,
  maxParticles: number,
  particleId: () => number,
  drawnTrips: () => Map<number, Trip>,
  dotsOf: (m?: { represented?: number }) => number,
  step: (message: Message, kind: import("../types").TraceStepKind, node: string, extra?: Partial<TraceStep>) => void,
  random: () => number,
  log: (kind: import("../types").SimEventKind, node: Node, message?: Message, detail?: string) => void,
  drop: (node: Node, message: Message, reason: string, via?: Edge, timeoutOrigin?: string) => void,
  echoByTime: () => Map<number, EchoExpiry>,
  echoExpiries: () => EchoExpiry[],
  gone: (
    node: Node,
    message: Message,
    kind: "end" | "drop" | "block" | "reject",
    reason: string,
    extra?: Partial<TraceStep>,
  ) => void,
  fanOut: (node: Node, message: Message, routes: number) => Message[],
  addressed: (message: Message, route: CompiledRoute | undefined) => Message,
  cohort: () => number,
  cohortDots: () => Map<Node, number>,
  spend: () => void,
  messageId: () => number,
  opts: EngineOptions,
  countRoute: (route: CompiledRoute) => RouteCounts,
  addMessage: () => void,
  lineage: Lineage,
  arrive: (node: Node, work: Work) => void,
  traffic: () => boolean,
  trafficLimit: () => string | undefined,
  nodes: Map<string, Node>,
  scale: () => number,
  sourceEmitted: (delta?: number) => number,
  drainLogical: () => void,
  returned: (trip: Trip) => void,
  routes: () => Map<string, CompiledRoute> | undefined,
  injectionId: () => number,
) {
  /** Messages on the way to a node, as arrived will count them off: a trip's, or a logical arrival's (an echo). */
  function onTheWay(visit: (node: Node, message: Message) => void): void {
    for (const trip of trips())
      if (!trip.echo && (trip.kind === "message" || trip.kind === "dlq")) visit(trip.edge.to, trip.message);
    // Only an echo's arrival carries a message (calls and thread graces don't).
    for (const event of logical()) if (event.message) visit(event.edge!.to, event.message);
  }
  const before = (a: Injection, b: Injection) => a.due < b.due || (a.due === b.due && a.order < b.order);

  function schedule(item: Injection): void {
    let index = injections.length;
    injections.push(item);
    while (index > 0) {
      const parent = (index - 1) >>> 1;
      if (!before(item, injections[parent])) break;
      injections[index] = injections[parent];
      index = parent;
    }
    injections[index] = item;
  }

  function unschedule(): Injection {
    const first = injections[0];
    const last = injections.pop()!;
    if (injections.length) {
      let index = 0;
      while (index * 2 + 1 < injections.length) {
        let child = index * 2 + 1;
        if (child + 1 < injections.length && before(injections[child + 1], injections[child])) child++;
        if (!before(injections[child], last)) break;
        injections[index] = injections[child];
        index = child;
      }
      injections[index] = last;
    }
    return first;
  }

  /**
   * Every downstream delivery (a forward, a fan-out copy, a change feed, a broker's delivery, a dead letter) goes
   * through here, so a deny rule holds on every path. Replies and retries travel back and aren't deliveries.
   */
  function deliver(
    edge: Edge,
    message: Message,
    kind: "message" | "dlq",
    delivery?: Delivery,
    extra?: Partial<TraceStep>,
  ): void {
    if (waits() && !edge.sync)
      message = { ...message, returnCall: undefined, callDepth: undefined, callAttempt: undefined };
    if (edge.deny) {
      block(message, edge, extra);
      if (waits() && message.returnCall !== undefined)
        scheduleLogical({
          id: logicalId(),
          end: time(),
          edge,
          call: message.returnCall,
          callAttempt: message.callAttempt,
          ok: false,
          // A deny rule never lets this Request reach its callee: terminal, as a missing route is.
          ...(classifies() ? { outcome: classifyOutcome("no-route"), code: 404 } : {}),
          represented: message.represented,
        });
    } else if (cut(edge)) cutPush(edge, message);
    else if (waits() && edge.sync && kind === "message" && !delivery) {
      const start = Math.max(time(), message.visualAt ?? time());
      const end = start + Math.max(STEP, edge.travelMs);
      const visible = drawn() < maxParticles;
      const trip: Trip = { id: particleId(), edge, message, kind, start, end, drawn: visible, echo: true };
      if (visible) {
        drawn(1);
        drawnTrips().set(trip.id, trip);
      }
      edge.active++;
      edge.to.incoming++;
      edge.to.incomingUnits += dotsOf(message);
      keepEcho(trip);
      scheduleLogical({
        id: logicalId(),
        end: time() + edge.networkDelayMs,
        edge,
        message: { ...rename(message, edge.emits), requested: true, visualAt: end },
      });
      if (message.family.trace)
        step(message, "send", edge.from.id, {
          edge: edge.id,
          via: kind,
          until: time() + edge.networkDelayMs,
          ...extra,
        });
    } else travel(edge, message, kind, delivery, 0, undefined, extra);
  }

  /** A connection takes a message when its type filter does and, if it has one, its request filter matches. */
  function accepts(edge: Edge, message: Message, fanout = false, injected = true): boolean {
    const share = forwardingShare(
      edge.from.role,
      edge,
      message.type,
      !fanout ? "routed" : injected ? "injected" : "output",
      edge.requestFilter,
      message.request,
    );
    return share >= 1 || (share > 0 && random() < share);
  }

  function rename(message: Message, type: string | undefined): Message {
    return type === undefined || type === message.type ? message : { ...message, type, color: messageColor(type) };
  }

  function cutPush(edge: Edge, message: Message): void {
    if (edge.to.role === "processor") {
      edge.to.failed += dotsOf(message);
      log("fail", edge.to, message, "link cut");
      if (message.family.trace) step(message, "fail", edge.to.id, { edge: edge.id });
    }
    drop(edge.to, message, "link cut", edge);
  }

  function latency(node: Node): number {
    if (!node.props.latencyMs) return 0;
    return node.props.latencyMs * (1 + (node.props.jitter ? (random() * 2 - 1) * node.props.jitter : 0));
  }

  /** A message that was on its way to the node has arrived there. */
  function arrived(node: Node, message: Message): void {
    node.incomingUnits = --node.incoming ? node.incomingUnits - dotsOf(message) : 0;
  }

  /** Invisible decoration owns counts only, never messages or their connected graph. */
  function keepEcho(trip: Trip): void {
    if (trip.drawn) pushDue(trips(), trip);
    else {
      const end = Math.ceil(trip.end / STEP) * STEP;
      let expiry = echoByTime().get(end);
      if (!expiry) {
        expiry = { id: trip.id, end, counts: new Map() };
        echoByTime().set(end, expiry);
        pushDue(echoExpiries(), expiry);
      }
      expiry.counts.set(trip.edge, (expiry.counts.get(trip.edge) ?? 0) + 1);
    }
  }

  function travel(
    edge: Edge,
    message: Message,
    kind: ParticleKind,
    delivery?: Delivery,
    delay = 0,
    code?: number,
    extra?: Partial<TraceStep>,
  ): void {
    if (kind === "message" || kind === "dlq") message = rename(message, edge.emits);
    // Replies are decorative and must never mutate the still-live branch's timings.
    if (kind !== "reply") {
      message.travelMs += Math.ceil(Math.max(STEP, edge.travelMs) / STEP) * STEP;
      if (edge.sync) message.requested = true;
    }
    const visible = drawn() < maxParticles;
    if (visible) drawn(1);
    edge.active++;
    if (kind === "message" || kind === "dlq") {
      edge.to.incoming++;
      edge.to.incomingUnits += dotsOf(message);
    }
    const end = time() + Math.max(STEP, edge.travelMs) + delay;
    const trip: Trip = { id: particleId(), edge, message, kind, delivery, start: time(), end, drawn: visible };
    if (code) trip.code = code;
    if (waits() && (message.visualAt ?? 0) > time()) {
      trip.drawn = false;
      const start = message.visualAt!;
      const echo: Trip = {
        ...trip,
        id: particleId(),
        start,
        end: start + Math.max(STEP, edge.travelMs),
        drawn: visible,
        echo: true,
      };
      edge.active++;
      keepEcho(echo);
      if (visible) drawnTrips().set(echo.id, echo);
    }
    pushDue(trips(), trip);
    if (trip.drawn) drawnTrips().set(trip.id, trip);
    if (waits() && kind !== "reply")
      message.visualAt = Math.max(time(), message.visualAt ?? time()) + Math.max(STEP, edge.travelMs);
    if (message.family.trace) {
      const back = kind === "reply" || kind === "retry";
      step(message, "send", back ? edge.to.id : edge.from.id, { edge: edge.id, via: kind, until: end, ...extra });
    }
  }

  function forward(node: Node, message: Message, decision?: RouteDecision, selected?: Edge[]): void {
    if (decision && !selected) {
      // The router's table chose this connection on arrival: no round-robin, no fallback.
      deliver(decision.edge, { ...message, attempts: 0 }, "message", undefined, {
        rule: decision.rule,
        weight: decision.weight,
      });
      return;
    }
    if (!selected) message = rename(message, outputType(node.role, node.props.emits, message.type));
    const outgoing = selected ?? outputRoutes(node, message);
    // A node with nowhere to send (e.g. a final worker) is a terminal consumer, not a drop.
    if (!outgoing.length) {
      gone(node, message, "end", "consumed");
      return;
    }
    if (!selected && node.role === "gateway") {
      deliver(outgoing[0], { ...message, attempts: 0 }, "message");
    } else {
      const copies = fanOut(node, message, outgoing.length);
      outgoing.forEach((edge, i) =>
        deliver(edge, !selected && edge.requestRoute ? addressed(copies[i], edge.requestRoute) : copies[i], "message"),
      );
    }
  }

  /** Draw ordinary fan-out once, or choose one healthy gateway target in stable round-robin order. */
  function outputRoutes(node: Node, message: Message): Edge[] {
    const outgoing = node.outgoing.filter((edge) =>
      accepts(edge, edge.requestRoute ? addressedView(message, edge.requestRoute) : message, true),
    );
    if (node.role !== "gateway" || !outgoing.length) return outgoing;
    const healthy = node.props.healthChecks
      ? outgoing.filter((edge) => edge.to.status !== "down" && !cut(edge))
      : outgoing;
    const pool = healthy.length ? healthy : outgoing;
    return [pool[node.cursor++ % pool.length]];
  }

  /** For filtering only: the branch's message as it would leave, without counting a call that may not happen. */
  function addressedView(message: Message, route: CompiledRoute): Message {
    return message.request?.id === route.id ? message : { ...message, request: route };
  }

  /** The route an injected message carries: the injection's explicit one, else the source's mix (weighted deficit). */
  function injectedRoute(node: Node, explicit: CompiledRoute | undefined): CompiledRoute | undefined {
    if (explicit || !node.mix) return explicit;
    const index = nextByDeficit(node.mix.proportions, node.mixDeficit);
    return index < 0 ? undefined : node.mix.routes[index];
  }

  function emit(node: Node, type: string, injected: boolean, route?: CompiledRoute): void {
    if (!TEST_ORACLES || cohort() === 1) return emitOne(node, type, injected, route);
    const dots = (cohortDots().get(node) ?? 0) + 1;
    cohortDots().set(node, dots);
    const real = Math.floor(dots * cohort() + 1e-9) - Math.floor((dots - 1) * cohort() + 1e-9);
    for (let i = 0; i < real; i++) emitOne(node, type, injected, route);
  }

  function emitOne(node: Node, type: string, injected: boolean, route?: CompiledRoute): void {
    spend();
    const id = messageId();
    const message: Message = {
      id,
      type,
      color: messageColor(type),
      attempts: 0,
      workMs: 0,
      travelMs: 0,
      family: { root: id, alive: 1, parked: 0, bornAt: time() },
    };
    if (TEST_ORACLES && injected && opts.injectRepresented) message.represented = opts.injectRepresented;
    if (route) {
      message.request = route;
      countRoute(route).sent += dotsOf(message);
    }
    addMessage();
    lineage.born(message.family, type, node.id, route?.id);
    if (injected) log("inject", node, message);
    arrive(node, { message, remaining: latency(node), injected });
  }

  function admitIncoming(): void {
    while (injections.length && injections[0].due <= time() + 1e-8) {
      const batch = unschedule();
      emit(batch.node, batch.type, true, injectedRoute(batch.node, batch.route));
      if (++batch.index < batch.count) {
        batch.due = batch.start + batch.index * batch.interval;
        schedule(batch);
      }
    }
    if (traffic() && !trafficLimit())
      for (const node of nodes.values()) {
        if (node.role !== "source" || node.status !== "up") continue;
        if (node.mix) {
          emitMix(node, node.mix);
          continue;
        }
        node.trafficCredit += (node.props.ratePerSec * STEP) / (1000 * scale() * cohort());
        const count = Math.min(SOURCE_VOLUME_CAP - sourceEmitted(), Math.floor(node.trafficCredit + 1e-10));
        node.trafficCredit -= count;
        sourceEmitted(count);
        if (sourceEmitted() === SOURCE_VOLUME_CAP && count)
          log("status", node, undefined, "continuous traffic budget reached; restart to continue");
        for (let i = 0; i < count; i++) emit(node, node.props.messageType, false);
      }
    drainLogical();
    while (echoExpiries().length && echoExpiries()[0].end <= time()) {
      const expiry = popDue(echoExpiries());
      echoByTime().delete(expiry.end);
      for (const [edge, count] of expiry.counts) edge.active -= count;
    }
    while (trips().length && trips()[0].end <= time()) {
      const trip = popDue(trips());
      drawnTrips().delete(trip.id);
      trip.edge.active--;
      if (trip.drawn) drawn(-1);
      if (trip.echo) continue;
      if (trip.kind === "retry") returned(trip);
      else if (trip.kind !== "reply") {
        trip.edge.delivered += dotsOf(trip.message);
        arrived(trip.edge.to, trip.message);
        if (cut(trip.edge)) {
          if (trip.delivery) returned(trip);
          else cutPush(trip.edge, trip.message);
          continue;
        }
        log("deliver", trip.edge.to, trip.message);
        lineage.arrived(trip.message, trip.edge.to.id, trip.edge.id);
        arrive(trip.edge.to, {
          message: trip.message,
          via: trip.edge,
          delivery: trip.delivery,
          remaining: latency(trip.edge.to),
        });
      }
    }
  }

  /**
   * A source's mix: each route earns its own fractional credit in simulation time (a share of the source's rate, or
   * its own rate), so rare routes still emit on schedule and every route's count stays within one dot of its rate.
   * Equal-time emissions go in mix order. Each dot is one route: a dot never mixes addresses.
   */
  function emitMix(node: Node, mix: CompiledMix): void {
    for (let i = 0; i < mix.routes.length; i++) {
      const rate = mix.mode === "shares" ? node.props.ratePerSec * mix.values[i] : mix.values[i];
      node.mixCredit[i] += (rate * STEP) / (1000 * scale() * cohort());
      const count = Math.min(SOURCE_VOLUME_CAP - sourceEmitted(), Math.floor(node.mixCredit[i] + 1e-10));
      node.mixCredit[i] -= count;
      sourceEmitted(count);
      if (sourceEmitted() === SOURCE_VOLUME_CAP && count)
        log("status", node, undefined, "continuous traffic budget reached; restart to continue");
      for (let k = 0; k < count; k++) emit(node, node.props.messageType, false, mix.routes[i]);
    }
  }
  function inject(nodeId: string, count: number, options: InjectOptions = {}): void {
    const node = nodes.get(nodeId);
    if (!node || !Number.isFinite(count) || count < 1) return;
    count = Math.floor(count);
    const type = options.type ?? node.props.messageType;
    // An explicit route must be one of the diagram's: never bind to something similar.
    const route = options.routeId === undefined ? undefined : routes()?.get(options.routeId);
    if (options.routeId !== undefined && !route) return;
    const spread = Number.isFinite(options.spreadMs) ? Math.max(0, options.spreadMs!) : 0;
    if (!spread || count === 1) for (let i = 0; i < count; i++) emit(node, type, true, injectedRoute(node, route));
    else {
      emit(node, type, true, injectedRoute(node, route));
      const interval = spread / (count - 1);
      schedule({
        node,
        type,
        ...(route ? { route } : {}),
        start: time(),
        interval,
        index: 1,
        count,
        due: time() + interval,
        order: injectionId(),
      });
    }
  }
  return [
    onTheWay,
    deliver,
    accepts,
    latency,
    arrived,
    keepEcho,
    travel,
    forward,
    outputRoutes,
    admitIncoming,
    inject,
    rename,
    cutPush,
  ] as const;
}
