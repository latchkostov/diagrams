import type { DiagramFile, SimRole } from "../model/types";
import { stencilRole } from "../stencils/roles";
import { messageColor } from "./colors";
import { resolveProps, type ResolvedProps } from "./defaults";
import { Deque } from "./deque";
import { createLineage, type Family } from "./lineage";
import { mulberry32 } from "./rng";
import {
  acceptsType,
  allocateGroupReplicas,
  compileTopology,
  deadLetterRoutes,
  type CompiledTopology,
} from "./topology";
import { resolveScale, resolveMultiplier } from "./units";
import type {
  EngineOptions,
  EngineCheckpoint,
  NodeSimProps,
  NodeSimState,
  NodeStatus,
  Particle,
  ParticleKind,
  SimEngine,
  SimEvent,
  SimEventKind,
  SimSnapshot,
  TraceStep,
  TraceStepKind,
} from "./types";

const STEP = 10;
const EWMA_ALPHA = 1 - Math.exp(-STEP / 1000);
const EVENT_CAP = 200;

interface Message {
  id: number;
  type: string;
  color: string;
  attempts: number;
  /** Shared by the root message and all its fan-out copies. */
  family: Family;
}
interface Group {
  name: string;
  edges: Edge[];
  pending: Deque<Message>;
  active: number;
  cursor: number;
  allocations: Map<string, number>;
  activeByNode: Record<string, number>;
  members: string[];
  limit: number;
}
interface Delivery {
  broker: Node;
  group: Group;
  edge: Edge;
  original: Message;
}
interface Work {
  message: Message;
  via?: Edge;
  delivery?: Delivery;
  remaining: number;
  retained?: boolean;
  injected?: boolean;
}
interface Node {
  id: string;
  label: string;
  role: SimRole;
  status: NodeStatus;
  rawProps: Record<string, unknown>;
  props: ResolvedProps;
  replicas: number;
  activeReplicas: number;
  outgoing: Edge[];
  dlq?: Edge;
  groups: Group[];
  pending: Deque<Work>;
  working: Work[];
  incoming: number;
  cursor: number;
  processed: number;
  failed: number;
  deadLettered: number;
  dropped: number;
  throughput: number;
  completedThisStep: number;
  trafficCredit: number;
  serviceCredit: number;
}
interface Edge {
  id: string;
  from: Node;
  to: Node;
  sync: boolean;
  dlq: boolean;
  travelMs: number;
  share?: number;
  filter?: string[];
  emits?: string;
  groupName: string;
  delivered: number;
  active: number;
}
interface Trip {
  id: number;
  edge: Edge;
  message: Message;
  kind: ParticleKind;
  start: number;
  end: number;
  drawn: boolean;
  delivery?: Delivery;
}
interface Injection {
  node: Node;
  type: string;
  start: number;
  interval: number;
  index: number;
  count: number;
  due: number;
  order: number;
}

function isBroker(node: Node): boolean {
  return node.role === "queue" || node.role === "topic" || node.role === "stream";
}

// Runner seed configuration for reused native engines, without widening the public contract.
const seedSetters = new WeakMap<SimEngine, (seed: number) => void>();
export function seedEngine(engine: SimEngine, seed: number): void {
  seedSetters.get(engine)?.(seed);
}

/** Fixed-step, DOM-free engine. Drawing limits never affect message delivery. */
export function createEngine(opts: EngineOptions = {}): SimEngine {
  let seed = opts.seed ?? Math.floor(Math.random() * 4294967296);
  const roleOf = opts.roleOf ?? stencilRole;
  const maxParticles = Number.isFinite(opts.maxParticles) ? Math.max(0, Math.floor(opts.maxParticles!)) : 1500;
  let randomState = mulberry32(seed);
  let randomCalls = 0;
  const random = () => {
    randomCalls++;
    return randomState();
  };
  const nodes = new Map<string, Node>();
  const edges: Edge[] = [];
  let trips: Trip[] = [];
  let drawn = 0;
  let time = 0;
  let accumulator = 0;
  let speed = 1;
  let traffic = false;
  let scale = resolveScale(opts.scale);
  let capacityMultiplier = 1;
  let nextMessage = 1;
  let nextParticle = 1;
  let nextInjection = 1;
  let inSystem = 0;
  const events: SimEvent[] = [];
  let eventHead = 0;
  let topology = 0;
  let compiled: CompiledTopology = { edges: [], outgoing: new Map(), groups: new Map(), restricted: new Set() };
  const groupsByConsumer = new Map<string, Group[]>();
  const checkpoints = new WeakMap<EngineCheckpoint, () => void>();
  const lineage = createLineage({
    time: () => time,
    find(test) {
      for (const trip of trips)
        if (test(trip.message))
          return {
            message: trip.message,
            node: trip.kind === "reply" || trip.kind === "retry" ? trip.edge.to.id : trip.edge.from.id,
          };
      for (const node of nodes.values()) {
        const work = node.working.find((w) => test(w.message)) ?? node.pending.find((w) => test(w.message));
        if (work) return { message: work.message, node: node.id };
        for (const group of node.groups) {
          const queued = group.pending.find(test);
          if (queued) return { message: queued, node: node.id };
        }
      }
      return undefined;
    },
  });
  // Min-heap contains one entry per spread batch, not one per future message.
  const injections: Injection[] = [];
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

  function log(kind: SimEventKind, node: Node, message?: Message, detail = ""): void {
    const event: SimEvent = {
      time,
      kind,
      nodeId: node.id,
      ...(message ? { messageId: message.id } : {}),
      text: `${node.label} ${kind}${message ? ` ${message.type} #${message.id}` : ""}${detail ? ` (${detail})` : ""}`,
    };
    if (events.length < EVENT_CAP) events.push(event);
    else {
      events[eventHead] = event;
      eventHead = (eventHead + 1) % EVENT_CAP;
    }
  }

  function processed(node: Node, message: Message): void {
    node.processed++;
    node.completedThisStep++;
    log("process", node, message);
    if (message.family.trace) step(message, "done", node.id);
  }

  /** Records a lineage step for a message whose family is being traced (callers check first). */
  function step(message: Message, kind: TraceStepKind, node: string, extra?: Partial<TraceStep>): void {
    lineage.record(message.family, { t: time, kind, id: message.id, type: message.type, node, ...extra });
  }

  /** A message's journey ends at `node`: consumed ("end") or lost ("drop"). */
  function gone(node: Node, message: Message, kind: "end" | "drop", reason: string): void {
    inSystem--;
    message.family.alive--;
    if (message.family.trace) {
      step(message, kind, node.id, { reason });
      lineage.settle(message.family);
    }
  }

  /** A fan-out copy with its own id, in the same family (its parent keeps the original id). */
  function copy(node: Node, message: Message): Message {
    const next = { ...message, id: nextMessage++, attempts: 0 };
    inSystem++;
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

  function drop(node: Node, message: Message, reason: string): void {
    node.dropped++;
    log("drop", node, message, reason);
    gone(node, message, "drop", reason);
  }

  function accepts(edge: Edge, type: string): boolean {
    return acceptsType(edge.filter, type);
  }

  function rename(message: Message, type: string | undefined): Message {
    return type === undefined || type === message.type ? message : { ...message, type, color: messageColor(type) };
  }

  function latency(node: Node): number {
    if (!node.props.latencyMs) return 0;
    return node.props.latencyMs * (1 + (node.props.jitter ? (random() * 2 - 1) * node.props.jitter : 0));
  }

  function slots(node: Node): number {
    return node.role === "processor" ? node.activeReplicas * node.props.concurrency : node.props.concurrency;
  }

  function indexGroups(): void {
    groupsByConsumer.clear();
    for (const broker of nodes.values())
      for (const group of broker.groups)
        for (const id of group.members) {
          const memberships = groupsByConsumer.get(id) ?? [];
          memberships.push(group);
          groupsByConsumer.set(id, memberships);
        }
  }

  function refreshGroupLimit(group: Group): void {
    group.limit =
      group.edges[0].from.role === "queue"
        ? Infinity
        : group.members.reduce((sum, id) => {
            const target = nodes.get(id)!;
            return (
              sum + (group.allocations.get(id) ?? 0) * (target.role === "processor" ? target.props.concurrency : 1)
            );
          }, 0);
  }

  function assignReplicas(changed: Set<string>): void {
    const affected = new Set<Group>();
    const targets = new Set(changed);
    for (const id of changed) {
      const node = nodes.get(id)!;
      node.replicas = Math.max(1, Math.round(node.props.replicas * capacityMultiplier));
      for (const group of node.groups) affected.add(group);
      for (const group of groupsByConsumer.get(id) ?? []) affected.add(group);
    }
    for (const group of affected) {
      const broker = group.edges[0].from;
      group.allocations = allocateGroupReplicas(
        broker.role,
        broker.props.partitions,
        group.members.map((id) => {
          const node = nodes.get(id)!;
          return { id, role: node.role, replicas: node.replicas };
        }),
      );
      refreshGroupLimit(group);
      for (const id of group.members) targets.add(id);
    }
    for (const id of targets) {
      const node = nodes.get(id)!;
      const assigned = compiled.restricted.has(id)
        ? (groupsByConsumer.get(id) ?? []).reduce((max, group) => Math.max(max, group.allocations.get(id) ?? 0), 0)
        : node.replicas;
      node.activeReplicas = Math.min(node.replicas, assigned);
    }
  }

  function setNodePropsBatch(patches: Record<string, NodeSimProps>, multiplier?: number): void {
    const changed = new Set<string>(),
      limits = new Set<Group>();
    for (const [id, patch] of Object.entries(patches)) {
      const node = nodes.get(id);
      if (!node) continue;
      const previous = node.props;
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) Reflect.deleteProperty(node.rawProps, key);
        else node.rawProps[key] = structuredClone(value);
      }
      node.props = resolveProps(node.role, node.label, node.rawProps);
      if (
        Math.max(1, Math.round(node.props.replicas * capacityMultiplier)) !== node.replicas ||
        (isBroker(node) && node.props.partitions !== previous.partitions)
      )
        changed.add(id);
      if (node.props.concurrency !== previous.concurrency)
        for (const group of groupsByConsumer.get(id) ?? []) limits.add(group);
    }
    const next = resolveMultiplier(multiplier, capacityMultiplier);
    if (next !== capacityMultiplier) {
      capacityMultiplier = next;
      for (const node of nodes.values())
        if (Math.max(1, Math.round(node.props.replicas * next)) !== node.replicas) changed.add(node.id);
    }
    if (changed.size) assignReplicas(changed);
    for (const group of limits) refreshGroupLimit(group);
  }

  function takesShare(edge: Edge): boolean {
    return edge.share === undefined || edge.share >= 1 || (edge.share > 0 && random() < edge.share);
  }

  function travel(edge: Edge, message: Message, kind: ParticleKind, delivery?: Delivery, delay = 0): void {
    if (kind === "message" || kind === "dlq") message = rename(message, edge.emits);
    const visible = drawn < maxParticles;
    if (visible) drawn++;
    edge.active++;
    if (kind === "message" || kind === "dlq") edge.to.incoming++;
    const end = time + Math.max(STEP, edge.travelMs) + delay;
    trips.push({ id: nextParticle++, edge, message, kind, delivery, start: time, end, drawn: visible });
    if (message.family.trace) {
      const back = kind === "reply" || kind === "retry";
      step(message, "send", back ? edge.to.id : edge.from.id, { edge: edge.id, via: kind, until: end });
    }
  }

  function acknowledge(work: Work): void {
    if (work.delivery) {
      work.delivery.group.active--;
      work.delivery.group.activeByNode[work.delivery.edge.to.id]--;
    }
  }

  function reply(work: Work): void {
    if (work.via?.sync) travel(work.via, work.message, "reply");
  }

  function forward(node: Node, message: Message): void {
    if (node.role === "processor" || node.role === "none") {
      const emits = node.props.emits;
      const type =
        typeof emits === "string"
          ? emits
          : emits && Object.hasOwn(emits, message.type)
            ? emits[message.type]
            : emits?.["*"];
      message = rename(message, type);
    }
    const outgoing = node.outgoing.filter(
      (edge) => accepts(edge, message.type) && (node.role === "gateway" || takesShare(edge)),
    );
    // A node with nowhere to send (e.g. a final worker) is a terminal consumer, not a drop.
    if (!outgoing.length) {
      gone(node, message, "end", "consumed");
      return;
    }
    if (node.role === "gateway") {
      travel(outgoing[node.cursor++ % outgoing.length], { ...message, attempts: 0 }, "message");
    } else {
      const copies = fanOut(node, message, outgoing.length);
      outgoing.forEach((edge, i) => travel(edge, copies[i], "message"));
    }
  }

  function publish(node: Node, message: Message): void {
    processed(node, message);
    if (!node.groups.length) {
      // A queue without a consumer (including a DLQ queue) retains its backlog.
      node.pending.push({ message, remaining: 0 });
      message.family.parked++;
      if (message.family.trace) {
        step(message, "park", node.id);
        lineage.settle(message.family);
      }
      return;
    }
    const accepting = node.groups.filter((group) => group.edges.some((edge) => accepts(edge, message.type)));
    if (!accepting.length) {
      gone(node, message, "end", "no subscription accepts it");
      return;
    }
    const copies = fanOut(node, message, accepting.length);
    accepting.forEach((group, i) => group.pending.push(copies[i]));
  }

  function fail(node: Node, work: Work): void {
    node.failed++;
    log("fail", node, work.message, `attempt ${work.message.attempts + 1}`);
    if (work.message.family.trace) step(work.message, "fail", node.id, { attempt: work.message.attempts + 1 });
    if (work.delivery) {
      work.message.attempts++;
      log("retry", work.delivery.broker, work.message, `attempt ${work.message.attempts}`);
      if (work.message.family.trace && work.message.attempts < work.delivery.broker.props.maxDeliveryCount)
        step(work.message, "retry", work.delivery.broker.id, { attempt: work.message.attempts });
      if (node.props.retry === "inplace" && work.message.attempts < work.delivery.broker.props.maxDeliveryCount) {
        work.remaining = node.props.retryBackoffMs + latency(node);
        work.retained = true;
      } else
        travel(
          work.delivery.edge,
          work.message,
          "retry",
          work.delivery,
          work.message.attempts < work.delivery.broker.props.maxDeliveryCount ? node.props.retryBackoffMs : 0,
        );
    } else {
      reply(work);
      drop(node, work.message, node.status === "down" ? "node down" : "processing failed");
    }
  }

  function finish(node: Node, work: Work): void {
    if (node.status === "down") {
      if (work.delivery || node.role === "processor") fail(node, work);
      else {
        reply(work);
        drop(node, work.message, "node down");
      }
      return;
    }
    if (node.role === "processor" && random() < node.props.failureRate) {
      fail(node, work);
      return;
    }
    acknowledge(work);
    reply(work);
    if (isBroker(node)) {
      publish(node, work.message);
      return;
    }
    processed(node, work.message);
    if (work.injected && (node.role === "sink" || node.role === "store")) forward(node, work.message);
    else if (node.role === "sink") gone(node, work.message, "end", "received");
    else if (node.role === "store") {
      // Outgoing async edges from a store model change feeds / CDC: each gets a copy.
      const feeds = node.outgoing.filter((edge) => !edge.sync && accepts(edge, work.message.type) && takesShare(edge));
      if (!feeds.length) {
        gone(node, work.message, "end", "stored");
        return;
      }
      const copies = fanOut(node, work.message, feeds.length);
      feeds.forEach((edge, i) => travel(edge, copies[i], "message"));
    } else forward(node, work.message);
  }

  function arrive(node: Node, work: Work): void {
    if (node.status === "down") {
      finish(node, work);
      if (work.retained) node.working.push(work);
      return;
    }
    // Pausing a broker stops consumers pulling, not publishers appending to its log.
    if (isBroker(node)) {
      finish(node, work);
      return;
    }
    if (node.status === "paused") {
      node.pending.push(work);
      return;
    }
    if (node.role === "source" || node.role === "sink" || node.role === "none") {
      finish(node, work);
    } else node.pending.push(work);
  }

  function emit(node: Node, type: string, injected: boolean): void {
    const id = nextMessage++;
    const message = { id, type, color: messageColor(type), attempts: 0, family: { root: id, alive: 1, parked: 0 } };
    inSystem++;
    lineage.born(message.family, type, node.id);
    if (injected) log("inject", node, message);
    arrive(node, { message, remaining: latency(node), injected });
  }

  function returned(trip: Trip): void {
    const { broker, group } = trip.delivery!;
    group.active--;
    group.activeByNode[trip.edge.to.id]--;
    trip.message = { ...trip.delivery!.original, attempts: trip.message.attempts };
    if (trip.message.attempts >= broker.props.maxDeliveryCount) {
      if (broker.dlq && accepts(broker.dlq, trip.message.type)) {
        broker.deadLettered++;
        log("deadletter", broker, trip.message, `${trip.message.attempts} deliveries`);
        lineage.deadLettered(trip.message, broker.id, trip.message.attempts);
        travel(broker.dlq, trip.message, "dlq");
      } else drop(broker, trip.message, "delivery limit; no DLQ edge");
    } else group.pending.push(trip.message);
  }

  function pull(node: Node): void {
    if (node.status !== "up") return;
    for (const group of node.groups) {
      if (!group.pending.length) continue;
      while (group.pending.length && group.active < group.limit) {
        const message = group.pending.peek()!;
        let ready: Edge | undefined;
        for (let offset = 0; offset < group.edges.length; offset++) {
          const index = (group.cursor + offset) % group.edges.length;
          const edge = group.edges[index];
          const target = edge.to;
          if (
            accepts(edge, message.type) &&
            target.status === "up" &&
            target.working.length + target.incoming + target.pending.length < slots(target) &&
            (node.role === "queue" ||
              (group.activeByNode[target.id] ?? 0) <
                (group.allocations.get(target.id) ?? 0) * (target.role === "processor" ? target.props.concurrency : 1))
          ) {
            ready = edge;
            group.cursor = (index + 1) % group.edges.length;
            break;
          }
        }
        if (!ready) break;
        group.active++;
        group.activeByNode[ready.to.id] = (group.activeByNode[ready.to.id] ?? 0) + 1;
        group.pending.shift();
        travel(ready, message, "message", { broker: node, group, edge: ready, original: message });
      }
    }
  }

  function tick(): void {
    time += STEP;
    while (injections.length && injections[0].due <= time + 1e-8) {
      const batch = unschedule();
      emit(batch.node, batch.type, true);
      if (++batch.index < batch.count) {
        batch.due = batch.start + batch.index * batch.interval;
        schedule(batch);
      }
    }
    if (traffic)
      for (const node of nodes.values()) {
        if (node.role !== "source" || node.status !== "up") continue;
        node.trafficCredit += (node.props.ratePerSec * STEP) / (1000 * scale);
        const count = Math.floor(node.trafficCredit + 1e-10);
        node.trafficCredit -= count;
        for (let i = 0; i < count; i++) emit(node, node.props.messageType, false);
      }
    // Partition the array in place. Trips created by arrival callbacks are kept for later ticks.
    const tripCount = trips.length;
    let write = 0;
    for (let i = 0; i < tripCount; i++) {
      const trip = trips[i];
      if (trip.end > time) {
        trips[write++] = trip;
        continue;
      }
      trip.edge.active--;
      if (trip.drawn) drawn--;
      if (trip.kind === "retry") returned(trip);
      else if (trip.kind !== "reply") {
        trip.edge.delivered++;
        trip.edge.to.incoming--;
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
    for (let i = tripCount; i < trips.length; i++) trips[write++] = trips[i];
    trips.length = write;

    for (const node of nodes.values()) {
      // A sampled dot consumes scale messages of service budget, while keeping per-message latency.
      if (node.role === "processor" && scale > 1 && node.props.latencyMs > 0 && node.status === "up") {
        node.serviceCredit = Math.min(
          Math.max(1, slots(node) / scale),
          node.serviceCredit + (slots(node) * STEP) / (node.props.latencyMs * scale),
        );
      }
      if (node.status !== "paused") {
        let keep = 0;
        for (const work of node.working) {
          work.remaining -= STEP;
          if (work.remaining <= 0 || (node.status === "down" && !work.retained)) {
            work.retained = false;
            finish(node, work);
            if (work.retained) node.working[keep++] = work;
          } else node.working[keep++] = work;
        }
        node.working.length = keep;
        while (node.pending.length && (node.status === "down" || node.working.length < slots(node))) {
          // Brokers without consumers retain their messages until a new diagram is loaded.
          if (isBroker(node) && !node.groups.length) break;
          if (node.role === "processor" && scale > 1 && node.props.latencyMs > 0 && node.status === "up") {
            if (node.serviceCredit < 1 - 1e-9) break;
            node.serviceCredit -= 1;
          }
          const work = node.pending.shift()!;
          if (node.status === "down" || work.remaining <= 0 || isBroker(node) || node.role === "source") {
            finish(node, work);
            if (work.retained) node.working.push(work);
          } else {
            node.working.push(work);
            if (work.message.family.trace) step(work.message, "start", node.id);
          }
        }
      }
    }
    for (const node of nodes.values()) {
      if (isBroker(node)) pull(node);
      node.throughput += EWMA_ALPHA * ((node.completedThisStep * 1000) / STEP - node.throughput);
      node.completedThisStep = 0;
    }
  }

  function reset(): void {
    time = 0;
    accumulator = 0;
    inSystem = 0;
    drawn = 0;
    nextMessage = 1;
    nextParticle = 1;
    nextInjection = 1;
    trips = [];
    injections.length = 0;
    events.length = 0;
    eventHead = 0;
    randomCalls = 0;
    randomState = mulberry32(seed);
    lineage.reset();
    for (const node of nodes.values()) {
      node.pending.clear();
      node.working.length = 0;
      node.incoming = 0;
      node.cursor = 0;
      node.processed = 0;
      node.failed = 0;
      node.deadLettered = 0;
      node.dropped = 0;
      node.throughput = 0;
      node.completedThisStep = 0;
      node.trafficCredit = 0;
      node.serviceCredit = 0;
      for (const group of node.groups) {
        group.pending.clear();
        group.active = 0;
        group.cursor = 0;
        group.activeByNode = Object.create(null);
      }
    }
    for (const edge of edges) {
      edge.delivered = 0;
      edge.active = 0;
    }
  }

  lineage.setHistory(opts.traceHistory ?? 0);
  const engine: SimEngine = {
    tracer: lineage,
    checkpoint() {
      // structuredClone preserves the graph's shared/cyclic references. Deque methods are
      // reattached on restore; its queue contents and head are ordinary own properties.
      // Clone family identity with messages, but share recordings. Lineage copies a record on its
      // first write after capture, so finished history is never deep-cloned during playback.
      lineage.shareRecords();
      const cloneGraph = <T extends { lineage: typeof lineage.state }>(source: T): T => {
        const records = new Map([...source.lineage.store].map(([id, f]) => [id, f.trace]));
        let copy: T;
        try {
          // Synchronous, internal-only graph: omit records just for structuredClone's traversal.
          for (const family of source.lineage.store.values()) family.trace = undefined;
          copy = structuredClone(source);
        } finally {
          for (const [id, family] of source.lineage.store) family.trace = records.get(id);
        }
        for (const [id, family] of copy.lineage.store) family.trace = records.get(id);
        return copy;
      };
      const graph = cloneGraph({ nodes, edges, trips, injections, events, lineage: lineage.state });
      const clock = {
        time,
        accumulator,
        speed,
        traffic,
        drawn,
        nextMessage,
        nextParticle,
        nextInjection,
        inSystem,
        eventHead,
        seed,
        randomCalls,
        topology,
        scale,
        capacityMultiplier,
      };
      const token = Object.freeze({ time });
      checkpoints.set(token, () => {
        if (topology !== clock.topology) throw new Error("Checkpoint belongs to a previous diagram");
        const copy = cloneGraph(graph);
        nodes.clear();
        for (const [id, node] of copy.nodes) {
          Object.setPrototypeOf(node.pending, Deque.prototype);
          for (const group of node.groups) Object.setPrototypeOf(group.pending, Deque.prototype);
          nodes.set(id, node);
        }
        indexGroups();
        edges.splice(0, edges.length, ...copy.edges);
        trips = copy.trips;
        injections.splice(0, injections.length, ...copy.injections);
        events.splice(0, events.length, ...copy.events);
        lineage.state = copy.lineage;
        ({
          time,
          accumulator,
          speed,
          traffic,
          drawn,
          nextMessage,
          nextParticle,
          nextInjection,
          inSystem,
          eventHead,
          seed,
          randomCalls,
          scale,
          capacityMultiplier,
        } = clock);
        randomState = mulberry32((seed + Math.imul(randomCalls, 0x6d2b79f5)) >>> 0);
      });
      return token;
    },
    restore(checkpoint) {
      const restore = checkpoints.get(checkpoint);
      if (!restore) throw new Error("Checkpoint belongs to another engine");
      restore();
    },
    effectiveProps: (nodeId) => structuredClone(nodes.get(nodeId)?.rawProps ?? {}),
    metrics: () => ({ time, inSystem, pendingInjections: injections.length }),
    measure(metric) {
      if ("system" in metric) return inSystem;
      const node = nodes.get(metric.node);
      if (!node) return undefined;
      if (metric.field === "inFlight") return node.working.length;
      if (metric.field === "backlog") {
        let backlog = node.pending.length;
        for (const group of node.groups) backlog = Math.max(backlog, group.pending.length);
        return backlog;
      }
      if (metric.field === "lag") {
        if (metric.group !== undefined)
          return (
            node.groups.find((group) => group.name === metric.group)?.pending.length ??
            (node.role === "queue" && metric.group === "queue" && !node.groups.length ? node.pending.length : 0)
          );
        let lag = node.role === "queue" && !node.groups.length ? node.pending.length : 0;
        for (const group of node.groups) lag = Math.max(lag, group.pending.length);
        return lag;
      }
      return node[metric.field];
    },
    load(diagram: DiagramFile): void {
      topology++;
      nodes.clear();
      edges.length = 0;
      compiled = compileTopology(diagram, roleOf);
      for (const input of diagram.nodes) {
        const role = roleOf(input.stencil);
        const rawProps = { ...input.props };
        const status = rawProps.status === "paused" || rawProps.status === "down" ? rawProps.status : "up";
        nodes.set(input.id, {
          id: input.id,
          label: input.label,
          role,
          status,
          rawProps,
          props: resolveProps(role, input.label, rawProps),
          replicas: 1,
          activeReplicas: 1,
          outgoing: [],
          groups: [],
          pending: new Deque(),
          working: [],
          incoming: 0,
          cursor: 0,
          processed: 0,
          failed: 0,
          deadLettered: 0,
          dropped: 0,
          throughput: 0,
          completedThisStep: 0,
          trafficCredit: 0,
          serviceCredit: 0,
        });
      }
      const edgeById = new Map<string, Edge>();
      const deadLetter = deadLetterRoutes(compiled);
      for (const input of compiled.edges) {
        const from = nodes.get(input.from)!,
          to = nodes.get(input.to)!;
        const edge: Edge = { ...input, from, to, delivered: 0, active: 0 };
        edges.push(edge);
        edgeById.set(edge.id, edge);
        // The route the dead-letter check reads as effective (deadLetterRoutes, topology.ts).
        if (deadLetter.get(from.id) === input) from.dlq = edge;
        else if (!edge.dlq) from.outgoing.push(edge);
      }
      for (const [id, groups] of compiled.groups) {
        const node = nodes.get(id)!;
        node.groups = groups.map((group) => ({
          name: group.name,
          edges: group.edges.map((edge) => edgeById.get(edge.id)!),
          members: group.members,
          limit: 0,
          pending: new Deque(),
          active: 0,
          cursor: 0,
          allocations: new Map(),
          activeByNode: Object.create(null),
        }));
      }
      indexGroups();
      assignReplicas(new Set(nodes.keys()));
      traffic = false;
      speed = 1;
      reset();
    },
    step(dtMs: number): void {
      if (!Number.isFinite(dtMs) || dtMs <= 0) return;
      accumulator += dtMs * speed;
      const steps = Math.floor((accumulator + 1e-8) / STEP);
      accumulator = Math.max(0, accumulator - steps * STEP);
      for (let i = 0; i < steps; i++) tick();
    },
    frame() {
      const particles: Particle[] = [];
      for (const trip of trips)
        if (trip.drawn)
          particles.push({
            id: trip.id,
            edgeId: trip.edge.id,
            messageId: trip.message.id,
            rootId: trip.message.family.root,
            kind: trip.kind,
            progress: Math.min(1, Math.max(0, (time - trip.start) / (trip.end - trip.start))),
            type: trip.message.type,
            color: trip.message.color,
          });
      const nodeStates: Record<string, NodeSimState> = Object.create(null);
      for (const node of nodes.values()) {
        const lag: Record<string, number> = Object.create(null);
        let backlog = node.pending.length;
        for (const group of node.groups) {
          lag[group.name] = group.pending.length;
          backlog = Math.max(backlog, group.pending.length);
        }
        if (node.role === "queue" && !node.groups.length) lag.queue = backlog;
        nodeStates[node.id] = {
          id: node.id,
          role: node.role,
          status: node.status,
          backlog,
          lag,
          inFlight: node.working.length,
          processed: node.processed,
          failed: node.failed,
          deadLettered: node.deadLettered,
          dropped: node.dropped,
          throughput: node.throughput,
          replicas: node.replicas,
          activeReplicas: node.activeReplicas,
          idleReplicas: node.replicas - node.activeReplicas,
        };
      }
      return { time, particles, nodes: nodeStates, inSystem, scale };
    },
    snapshot(): SimSnapshot {
      const frame = engine.frame();
      const edgeStates: SimSnapshot["edges"] = Object.create(null);
      for (const edge of edges) edgeStates[edge.id] = { id: edge.id, delivered: edge.delivered, active: edge.active };
      const recent: SimEvent[] = [];
      for (let i = 0; i < events.length; i++) recent.push({ ...events[(eventHead + i) % events.length] });
      return { ...frame, edges: edgeStates, events: recent };
    },
    inject(nodeId, count, options = {}): void {
      const node = nodes.get(nodeId);
      if (!node || !Number.isFinite(count) || count < 1) return;
      count = Math.floor(count);
      const type = options.type ?? node.props.messageType;
      const spread = Number.isFinite(options.spreadMs) ? Math.max(0, options.spreadMs!) : 0;
      if (!spread || count === 1) for (let i = 0; i < count; i++) emit(node, type, true);
      else {
        emit(node, type, true);
        const interval = spread / (count - 1);
        schedule({ node, type, start: time, interval, index: 1, count, due: time + interval, order: nextInjection++ });
      }
    },
    setNodeStatus(nodeId: string, status: NodeStatus): void {
      const node = nodes.get(nodeId);
      if (!node || node.status === status) return;
      node.status = status;
      log("status", node, undefined, status);
    },
    setNodeProps(nodeId: string, patch: NodeSimProps): void {
      setNodePropsBatch({ [nodeId]: patch });
    },
    setNodePropsBatch,
    setScale(value): void {
      scale = resolveScale(value);
    },
    setCapacityMultiplier(value): void {
      setNodePropsBatch({}, value);
    },
    setTraffic(on: boolean): void {
      traffic = on;
    },
    setSpeed(value: number): void {
      if (Number.isFinite(value)) speed = Math.max(0.25, Math.min(8, value));
    },
    reset,
  };
  seedSetters.set(engine, (value) => {
    seed = value;
  });
  return engine;
}
