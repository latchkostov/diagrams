import { Deque } from "../deque";
import { hasServiceTime } from "../defaults";
import { triggerFits } from "../../model/kedaBindings";
import { STEP } from "../timing";
import { shareOut } from "../brokerDelivery";
import { deliveryGroup, type ResourceWork } from "../resourceWork";
import { sampledOwners } from "../sampledResources";
import { allocateGroupReplicas } from "../topology";
import type { BrokerMetric, ScalerTrigger } from "../keda";
import type { Lineage } from "../lineage";
import type { ParticleKind, SimEventKind, TraceStep, TraceStepKind } from "../types";
import {
  isBroker,
  resourceWork,
  type Node,
  type Group,
  type Work,
  type Message,
  type Delivery,
  type Edge,
  type Trip,
  type DeliveryPart,
} from "./model";

/** Synchronous broker ownership and dispatch; the facade keeps phase ordering. */
export function createBroker(
  nodes: Map<string, Node>,
  groupsByConsumer: Map<string, Group[]>,
  metricGroups: Map<string, Map<string, Group>>,
  lineage: Lineage,
  scale: () => number,
  capacityMultiplier: () => number,
  restricted: (id: string) => boolean,
  dotsOf: (message?: { represented?: number }) => number,
  sizeOf: (message?: { represented?: number }) => number,
  settled: (value: number) => number,
  threadOccupancy: (node: Node) => number,
  slots: (node: Node) => number,
  scheduleWork: (node: Node, work: Work, destination: "working" | "pending" | "takeovers") => void,
  enqueue: (node: Node, work: Work) => void,
  accepts: (edge: Edge, message: Message, fanout?: boolean, injected?: boolean) => boolean,
  cut: (edge: Edge) => boolean,
  processed: (node: Node, message: Message) => void,
  step: (message: Message, kind: TraceStepKind, node: string, extra?: Partial<TraceStep>) => void,
  gone: (
    node: Node,
    message: Message,
    kind: "end" | "drop" | "block" | "reject",
    reason: string,
    extra?: Partial<TraceStep>,
  ) => void,
  fanOut: (node: Node, message: Message, count: number) => Message[],
  copy: (node: Node, message: Message) => Message,
  block: (message: Message, edge: Edge, extra?: Partial<TraceStep>) => void,
  log: (kind: SimEventKind, node: Node, message?: Message, detail?: string) => void,
  deliver: (
    edge: Edge,
    message: Message,
    kind: "message" | "dlq",
    delivery?: Delivery,
    extra?: Partial<TraceStep>,
  ) => void,
  drop: (node: Node, message: Message, reason: string, via?: Edge, timeoutOrigin?: string) => void,
  travel: (
    edge: Edge,
    message: Message,
    kind: ParticleKind,
    delivery?: Delivery,
    delay?: number,
    code?: number,
    extra?: Partial<TraceStep>,
  ) => void,
) {
  /** A delivery waits at the node for one of its group's slots there. */
  function stage(group: Group, node: Node, work: Work): void {
    let queue = group.staged.get(node.id);
    if (!queue) group.staged.set(node.id, (queue = new Deque()));
    queue.push(work);
    node.staged++;
    node.stagedUnits += work.queuedUnits = dotsOf(work.message);
  }

  function indexGroups(): void {
    groupsByConsumer.clear();
    metricGroups.clear();
    for (const broker of nodes.values()) metricGroups.set(broker.id, new Map(broker.groups.map((g) => [g.name, g])));
    for (const broker of nodes.values())
      for (const group of broker.groups)
        for (const id of group.members) {
          const memberships = groupsByConsumer.get(id) ?? [];
          memberships.push(group);
          groupsByConsumer.set(id, memberships);
        }
  }

  function readBrokerMetric(trigger: ScalerTrigger): BrokerMetric | undefined {
    if (trigger.type === "http") return undefined;
    const broker = nodes.get(trigger.source.node);
    if (!broker || broker.status !== "up" || !isBroker(broker) || !triggerFits(trigger.type, broker.stencil)) return;
    const group = metricGroups.get(broker.id)?.get(trigger.source.group ?? "queue");
    if (!group)
      return broker.role === "queue" && !broker.groups.length
        ? { pending: broker.pendingUnits * scale(), outstanding: 0 }
        : undefined;
    return {
      pending: group.pendingUnits * scale(),
      outstanding: group.active * scale(),
      ...(trigger.type === "kafka" ? { partitions: broker.props.partitions } : {}),
    };
  }

  /**
   * How many deliveries may be outstanding (travelling, waiting or in work) against `units` slots of `target`, over
   * an edge that takes `travelMs`. A delivery takes its slot when it arrives, not when it leaves the broker: the
   * slots themselves, plus enough on the way to keep them busy (units × travel ÷ service time, rounded up), plus a
   * prefetch of one so jitter doesn't leave a slot idle. So travel time animates but never limits throughput, and a
   * consumer drains at the rate capacity analysis reports. A target that finishes on arrival (a broker, a sink) or a
   * 0 ms store or gateway is never the limit.
   */
  function outstanding(units: number, target: Node, travelMs: number): number {
    if (!(units > 0)) return 0;
    const processor = target.role === "processor";
    // Only processors, stores and gateways work on what arrives; the rest (sinks, brokers, decorative nodes) finish
    // on arrival whatever latency they have saved, so they never limit a delivery.
    const works = hasServiceTime(target.role);
    if (units === Infinity || !works || (!processor && !(target.props.latencyMs > 0))) return Infinity;
    // Real requests, as at scale 1: a processor works on its slots' real requests at a time, so only that many (and
    // what's on the way to them) are held for it, whatever the dot size; the rest is lag at the broker, and a dot
    // larger than the room is delivered in part. A store or gateway serves a sampled dot as one message, so its
    // window is in dots. A 0 ms service is paced as one tick, so a burst can't pull a whole backlog onto the edge.
    const service = processor ? Math.max(STEP, target.props.latencyMs) : target.props.latencyMs;
    const window = Math.ceil(units) + Math.ceil((units * Math.max(STEP, travelMs)) / service) + 1;
    return processor ? window : window * scale();
  }

  /**
   * Real requests of a dot of `size` to deliver into `room` (0: none). A dot that overshoots the room by less than
   * one real request goes whole, as scale 1 delivers a message whenever the window has room; a larger one is split
   * at the room, but never into a part, or a queued remainder, of less than one real request.
   */
  function deliverable(size: number, room: number): number {
    if (room <= 1e-9) return 0;
    if (size - room < 1 - 1e-9) return size;
    return size < 2 ? 0 : Math.min(size - 1, Math.max(1, room));
  }

  /** Real requests outstanding against a target's prefetch window: in work, on the way, queued or staged there. */
  function outstandingAt(target: Node): number {
    return (threadOccupancy(target) + target.incomingUnits + target.pendingUnits + target.stagedUnits) * scale();
  }

  /** The longest travel time to each consumer over a group's routes, deny rules aside: indexed once per load. */
  function travelByConsumer(routes: readonly { to: string; deny: boolean; travelMs: number }[]): Map<string, number> {
    const travel = new Map<string, number>();
    for (const edge of routes) if (!edge.deny) travel.set(edge.to, Math.max(travel.get(edge.to) ?? 0, edge.travelMs));
    return travel;
  }

  function refreshGroupLimit(group: Group): void {
    if (!group.edges[0].from.props.broker?.partitioned) {
      group.limit = Infinity;
      return;
    }
    group.limit = group.members.reduce((sum, id) => {
      const target = nodes.get(id)!;
      const units = (group.allocations.get(id) ?? 0) * (target.role === "processor" ? target.props.concurrency : 1);
      return sum + outstanding(units, target, group.travelTo.get(id) ?? 0);
    }, 0);
  }

  function assignReplicas(changed: Set<string>): void {
    const affected = new Set<Group>();
    const targets = new Set(changed);
    for (const id of changed) {
      const node = nodes.get(id)!;
      node.replicas = node.fleet?.ready ?? Math.max(1, Math.round(node.props.replicas * capacityMultiplier()));
      for (const group of node.groups) affected.add(group);
      for (const group of groupsByConsumer.get(id) ?? []) affected.add(group);
    }
    for (const id of changed) {
      const node = nodes.get(id)!;
      if (!node.fleet) {
        for (const group of groupsByConsumer.get(id) ?? []) group.drainOwners.delete(id);
        continue;
      }
      const owners = new Map<Group, Set<number>>();
      const sampled = new Map<Group, ResourceWork[]>();
      for (const work of resourceWork(node)) {
        const group = deliveryGroup(work);
        if (!group) continue;
        if (work.cpuParts?.length) {
          const owned = sampled.get(group) ?? [];
          owned.push(work);
          sampled.set(group, owned);
        }
        if (work.replica === undefined || node.fleet.busy.get(work.replica)?.drainAt === undefined) continue;
        const pods = owners.get(group) ?? new Set<number>();
        pods.add(work.replica);
        owners.set(group, pods);
      }
      for (const group of groupsByConsumer.get(id) ?? [])
        group.drainOwners.set(id, (owners.get(group)?.size ?? 0) + sampledOwners(sampled.get(group) ?? []));
    }
    for (const group of affected) {
      const broker = group.edges[0].from;
      group.allocations = allocateGroupReplicas(
        broker.role,
        Math.max(0, broker.props.partitions - [...group.drainOwners.values()].reduce((sum, count) => sum + count, 0)),
        group.members.map((id) => {
          const node = nodes.get(id)!;
          return { id, role: node.role, replicas: node.replicas };
        }),
        broker.props.broker?.partitioned ?? false,
      );
      refreshGroupLimit(group);
      for (const id of group.members) targets.add(id);
    }
    // More slots for a group: what's staged at its consumers starts now.
    for (const group of affected) drainStaged(group);
    for (const id of targets) {
      const node = nodes.get(id)!;
      const assigned = restricted(id)
        ? (groupsByConsumer.get(id) ?? []).reduce((max, group) => Math.max(max, group.allocations.get(id) ?? 0), 0)
        : node.replicas;
      node.activeReplicas = Math.min(node.replicas, assigned);
    }
  }

  /** Slots a partitioned group may fill at `node`: its assignment. Queues and subscription fan-out use the node pool. */
  function groupUnits(group: Group, node: Node): number {
    if (!group.edges[0].from.props.broker?.partitioned) return Infinity;
    return (
      ((group.allocations.get(node.id) ?? 0) + (group.drainOwners.get(node.id) ?? 0)) *
      (node.role === "processor" ? node.props.concurrency : 1)
    );
  }

  /**
   * A delivery that arrives takes one of its group's slots at the node and waits its turn there, or, with every one
   * of them taken, is staged until one frees. Deliveries travel ahead of time (see outstanding), but a group never
   * works on more than its partitions allow, even on a consumer with free slots from other inputs.
   */
  function admit(node: Node, work: Work): void {
    const group = work.delivery?.group;
    if (group && !work.held && !hold(group, node, work)) {
      if (work.resumeAtAdmission) node.takeovers = node.takeovers.filter((entry) => entry !== work);
      work.resumeAtAdmission = false;
      stage(group, node, work);
      return;
    }
    scheduleWork(node, work, "pending");
  }

  /**
   * Takes one of the group's slots at `node` for `work` if one is free. Never stages behind nothing: a live
   * reassignment can leave a group no slots at a node while deliveries are on their way to it.
   */
  function hold(group: Group, node: Node, work: Work): boolean {
    if (node.fleet && groupUnits(group, node) <= 0) return false;
    const held = group.heldByNode.get(node.id) ?? 0;
    if (held > 0 && held >= groupUnits(group, node)) return false;
    group.heldByNode.set(node.id, held + 1);
    work.held = true;
    return true;
  }

  /** The work leaves the node (done, or failed back to its broker): its group slot goes to the next staged one. */
  function release(work: Work): void {
    if (!work.held) return;
    work.held = false;
    const { group, edge } = work.delivery!;
    group.heldByNode.set(edge.to.id, (group.heldByNode.get(edge.to.id) ?? 1) - 1);
    unstage(group, edge.to);
  }

  /** Staged deliveries of `group` at `node` join its queue, in arrival order, while the group has slots there. */
  function unstage(group: Group, node: Node): void {
    const waiting = group.staged.get(node.id);
    while (waiting?.length && hold(group, node, waiting.peek()!)) {
      const work = waiting.shift()!;
      node.stagedUnits = --node.staged ? node.stagedUnits - work.queuedUnits! : 0;
      enqueue(node, work);
    }
  }

  function drainStaged(group: Group): void {
    for (const id of group.members) unstage(group, nodes.get(id)!);
  }

  /** A broker keeps ownership until acknowledgement; its prefetch budget follows occupied threads. */
  function suspendDelivery(work: Work): void {
    const d = work.delivery;
    if (!d || d.offThread) return;
    d.offThread = true;
    d.group.offThread += d.units;
    d.group.offByNode.set(d.edge.to.id, (d.group.offByNode.get(d.edge.to.id) ?? 0) + d.units);
  }

  function wakeDelivery(work: Work): void {
    const d = work.delivery;
    if (!d?.offThread) return;
    d.offThread = false;
    d.group.offThread = settled(d.group.offThread - d.units);
    d.group.offByNode.set(d.edge.to.id, settled((d.group.offByNode.get(d.edge.to.id) ?? d.units) - d.units));
  }

  /** A delivery left its consumer (acknowledged, or on its way back): its dots leave the group's counters. */
  function settleDelivery(d: Delivery): void {
    d.group.active = settled(d.group.active - d.units);
    d.group.activeByNode[d.edge.to.id] = settled((d.group.activeByNode[d.edge.to.id] ?? d.units) - d.units);
  }

  function publish(node: Node, message: Message): void {
    processed(node, message);
    if (!node.groups.length) {
      // A queue without a consumer (including a DLQ queue) retains its backlog.
      enqueue(node, { message, remaining: 0 });
      message.family.parked++;
      if (message.family.trace) {
        step(message, "park", node.id);
        lineage.settle(message.family);
      }
      return;
    }
    const accepting = node.groups.filter((group) => group.edges.some((edge) => accepts(edge, message)));
    if (!accepting.length) {
      gone(node, message, "end", "no subscription accepts it");
      return;
    }
    const copies = fanOut(node, message, accepting.length);
    accepting.forEach((group, i) => {
      group.pending.push(copies[i]);
      group.pendingUnits += dotsOf(copies[i]);
    });
  }

  function returned(trip: Trip): void {
    const { broker, group } = trip.delivery!;
    settleDelivery(trip.delivery!);
    trip.message = {
      ...trip.delivery!.original,
      attempts: trip.message.attempts,
      // A partial dot (a throttle split's admitted part) is redelivered at its own size.
      represented: trip.message.represented,
      workMs: trip.message.workMs,
      travelMs: trip.message.travelMs,
      requested: trip.message.requested,
    };
    if (trip.message.attempts >= broker.props.maxDeliveryCount) {
      // A denied dead-letter route blocks the message at the broker: on purpose, so not dead-lettered either.
      if (broker.dlq?.deny && accepts(broker.dlq, trip.message)) block(trip.message, broker.dlq);
      else if (broker.dlq && accepts(broker.dlq, trip.message)) {
        broker.deadLettered += dotsOf(trip.message);
        log("deadletter", broker, trip.message, `${trip.message.attempts} deliveries`);
        lineage.deadLettered(trip.message, broker.id, trip.message.attempts);
        deliver(broker.dlq, trip.message, "dlq");
      } else drop(broker, trip.message, "delivery limit; no DLQ edge");
    } else {
      group.pending.push(trip.message);
      group.pendingUnits += dotsOf(trip.message);
    }
  }

  /** Real requests `edge`'s consumer can still take from `group`: its prefetch window, and its partitions'. */
  function consumerRoom(broker: Node, group: Group, edge: Edge): number {
    const target = edge.to;
    const room = outstanding(slots(target), target, edge.travelMs) - outstandingAt(target);
    if (!broker.props.broker?.partitioned) return room;
    const units =
      (group.allocations.get(target.id) ?? 0) * (target.role === "processor" ? target.props.concurrency : 1);
    return Math.min(
      room,
      outstanding(units, target, edge.travelMs) -
        ((group.activeByNode[target.id] ?? 0) - (group.offByNode.get(target.id) ?? 0)) * scale(),
    );
  }

  /**
   * Where the dot at the front of `group` goes now: parts by connection, in real requests. Routes take turns from the
   * group's cursor, as at scale 1, and the cursor moves past the last that took a part.
   *
   * A deny rule delivers nothing and reserves no slot, so it's decided first: when it's the next ready route the dot
   * goes to it whole, whatever the consumers' or the group's room (as on master). Otherwise the next consumers with
   * room in turn (at most one per real request, up to the next deny rule, whose turn comes with the next dot) share
   * the dot out (shareOut): equal parts capped by each route's room, what none has room for staying queued. A route's
   * room is its consumer's prefetch window over that route (it depends on the route's travel time), as on master:
   * parallel routes to one consumer each have their own (sharing one is a known gap, docs/backlog). The consumers
   * share the group's room. Each part, and a remainder left queued, keeps at least one real request (see
   * deliverable); a dot of less than two goes whole to the next consumer with room, as every dot does at scale 1.
   */
  function planDelivery(broker: Node, group: Group, message: Message): DeliveryPart[] {
    const size = sizeOf(message),
      count = group.edges.length;
    const groupRoom = group.limit - (group.active - group.offThread) * scale();
    const rooms = new Map<Edge, number>();
    const roomOf = (edge: Edge) => {
      let room = rooms.get(edge);
      if (room === undefined)
        rooms.set(edge, (room = Math.max(0, Math.min(groupRoom, consumerRoom(broker, group, edge)))));
      return room;
    };
    const most = size < 2 ? 1 : Math.floor(size + 1e-9);
    const picked: DeliveryPart[] = [];
    for (let offset = 0; offset < count && picked.length < most; offset++) {
      const index = (group.cursor + offset) % count;
      const edge = group.edges[index];
      if (cut(edge) || !accepts(edge, message)) continue;
      if (edge.deny) {
        if (picked.length) break;
        return [{ index, edge, part: size }];
      }
      if (edge.to.status !== "up") continue;
      const room = roomOf(edge);
      if (size < 2 ? !deliverable(size, room) : room <= 1e-9) continue;
      picked.push({ index, edge, part: 0 });
    }
    if (!picked.length) return [];
    if (size < 2) {
      picked[0].part = deliverable(size, roomOf(picked[0].edge));
      return picked;
    }
    let capacity = 0;
    for (const p of picked) capacity += roomOf(p.edge);
    const total = deliverable(size, Math.min(capacity, groupRoom));
    if (!total) return [];
    // One recipient takes it all: deliverable already allows its overshoot of less than one real request.
    if (picked.length === 1) {
      picked[0].part = total;
      return picked;
    }
    const { parts, left } = shareOut(
      total,
      picked.map((p) => roomOf(p.edge)),
    );
    picked.forEach((p, i) => (p.part = parts[i]));
    // No room took a whole request: the roomiest consumer takes it, overshooting by less than one, as one would.
    if (left >= total - 1e-9) {
      const roomiest = picked.reduce((a, b) => (roomOf(b.edge) > roomOf(a.edge) ? b : a));
      if (total - roomOf(roomiest.edge) < 1 - 1e-9) roomiest.part = total;
    }
    // A sliver no window has room for rides with the largest part rather than stay queued alone.
    else if (left > 1e-9 && (left < 1 - 1e-9 || size - (total - left) < 1 - 1e-9)) {
      const largest = picked.reduce((a, b) => (b.part > a.part ? b : a));
      largest.part += left;
    }
    return picked.filter((p) => p.part > 0);
  }

  function pull(node: Node): void {
    if (node.status !== "up") return;
    for (const group of node.groups) {
      while (group.pending.length) {
        const message = group.pending.peek()!;
        const size = sizeOf(message);
        const parts = planDelivery(node, group, message);
        if (!parts.length) break;
        const total = parts.reduce((sum, p) => sum + p.part, 0);
        if (total >= size - 1e-9) group.pending.shift();
        for (const p of parts) {
          const whole = p.part >= sizeOf(message) - 1e-9;
          const delivered = whole
            ? message
            : { ...copy(node, message), attempts: message.attempts, represented: p.part };
          if (!whole) message.represented = sizeOf(message) - p.part;
          group.pendingUnits = settled(group.pendingUnits - dotsOf(delivered));
          if (p.edge.deny) {
            deliver(p.edge, delivered, "message");
            continue;
          }
          const units = dotsOf(delivered);
          group.active += units;
          group.activeByNode[p.edge.to.id] = (group.activeByNode[p.edge.to.id] ?? 0) + units;
          travel(p.edge, delivered, "message", { broker: node, group, edge: p.edge, original: delivered, units });
        }
        group.cursor = (parts.at(-1)!.index + 1) % group.edges.length;
        if (total < size - 1e-9) break;
      }
    }
  }
  return [
    stage,
    indexGroups,
    readBrokerMetric,
    travelByConsumer,
    refreshGroupLimit,
    assignReplicas,
    admit,
    hold,
    release,
    suspendDelivery,
    wakeDelivery,
    settleDelivery,
    publish,
    returned,
    pull,
    drainStaged,
  ] as const;
}
