// Workload: a service mesh behind gateways (docs/BENCHMARKS.md § Workloads). Request/response heavy: clients call
// edge gateways, which route to one ingress per domain; services call each other synchronously down a DAG (with the
// occasional call into the paired domain, so the sync-chain check has chains to follow), read and write their own
// stores, and publish a few events to topics that services in the paired domain consume (the second domain's topics
// have no reader yet: the no-reader check's case). One boundary per domain. Exactly `n` nodes. No request loops: a loop
// makes the capacity analysis run to its iteration bound (src/sim/capacity.ts), which the planning benchmark measures
// on its own ("withLoop"), not in every diagram.

import type { DiagramFile, DiagramNode } from "../../model/types";
import { blockGrid, Builder, rand, split } from "./common";

const CLIENTS = ["client.browser", "client.mobile", "client.partner"];
const EDGE_GATEWAYS = ["aws.api-gateway", "azure.api-management", "nginx", "aws.elb"];
const INGRESS = ["nginx", "load-balancer", "aws.elb"];
const SERVICES = ["service.go", "service.java", "service.node", "service.dotnet", "service.python"];
const STORES = ["postgres", "redis.cache", "mongodb", "aws.dynamodb", "azure.cosmos-db"];
const TOPICS = ["kafka.topic", "aws.sns", "azure.service-bus.topic"];
const EXTERNALS = ["stripe", "generic.email", "slack", "generic.webhook"];
const TONES = ["k8s", "azure", "aws", "gcp", "onprem", "neutral"] as const;

/** Nodes per domain, ingress included. */
const DOMAIN = 24;
const COL = 300;
const ROW = 120;

export function serviceMesh(n: number, seed = 11): DiagramFile {
  if (n < 8) throw new Error("serviceMesh needs at least 8 nodes");
  const r = rand(seed);
  const b = new Builder();
  const clientCount = Math.max(2, Math.round(n * 0.02));
  const gatewayCount = Math.max(1, Math.round(n * 0.01));
  const rest = n - clientCount - gatewayCount;
  const domainSizes = split(rest, Math.max(1, Math.round(rest / DOMAIN)));
  const grid = blockGrid(domainSizes.length);
  // Domain blocks: six columns wide; tall enough for the biggest column of the biggest domain.
  const maxRows = Math.max(...domainSizes.map((d) => Math.ceil((d * 0.6) / 3) + 1, 4));
  const pitch = { x: 6 * COL + 420, y: maxRows * ROW + 260 };
  const gridRows = Math.max(...grid.map(([, row]) => row)) + 1;
  const left = 2 * COL + 200;

  // The global edge: clients and gateways, spread down the left of the domain grid.
  const span = gridRows * pitch.y;
  const clients = Array.from({ length: clientCount }, (_, i) =>
    b.node({
      id: `client-${i + 1}`,
      stencil: CLIENTS[i % CLIENTS.length],
      label: `Client ${i + 1}`,
      x: 0,
      y: Math.round((i * span) / clientCount),
      props: { ratePerSec: r.int(5, 40), messageType: "Request" },
    }),
  );
  const gateways = Array.from({ length: gatewayCount }, (_, i) =>
    b.node({
      id: `edge-${i + 1}`,
      stencil: EDGE_GATEWAYS[i % EDGE_GATEWAYS.length],
      label: `Edge gateway ${i + 1}`,
      sublabel: "TLS · rate limits",
      x: COL + 80,
      y: Math.round((i * span) / gatewayCount),
      props: { latencyMs: r.int(5, 20) },
    }),
  );
  clients.forEach((c, i) => {
    b.edge(c, gateways[i % gatewayCount], { kind: "sync", label: "HTTPS", props: { travelMs: 200 } });
    if (gatewayCount > 1 && r.chance(0.3))
      b.edge(c, gateways[(i + 1) % gatewayCount], { kind: "sync", props: { travelMs: 200 } });
  });

  interface Domain {
    ingress: DiagramNode;
    services: DiagramNode[];
    topics: DiagramNode[];
  }
  const domains: Domain[] = domainSizes.map((size, d) => {
    const [gx, gy] = grid[d];
    const ox = left + gx * pitch.x;
    const oy = gy * pitch.y + 60;
    const inner = size - 1;
    const topicCount = inner >= 8 ? Math.max(1, Math.round(inner * 0.1)) : 0;
    const externalCount = inner >= 12 ? Math.max(1, Math.round(inner * 0.05)) : 0;
    const storeCount = inner >= 4 ? Math.max(1, Math.round(inner * 0.25)) : 0;
    const serviceCount = inner - topicCount - externalCount - storeCount;
    const tag = `d${d + 1}`;
    const members: DiagramNode[] = [];
    const ingress = b.node({
      id: `${tag}-ingress`,
      stencil: INGRESS[d % INGRESS.length],
      label: `Domain ${d + 1} ingress`,
      x: ox,
      y: oy,
      props: { latencyMs: r.int(2, 10) },
    });
    members.push(ingress);
    const services = Array.from({ length: serviceCount }, (_, j) =>
      b.node({
        id: `${tag}-svc-${j + 1}`,
        stencil: r.pick(SERVICES),
        label: `D${d + 1} service ${j + 1}`,
        sublabel: `api.v${1 + (j % 3)}`,
        x: ox + (1 + (j % 3)) * COL,
        y: oy + Math.floor(j / 3) * ROW,
        props: {
          replicas: r.int(1, 6),
          concurrency: r.pick([4, 8, 16, 32]),
          latencyMs: r.int(20, 250),
        },
      }),
    );
    const topics = Array.from({ length: topicCount }, (_, j) =>
      b.node({
        id: `${tag}-topic-${j + 1}`,
        stencil: r.pick(TOPICS),
        label: `d${d + 1}.events.${j + 1}`,
        x: ox + 4 * COL,
        y: oy + j * ROW,
        props: { partitions: r.pick([6, 12, 24, 48]) },
      }),
    );
    const stores = Array.from({ length: storeCount }, (_, j) =>
      b.node({
        id: `${tag}-store-${j + 1}`,
        stencil: r.pick(STORES),
        label: `D${d + 1} store ${j + 1}`,
        x: ox + 5 * COL,
        y: oy + j * ROW,
      }),
    );
    const externals = Array.from({ length: externalCount }, (_, j) =>
      b.node({
        id: `${tag}-ext-${j + 1}`,
        stencil: r.pick(EXTERNALS),
        label: `D${d + 1} partner API ${j + 1}`,
        x: ox + 4 * COL,
        y: oy + (topicCount + j) * ROW,
      }),
    );
    members.push(...services, ...topics, ...stores, ...externals);

    // Ingress into the first services; a DAG of calls; each service reads and writes its store.
    for (const s of services.slice(0, 3))
      b.edge(ingress, s, { kind: "sync", label: "route", props: { travelMs: 200 } });
    services.forEach((s, j) => {
      const next = j + 1 + r.int(0, 2);
      if (next < services.length) b.edge(s, services[next], { kind: "sync", props: { travelMs: 200 } });
      if (r.chance(0.3) && j + 4 < services.length)
        b.edge(s, services[r.int(j + 1, services.length - 1)], { kind: "sync", props: { travelMs: 200 } });
      if (stores.length)
        b.edge(s, stores[j % stores.length], { kind: "sync", label: "query", props: { travelMs: 200 } });
      if (topics.length && r.chance(0.25))
        b.edge(s, topics[j % topics.length], { kind: "async", label: "publish", props: { travelMs: 300 } });
      if (externals.length && r.chance(0.1))
        b.edge(s, externals[j % externals.length], { kind: "sync", props: { travelMs: 200 } });
    });
    // A topic nobody publishes to would be unrealistic: the first service always publishes to the first topic.
    if (topics.length && services.length) b.edge(services[0], topics[0], { kind: "async", props: { travelMs: 300 } });
    b.group(tag, `Domain ${d + 1}`, members, TONES[d % TONES.length]);
    return { ingress, services, topics };
  });

  // Gateways route to the domains' ingresses. Domains work in pairs: the first's topics are read by the second, and a
  // few of its calls cross into it (chains as deep as a few domains, not as deep as the mesh is wide). The second's
  // topics have no reader yet.
  domains.forEach((dom, d) => {
    b.edge(gateways[d % gatewayCount], dom.ingress, { kind: "sync", label: `/d${d + 1}`, props: { travelMs: 200 } });
    const next = d % 2 === 0 ? domains[d + 1] : undefined;
    if (!next) return;
    dom.topics.forEach((t, j) => {
      const readers = next.services.length ? [next.services[j % next.services.length]] : [];
      if (next.services.length > 1 && r.chance(0.5)) readers.push(next.services[(j + 1) % next.services.length]);
      for (const reader of readers)
        b.edge(t, reader, { kind: "async", label: "consume", props: { travelMs: 300, group: `d${d + 2}-readers` } });
    });
    for (const s of dom.services)
      if (next.services.length && r.chance(0.05))
        b.edge(s, r.pick(next.services), { kind: "sync", label: "cross-domain", props: { travelMs: 200 } });
  });

  if (b.nodes.length !== n) throw new Error(`serviceMesh made ${b.nodes.length} nodes, wanted ${n}`);
  return b.file(`Service mesh (${n} nodes)`, "Synthetic benchmark workload: gateways in front of a service mesh.");
}
