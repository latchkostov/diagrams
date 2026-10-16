// Workload: an event-driven pipeline (docs/BENCHMARKS.md § Workloads). Lanes of twelve nodes: a producer publishes to
// an ingest topic; an enricher (its own consumer group) republishes to an output topic read by two groups; one feeds
// a work queue with competing workers and a dead-letter queue (some DLQs have a replayer, some are left unread, so
// the dead-letter and no-reader checks have work), the other writes a store. Some lanes read a neighbour's topic
// (fan-in). Four lanes per domain boundary. Two saved simulations: steady traffic at every producer, and an incident
// (a spike, workers going down and coming back, with expectations). Exactly `n` nodes.

import type { DiagramFile, DiagramNode, Simulation } from "../../model/types";
import { autoScale } from "../../sim/scale";
import { blockGrid, Builder, rand } from "./common";

const PRODUCERS = ["client.iot", "generic.webhook", "service.go", "client.mobile"];
const OUT_TOPICS = ["kafka.topic", "aws.sns", "azure.service-bus.topic"];
const QUEUES = ["aws.sqs", "azure.service-bus.queue", "rabbitmq.queue"];
const WORKERS = ["aws.lambda", "azure.functions", "service.dotnet"];
const STORES = ["postgres", "aws.dynamodb", "aws.s3"];
const READ_STORES = ["snowflake", "elasticsearch", "redis.cache"];
const SINKS = ["generic.email", "slack", "grafana"];
const TONES = ["k8s", "aws", "azure", "gcp", "onprem", "neutral"] as const;

export const LANE = 12;
const LANES_PER_DOMAIN = 4;
const COL = 300;
const ROW = 120;
const LANE_PITCH = 2 * ROW + 60;

/** Stage → [column, row within the lane]. */
const AT: [number, number][] = [
  [0, 0], // producer
  [1, 0], // ingest topic
  [2, 0], // enricher
  [3, 0], // output topic
  [4, 0], // consumer A
  [4, 1], // consumer B
  [5, 0], // queue
  [6, 0], // worker
  [6, 1], // DLQ
  [7, 0], // store
  [5, 1], // read store
  [7, 1], // DLQ replayer or sink
];

interface Lane {
  producer: DiagramNode;
  ingest: DiagramNode;
  out: DiagramNode;
  consumerB: DiagramNode;
  worker: DiagramNode;
  dlq: DiagramNode;
}

export function eventPipeline(n: number, seed = 23): DiagramFile {
  if (n < LANE) throw new Error(`eventPipeline needs at least ${LANE} nodes`);
  const r = rand(seed);
  const b = new Builder();
  const laneCount = Math.floor(n / LANE);
  const domainCount = Math.ceil(laneCount / LANES_PER_DOMAIN);
  const grid = blockGrid(domainCount, 1.2);
  const pitch = { x: 8 * COL + 420, y: LANES_PER_DOMAIN * LANE_PITCH + 200 };
  const lanes: Lane[] = [];

  for (let d = 0; d < domainCount; d++) {
    const [gx, gy] = grid[d];
    const members: DiagramNode[] = [];
    for (let k = 0; k < LANES_PER_DOMAIN; k++) {
      const l = d * LANES_PER_DOMAIN + k;
      if (l >= laneCount) break;
      const ox = gx * pitch.x;
      const oy = gy * pitch.y + k * LANE_PITCH + 60;
      const tag = `l${l + 1}`;
      const at = (stage: number) => ({ x: ox + AT[stage][0] * COL, y: oy + AT[stage][1] * ROW });
      const node = (stage: number, id: string, stencil: string, label: string, extra: Partial<DiagramNode> = {}) =>
        b.node({ id: `${tag}-${id}`, stencil, label, ...at(stage), ...extra });
      const queueKind = r.pick(QUEUES);
      const producer = node(0, "producer", r.pick(PRODUCERS), `Producer ${l + 1}`, {
        props: { ratePerSec: r.int(2, 20), messageType: `Event${(l % 7) + 1}` },
      });
      const ingest = node(1, "ingest", "kafka.topic", `ingest.${l + 1}.v1`, {
        sublabel: "raw events",
        props: { partitions: r.pick([6, 12, 24]) },
      });
      const enrich = node(2, "enrich", "service.java", `Enricher ${l + 1}`, {
        props: { replicas: r.int(1, 4), concurrency: 8, latencyMs: r.int(10, 80) },
      });
      const out = node(3, "out", r.pick(OUT_TOPICS), `enriched.${l + 1}.v1`, {
        props: { partitions: r.pick([6, 12, 24]) },
      });
      const consumerA = node(4, "router", "service.node", `Router ${l + 1}`, {
        props: { replicas: r.int(1, 3), concurrency: 4, latencyMs: r.int(10, 60) },
      });
      const consumerB = node(5, "projector", "service.go", `Projector ${l + 1}`, {
        props: { replicas: r.int(1, 3), concurrency: 4, latencyMs: r.int(20, 120) },
      });
      const queue = node(6, "queue", queueKind, `work-${l + 1}`, { sublabel: "work items" });
      const worker = node(7, "worker", r.pick(WORKERS), `Worker ${l + 1}`, {
        props: { replicas: r.int(1, 8), concurrency: 4, latencyMs: r.int(50, 400), failureRate: 0.02 },
      });
      const dlq = node(8, "dlq", queueKind, `work-${l + 1}-dlq`, { sublabel: "dead letters" });
      const store = node(9, "store", r.pick(STORES), `Store ${l + 1}`);
      const readStore = node(10, "read", r.pick(READ_STORES), `Read model ${l + 1}`);
      const replay = r.chance(0.5);
      const last = replay
        ? node(11, "replayer", "service.python", `DLQ replayer ${l + 1}`, {
            props: { replicas: 1, concurrency: 1, latencyMs: 500 },
          })
        : node(11, "sink", r.pick(SINKS), `Alerts ${l + 1}`);
      const async = { kind: "async" as const, props: { travelMs: 300 } };
      b.edge(producer, ingest, { ...async, label: "publish" });
      b.edge(ingest, enrich, { kind: "async", props: { travelMs: 300, group: `enrich-${l + 1}` } });
      b.edge(enrich, out, async);
      b.edge(out, consumerA, { kind: "async", props: { travelMs: 300, group: `router-${l + 1}` } });
      b.edge(out, consumerB, { kind: "async", props: { travelMs: 300, group: `projector-${l + 1}` } });
      b.edge(consumerA, queue, async);
      b.edge(queue, worker, async);
      b.edge(queue, dlq, { kind: "async", label: "dead letters", props: { travelMs: 300, dlq: true } });
      b.edge(worker, store, { kind: "sync", label: "write", props: { travelMs: 200 } });
      b.edge(consumerB, readStore, { kind: "sync", label: "upsert", props: { travelMs: 200 } });
      if (replay) {
        b.edge(dlq, last, async);
        b.edge(last, queue, { ...async, label: "replay" });
      } else b.edge(worker, last, { ...async, label: "notify" });
      members.push(producer, ingest, enrich, out, consumerA, consumerB, queue, worker, dlq, store, readStore, last);
      lanes.push({ producer, ingest, out, consumerB, worker, dlq });
    }
    b.group(`dom${d + 1}`, `Domain ${d + 1}`, members, TONES[d % TONES.length]);
  }

  // Fan-in: some projectors also read the previous lane's output (their own group there).
  lanes.forEach((lane, l) => {
    if (l > 0 && r.chance(0.2))
      b.edge(lanes[l - 1].out, lane.consumerB, {
        kind: "async",
        label: "also reads",
        props: { travelMs: 300, group: `projector-${l + 1}` },
      });
  });

  // The rest (under a lane's worth): extra readers of the first lanes' output topics, below the grid.
  const extra = n - laneCount * LANE;
  const below = (Math.max(...grid.map(([, row]) => row)) + 1) * pitch.y + 60;
  for (let i = 0; i < extra; i++) {
    const lane = lanes[i % lanes.length];
    const reader = b.node({
      id: `extra-${i + 1}`,
      stencil: "service.python",
      label: `Audit reader ${i + 1}`,
      x: i * COL,
      y: below,
      props: { replicas: 1, concurrency: 2, latencyMs: 40 },
    });
    b.edge(lane.out, reader, { kind: "async", props: { travelMs: 300, group: `audit-${i + 1}` } });
  }

  if (b.nodes.length !== n) throw new Error(`eventPipeline made ${b.nodes.length} nodes, wanted ${n}`);
  const d = b.file(`Event pipeline (${n} nodes)`, "Synthetic benchmark workload: Kafka, queues and dead letters.");
  d.simulations = simulations(d, lanes);
  return d;
}

/** Steady traffic everywhere, and an incident on the first lanes. Scaled the way the app scales a new run. */
function simulations(d: DiagramFile, lanes: Lane[]): Simulation[] {
  const steady: Simulation = {
    id: "steady",
    title: "Steady load",
    seed: 3,
    traffic: lanes.slice(0, 1_000).map((lane, i) => ({
      id: `t${i + 1}`,
      node: lane.producer.id,
      shape: { kind: "constant", ratePerSec: 5, durationMs: 10_000 },
    })),
  };
  const hit = lanes.slice(0, Math.min(20, lanes.length));
  const incident: Simulation = {
    id: "incident",
    title: "Workers go down during a spike",
    seed: 5,
    traffic: hit.map((lane, i) => ({
      id: `s${i + 1}`,
      node: lane.producer.id,
      label: "Spike",
      shape: { kind: "spike", baseRate: 5, peakRate: 40, atMs: 3_000, peakMs: 2_000, durationMs: 10_000 },
    })),
    timeline: [
      ...hit.slice(0, 10).map((lane) => ({
        atMs: 2_000,
        action: { do: "status" as const, node: lane.worker.id, status: "down" as const },
      })),
      { atMs: 2_500, action: { do: "note", text: "Ten workers are down; their queues back up." } },
      ...hit.slice(0, 10).map((lane) => ({
        atMs: 6_000,
        action: { do: "status" as const, node: lane.worker.id, status: "up" as const },
      })),
    ],
    expectations: [
      ...hit.slice(0, 10).map((lane, i) => ({
        id: `x${i + 1}`,
        label: `Nothing dead-lettered in lane ${i + 1}`,
        metric: { node: lane.dlq.id, field: "processed" as const },
        op: "==" as const,
        value: 0,
        when: "end" as const,
      })),
      {
        id: "drained",
        label: "The system drains",
        metric: { system: "inSystem" as const },
        op: "==",
        value: 0,
        when: "eventually",
      },
    ],
  };
  for (const sim of [steady, incident]) sim.scale = autoScale(sim, d);
  return [steady, incident];
}
