import type { DiagramFile, SimRole } from "../model/types";
import { stencilRole } from "../stencils/roles";
import { messageColor } from "./colors";
import { resolveProps, type ResolvedProps } from "./defaults";
import { Deque } from "./deque";
import { mulberry32 } from "./rng";
import { allocateReplicas, isDlqEdge } from "./topology";
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
} from "./types";

const STEP = 10;
const EWMA_ALPHA = 1 - Math.exp(-STEP / 1000);
const EVENT_CAP = 200;

interface Message {
  id: number;
  type: string;
  color: string;
  attempts: number;
}
interface Group {
  name: string;
  edges: Edge[];
  pending: Deque<Message>;
  active: number;
  cursor: number;
  allocations: Map<string, number>;
  activeByNode: Record<string, number>;
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
  const checkpoints = new WeakMap<EngineCheckpoint, () => void>();
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
  }

  function drop(node: Node, message: Message, reason: string): void {
    node.dropped++;
    inSystem--;
    log("drop", node, message, reason);
  }

  function accepts(edge: Edge, type: string): boolean {
    return (
      edge.filter === undefined ||
      edge.filter.some((pattern) => (pattern.endsWith("*") ? type.startsWith(pattern.slice(0, -1)) : type === pattern))
    );
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

  function assignReplicas(): void {
    const assigned = new Map<string, number>();
    const restricted = new Set<string>();
    const unrestricted = new Set<string>();
    for (const node of nodes.values())
      node.replicas = Math.max(1, Math.round(node.props.replicas * capacityMultiplier));
    for (const edge of edges) {
      if (edge.dlq) continue;
      if (edge.from.role === "topic" || edge.from.role === "stream") restricted.add(edge.to.id);
      else unrestricted.add(edge.to.id);
    }
    for (const broker of nodes.values())
      for (const group of broker.groups) {
        group.allocations = allocateReplicas(
          group.edges.map((edge) => ({
            id: edge.to.id,
            replicas: edge.to.role === "processor" ? edge.to.replicas : broker.props.partitions,
          })),
          broker.role === "queue"
            ? group.edges.reduce((sum, edge) => sum + edge.to.replicas, 0)
            : broker.props.partitions,
        );
        for (const [id, count] of group.allocations) assigned.set(id, Math.max(assigned.get(id) ?? 0, count));
      }
    for (const node of nodes.values())
      node.activeReplicas =
        restricted.has(node.id) && !unrestricted.has(node.id)
          ? Math.min(node.replicas, assigned.get(node.id) ?? 0)
          : node.replicas;
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
    trips.push({
      id: nextParticle++,
      edge,
      message,
      kind,
      delivery,
      start: time,
      end: time + Math.max(STEP, edge.travelMs) + delay,
      drawn: visible,
    });
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
      inSystem--;
      return;
    }
    if (node.role === "gateway") {
      travel(outgoing[node.cursor++ % outgoing.length], { ...message, attempts: 0 }, "message");
    } else {
      inSystem += outgoing.length - 1;
      for (const edge of outgoing) travel(edge, { ...message, attempts: 0 }, "message");
    }
  }

  function publish(node: Node, message: Message): void {
    processed(node, message);
    if (!node.groups.length) {
      // A queue without a consumer (including a DLQ queue) retains its backlog.
      node.pending.push({ message, remaining: 0 });
      return;
    }
    const accepting = node.groups.filter((group) => group.edges.some((edge) => accepts(edge, message.type)));
    inSystem += accepting.length - 1;
    for (const group of accepting) group.pending.push({ ...message, attempts: 0 });
  }

  function fail(node: Node, work: Work): void {
    node.failed++;
    log("fail", node, work.message, `attempt ${work.message.attempts + 1}`);
    if (work.delivery) {
      work.message.attempts++;
      log("retry", work.delivery.broker, work.message, `attempt ${work.message.attempts}`);
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
    else if (node.role === "sink") inSystem--;
    else if (node.role === "store") {
      // Outgoing async edges from a store model change feeds / CDC: each gets a copy.
      const feeds = node.outgoing.filter((edge) => !edge.sync && accepts(edge, work.message.type) && takesShare(edge));
      if (!feeds.length) {
        inSystem--;
        return;
      }
      inSystem += feeds.length - 1;
      for (const edge of feeds) travel(edge, { ...work.message, attempts: 0 }, "message");
    } else forward(node, work.message);
  }

  function arrive(node: Node, work: Work): void {
    if (node.status === "down") {
      finish(node, work);
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
    const message = { id: nextMessage++, type, color: messageColor(type), attempts: 0 };
    inSystem++;
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
        travel(broker.dlq, trip.message, "dlq");
      } else drop(broker, trip.message, "delivery limit; no DLQ edge");
    } else group.pending.push(trip.message);
  }

  function pull(node: Node): void {
    if (node.status !== "up") return;
    for (const group of node.groups) {
      const limit =
        node.role === "queue"
          ? Infinity
          : [...new Map(group.edges.map((edge) => [edge.to.id, edge])).values()].reduce(
              (sum, edge) =>
                sum +
                (group.allocations.get(edge.to.id) ?? 0) *
                  (edge.to.role === "processor" ? edge.to.props.concurrency : 1),
              0,
            );
      while (group.pending.length && group.active < limit) {
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
          } else node.working.push(work);
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

  const engine: SimEngine = {
    checkpoint() {
      // structuredClone preserves the graph's shared/cyclic references. Deque methods are
      // reattached on restore; its queue contents and head are ordinary own properties.
      const graph = structuredClone({ nodes, edges, trips, injections, events });
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
        const copy = structuredClone(graph);
        nodes.clear();
        for (const [id, node] of copy.nodes) {
          Object.setPrototypeOf(node.pending, Deque.prototype);
          for (const group of node.groups) Object.setPrototypeOf(group.pending, Deque.prototype);
          nodes.set(id, node);
        }
        edges.splice(0, edges.length, ...copy.edges);
        trips = copy.trips;
        injections.splice(0, injections.length, ...copy.injections);
        events.splice(0, events.length, ...copy.events);
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
      const inputById = new Map(diagram.nodes.map((node) => [node.id, node]));
      const edgeIds = new Set<string>();
      for (const input of diagram.edges) {
        const from = nodes.get(input.from),
          to = nodes.get(input.to);
        if (!from || !to || edgeIds.has(input.id)) continue;
        edgeIds.add(input.id);
        const target = inputById.get(input.to)!;
        const dlq = isDlqEdge(input, from.role, target, to.role);
        const value = input.props?.travelMs;
        const edge: Edge = {
          id: input.id,
          from,
          to,
          sync: input.kind === "sync",
          dlq,
          travelMs:
            typeof value === "number" && Number.isFinite(value)
              ? Math.max(0, value)
              : input.kind === "sync"
                ? 450
                : 900,
          share:
            typeof input.props?.share === "number" && Number.isFinite(input.props.share)
              ? Math.max(0, Math.min(1, input.props.share))
              : undefined,
          filter: Array.isArray(input.props?.filter)
            ? input.props.filter.filter((value): value is string => typeof value === "string")
            : undefined,
          emits: typeof input.props?.emits === "string" ? input.props.emits : undefined,
          groupName: typeof input.props?.group === "string" ? input.props.group : input.id,
          delivered: 0,
          active: 0,
        };
        edges.push(edge);
        // Only brokers and processors have a separate dead-letter path.
        if (dlq && (isBroker(from) || from.role === "processor")) from.dlq ??= edge;
        else from.outgoing.push(edge);
      }
      for (const node of nodes.values()) {
        if (!isBroker(node)) continue;
        const byGroup = new Map<string, Group>();
        for (const edge of node.outgoing) {
          const name = node.role === "queue" ? "queue" : edge.groupName;
          let group = byGroup.get(name);
          if (!group) {
            group = {
              name,
              edges: [],
              pending: new Deque(),
              active: 0,
              cursor: 0,
              allocations: new Map(),
              activeByNode: Object.create(null),
            };
            byGroup.set(name, group);
            node.groups.push(group);
          }
          group.edges.push(edge);
        }
      }
      assignReplicas();
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
      const node = nodes.get(nodeId);
      if (!node) return;
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) Reflect.deleteProperty(node.rawProps, key);
        else node.rawProps[key] = structuredClone(value);
      }
      node.props = resolveProps(node.role, node.label, node.rawProps);
      assignReplicas();
    },
    setScale(value): void {
      scale = resolveScale(value);
    },
    setCapacityMultiplier(value): void {
      capacityMultiplier = resolveMultiplier(value, capacityMultiplier);
      assignReplicas();
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
