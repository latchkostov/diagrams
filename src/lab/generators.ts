// Procedural diagrams for the Lab: stress tests, edge-case geometry, synthetic flows.
// Pure functions (no React, no DOM) so they're unit-tested in generators.test.ts.

import { DIAGRAM_FORMAT, type DiagramEdge, type DiagramFile, type DiagramGroup, type DiagramNode, type Side } from "../model/types";

/** Grid from docs/PLAN.md: node card ~220x72, columns 360 apart, rows 120 apart. */
export const COL = 360;
export const ROW = 120;
export const ORIGIN = 40;
export const colX = (c: number) => ORIGIN + c * COL;
export const rowY = (r: number) => ORIGIN + r * ROW;

/** Small deterministic PRNG so generated diagrams are stable across reloads and tests. */
export function prng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const file = (title: string, description: string, nodes: DiagramNode[], edges: DiagramEdge[], extra: Partial<DiagramFile> = {}): DiagramFile => ({
  format: DIAGRAM_FORMAT,
  title,
  description,
  ...extra,
  nodes,
  edges,
});

// ---------- stress ----------

/** Stencils per pipeline stage, left to right. */
const STAGES: { stencils: string[]; label: string; sub?: string }[] = [
  { stencils: ["client.browser", "client.mobile", "client.iot", "generic.scheduler", "client.partner"], label: "Client" },
  { stencils: ["aws.api-gateway", "azure.api-management", "nginx", "load-balancer"], label: "Gateway" },
  { stencils: ["service.node", "service.dotnet", "service.java", "service.go", "service.python"], label: "Service" },
  { stencils: ["kafka.topic", "azure.service-bus.topic", "aws.sns", "azure.event-hubs"], label: "Topic", sub: "events.v1" },
  { stencils: ["azure.functions", "aws.lambda", "k8s.deployment", "azure.container-apps"], label: "Worker" },
  { stencils: ["azure.service-bus.queue", "aws.sqs", "rabbitmq.queue"], label: "Queue", sub: "work" },
  { stencils: ["service.go", "service.java", "aws.ecs"], label: "Handler" },
  { stencils: ["postgres", "azure.cosmos-db", "redis.cache", "aws.s3", "mongodb", "elasticsearch"], label: "Store" },
];

export interface StressOptions {
  nodes: number;
  seed?: number;
  /** Wrap every column in a group boundary. */
  groups?: boolean;
  /** Extra random cross-links per node (0..1). */
  density?: number;
  direction?: "LR" | "TB";
}

/**
 * A layered pipeline with exactly `nodes` nodes: columns follow STAGES (wrapping), each node feeds
 * 1–2 nodes in the next column, plus some random skip-links. Deterministic for a given seed.
 */
export function stressDiagram({ nodes: count, seed = 1, groups = false, density = 0.25, direction = "LR" }: StressOptions): DiagramFile {
  const n = Math.max(1, Math.floor(count));
  const rand = prng(seed);
  // Aim for a wide-ish grid: columns ≈ 1.6 × rows.
  const cols = Math.max(1, Math.min(n, Math.round(Math.sqrt(n * 1.6))));
  const rows = Math.ceil(n / cols);
  const nodes: DiagramNode[] = [];
  const byCol: DiagramNode[][] = Array.from({ length: cols }, () => []);
  for (let i = 0; i < n; i++) {
    const c = Math.floor(i / rows);
    const r = i % rows;
    const stage = STAGES[c % STAGES.length];
    const stencil = stage.stencils[Math.floor(rand() * stage.stencils.length)];
    const [x, y] = direction === "TB" ? [ORIGIN + r * 300, ORIGIN + c * 170] : [colX(c), rowY(r)];
    const node: DiagramNode = { id: `n${i + 1}`, stencil, label: `${stage.label} ${i + 1}`, x, y };
    if (stage.sub) node.sublabel = `${stage.sub}.${i + 1}`;
    if (groups) node.group = `col${c + 1}`;
    nodes.push(node);
    byCol[c].push(node);
  }
  const edges: DiagramEdge[] = [];
  const seen = new Set<string>();
  const link = (from: DiagramNode, to: DiagramNode, kind: "async" | "sync") => {
    const key = `${from.id}>${to.id}`;
    if (from.id === to.id || seen.has(key)) return;
    seen.add(key);
    edges.push({ id: `e${edges.length + 1}`, from: from.id, to: to.id, kind });
  };
  for (let c = 0; c < cols - 1; c++) {
    const here = byCol[c];
    const next = byCol[c + 1];
    if (!next.length) continue;
    const kind = c % STAGES.length < 2 ? "sync" : "async";
    here.forEach((node, r) => {
      link(node, next[Math.min(next.length - 1, Math.round((r * (next.length - 1)) / Math.max(1, here.length - 1)))], kind);
      if (rand() < density) link(node, next[Math.floor(rand() * next.length)], kind);
    });
    // Nobody in the next column is left without an input.
    next.forEach((node, r) => {
      if (!edges.some((e) => e.to === node.id)) link(here[Math.min(here.length - 1, r)], node, kind);
    });
  }
  const groupList: DiagramGroup[] = groups
    ? byCol
        .filter((col) => col.length)
        .map((col, c) => {
          const xs = col.map((nd) => nd.x);
          const ys = col.map((nd) => nd.y);
          return {
            id: `col${c + 1}`,
            label: `${STAGES[c % STAGES.length].label} tier`,
            tone: (["azure", "aws", "k8s", "gcp", "onprem", "neutral"] as const)[c % 6],
            x: Math.min(...xs) - 40,
            y: Math.min(...ys) - 56,
            width: Math.max(...xs) - Math.min(...xs) + 300,
            height: Math.max(...ys) - Math.min(...ys) + 72 + 96,
          };
        })
    : [];
  return file(`Stress: ${n} nodes`, `Procedural ${cols}×${rows} pipeline, seed ${seed}.`, nodes, edges, {
    direction,
    ...(groupList.length ? { groups: groupList } : {}),
  });
}

// ---------- fan-out tree ----------

/** source → topic → `breadth` consumers → each its own topic → ... `depth` levels deep. Capped at `max` nodes. */
export function fanOutDiagram(depth: number, breadth: number, max = 400): DiagramFile {
  const d = Math.max(1, Math.floor(depth));
  const b = Math.max(1, Math.floor(breadth));
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  let leafRow = 0;
  const place = (id: string, level: number, stencil: string, label: string, sub?: string): DiagramNode => {
    const node: DiagramNode = { id, stencil, label, x: colX(level), y: 0 };
    if (sub) node.sublabel = sub;
    nodes.push(node);
    return node;
  };
  // Depth-first so leaves get consecutive rows; parents are centred on their children afterwards.
  const grow = (parent: DiagramNode, level: number, path: string) => {
    const isTopicLevel = level % 2 === 1;
    if (level > d * 2 || nodes.length >= max) {
      parent.y = rowY(leafRow++);
      return;
    }
    const kids: DiagramNode[] = [];
    const count = isTopicLevel ? 1 : b;
    for (let i = 0; i < count && nodes.length < max; i++) {
      const id = `${path}-${i + 1}`;
      const kid = isTopicLevel
        ? place(id, level, "kafka.topic", `Topic ${id.slice(2)}`, `events.${id.slice(2)}`)
        : place(id, level, level === d * 2 ? "postgres" : "service.go", `${level === d * 2 ? "Store" : "Service"} ${id.slice(2)}`);
      edges.push({ id: `e-${id}`, from: parent.id, to: kid.id, kind: "async" });
      kids.push(kid);
      grow(kid, level + 1, id);
    }
    if (!kids.length) parent.y = rowY(leafRow++);
    else parent.y = Math.round((kids[0].y + kids[kids.length - 1].y) / 2);
  };
  const root = place("n", 0, "client.browser", "Producer");
  grow(root, 1, "n");
  return file(`Fan-out ${d}×${b}`, `${nodes.length} nodes: every level fans out to ${b} consumers.`, nodes, edges);
}

// ---------- cycle ----------

/** A ring of services and topics: the last edge closes the loop (a back-edge). */
export function cycleDiagram(size: number): DiagramFile {
  const n = Math.max(2, Math.floor(size));
  const radius = Math.max(220, (n * 300) / (2 * Math.PI));
  const nodes: DiagramNode[] = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const topic = i % 2 === 1;
    return {
      id: `c${i + 1}`,
      stencil: topic ? "kafka.topic" : "service.dotnet",
      label: topic ? `Topic ${i + 1}` : `Service ${i + 1}`,
      ...(topic ? { sublabel: `ring.${i + 1}` } : {}),
      x: Math.round(radius + Math.cos(a) * radius) + ORIGIN,
      y: Math.round(radius + Math.sin(a) * radius * 0.7) + ORIGIN,
    };
  });
  const edges: DiagramEdge[] = nodes.map((node, i) => ({
    id: `r${i + 1}`,
    from: node.id,
    to: nodes[(i + 1) % n].id,
    kind: "async",
    ...(i === n - 1 ? { label: "back to start" } : {}),
  }));
  return file(`Cycle of ${n}`, "Messages loop back to the first node.", nodes, edges);
}

// ---------- edges ----------

const SIDES: Side[] = ["top", "right", "bottom", "left"];

/** Every sourceSide × targetSide combination (16 pairs) in a 4×4 grid. */
export function edgeSidesDiagram(spacing = 1): DiagramFile {
  const s = Math.max(0.6, spacing);
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  SIDES.forEach((src, r) =>
    SIDES.forEach((dst, c) => {
      const id = `${src[0]}${dst[0]}`;
      const x = ORIGIN + c * 640 * s;
      const y = ORIGIN + r * 300 * s;
      nodes.push({ id: `${id}-a`, stencil: "service.node", label: `${src} →`, sublabel: `from ${src}`, x, y });
      nodes.push({ id: `${id}-b`, stencil: "kafka.topic", label: `→ ${dst}`, sublabel: `to ${dst}`, x: x + 300 * s, y: y + 110 * s });
      edges.push({ id: `side-${id}`, from: `${id}-a`, to: `${id}-b`, sourceSide: src, targetSide: dst, label: `${src}→${dst}`, kind: "async" });
    }),
  );
  return file("Edge sides", "sourceSide × targetSide: all 16 combinations.", nodes, edges);
}

/** async, sync, labelled, long label, bidirectional pair. */
export function edgeKindsDiagram(): DiagramFile {
  const row = (r: number, a: string, b: string, edge: Omit<DiagramEdge, "id" | "from" | "to">, name: string): [DiagramNode[], DiagramEdge] => [
    [
      { id: `${name}-a`, stencil: a, label: `${name} source`, x: colX(0), y: rowY(r * 1.5) },
      { id: `${name}-b`, stencil: b, label: `${name} target`, x: colX(1.4), y: rowY(r * 1.5) },
    ],
    { id: `edge-${name}`, from: `${name}-a`, to: `${name}-b`, ...edge },
  ];
  const rows = [
    row(0, "service.node", "kafka.topic", { kind: "async" }, "async"),
    row(1, "aws.api-gateway", "service.java", { kind: "sync" }, "sync"),
    row(2, "service.go", "aws.sqs", { kind: "async", label: "OrderPlaced" }, "labelled"),
    row(3, "azure.api-management", "azure.functions", { kind: "sync", label: "POST /orders/{id}/payments (idempotent, retries ×3)" }, "long-label"),
  ];
  const nodes = rows.flatMap(([ns]) => ns);
  const edges = rows.map(([, e]) => e);
  nodes.push(
    { id: "bi-a", stencil: "service.python", label: "bidirectional A", x: colX(0), y: rowY(6) },
    { id: "bi-b", stencil: "service.dotnet", label: "bidirectional B", x: colX(1.4), y: rowY(6) },
  );
  edges.push(
    { id: "bi-ab", from: "bi-a", to: "bi-b", kind: "sync", label: "request" },
    { id: "bi-ba", from: "bi-b", to: "bi-a", kind: "async", label: "callback" },
  );
  return file("Edge kinds", "async (dashed), sync (solid), labels, and a two-way pair.", nodes, edges);
}

/** Edges that run against the flow: target left of / above the source, loops, a self-loop. */
export function backEdgeDiagram(selfLoop = true): DiagramFile {
  const nodes: DiagramNode[] = [
    { id: "api", stencil: "aws.api-gateway", label: "API", x: colX(0), y: rowY(1) },
    { id: "svc", stencil: "service.node", label: "Orders", x: colX(1), y: rowY(1) },
    { id: "topic", stencil: "kafka.topic", label: "orders", sublabel: "orders.v1", x: colX(2), y: rowY(1) },
    { id: "retry", stencil: "service.go", label: "Retry worker", x: colX(2), y: rowY(3) },
    { id: "above", stencil: "redis.cache", label: "Cache (above)", x: colX(1), y: rowY(-0.4) },
    { id: "below", stencil: "postgres", label: "DB (below)", x: colX(1), y: rowY(3) },
  ];
  const edges: DiagramEdge[] = [
    { id: "fwd-1", from: "api", to: "svc", kind: "sync" },
    { id: "fwd-2", from: "svc", to: "topic", kind: "async" },
    { id: "down", from: "topic", to: "retry", kind: "async", label: "failed" },
    { id: "back", from: "retry", to: "svc", kind: "async", label: "back-edge: retry" },
    { id: "back-far", from: "topic", to: "api", kind: "async", label: "back-edge: skip" },
    { id: "up", from: "svc", to: "above", kind: "sync" },
    { id: "down-2", from: "svc", to: "below", kind: "sync" },
  ];
  if (selfLoop) edges.push({ id: "self", from: "retry", to: "retry", kind: "async", label: "self-loop" });
  return file("Back-edges and loops", "Targets behind, above and below their sources.", nodes, edges);
}

/** One node fanning out to (and in from) `count` nodes. */
export function fanEdgesDiagram(count: number): DiagramFile {
  const n = Math.max(1, Math.floor(count));
  const mid = (n - 1) / 2;
  const nodes: DiagramNode[] = [{ id: "hub", stencil: "kafka.topic", label: "Hub", sublabel: "events", x: colX(1), y: rowY(mid) }];
  const edges: DiagramEdge[] = [];
  for (let i = 0; i < n; i++) {
    nodes.push({ id: `in${i + 1}`, stencil: "service.java", label: `Producer ${i + 1}`, x: colX(0), y: rowY(i) });
    nodes.push({ id: `out${i + 1}`, stencil: "azure.functions", label: `Consumer ${i + 1}`, x: colX(2), y: rowY(i) });
    edges.push({ id: `fi${i + 1}`, from: `in${i + 1}`, to: "hub", kind: "async" });
    edges.push({ id: `fo${i + 1}`, from: "hub", to: `out${i + 1}`, kind: "async" });
  }
  return file(`Fan ${n} in / ${n} out`, "Many edges converging on and leaving one node.", nodes, edges);
}

// ---------- nodes & groups ----------

/** Odd nodes on a canvas: unknown stencil, long label, long sublabel, no sublabel. */
export function oddNodesDiagram(): DiagramFile {
  const nodes: DiagramNode[] = [
    { id: "normal", stencil: "kafka.topic", label: "orders", sublabel: "orders.created.v1", x: colX(0), y: rowY(0) },
    { id: "unknown", stencil: "acme.quantum-bus", label: "Unknown stencil", sublabel: "acme.quantum-bus", x: colX(1), y: rowY(0) },
    {
      id: "long-label",
      stencil: "service.dotnet",
      label: "Customer Communication Preferences Synchronisation Service",
      x: colX(0),
      y: rowY(1),
    },
    {
      id: "long-sub",
      stencil: "azure.service-bus.topic",
      label: "notifications",
      sublabel: "sb://contoso-prod-eastus2.servicebus.windows.net/topics/customer-notification-preferences-changed",
      x: colX(1),
      y: rowY(1),
    },
    { id: "no-sub", stencil: "postgres", label: "DB", x: colX(0), y: rowY(2) },
    { id: "empty-label", stencil: "redis.cache", label: "", x: colX(1), y: rowY(2) },
  ];
  const edges: DiagramEdge[] = [
    { id: "o1", from: "normal", to: "unknown", kind: "async" },
    { id: "o2", from: "long-label", to: "long-sub", kind: "async" },
    { id: "o3", from: "no-sub", to: "empty-label", kind: "sync" },
  ];
  return file("Odd nodes", "Fallbacks and overflow on the canvas.", nodes, edges);
}

/** Every group tone, with nodes inside and an edge crossing boundaries. */
export function groupsDiagram(): DiagramFile {
  const tones = ["azure", "aws", "gcp", "k8s", "onprem", "neutral"] as const;
  const groups: DiagramGroup[] = [];
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  tones.forEach((tone, i) => {
    const c = (i % 3) * 1.15;
    const r = Math.floor(i / 3) * 3;
    groups.push({ id: tone, label: `${tone} boundary`, tone, x: colX(c) - 30, y: rowY(r) - 50, width: 290, height: 72 + 120 + 90 });
    nodes.push({ id: `${tone}-1`, stencil: "service.node", label: `${tone} service`, x: colX(c), y: rowY(r), group: tone });
    nodes.push({ id: `${tone}-2`, stencil: "kafka.topic", label: `${tone} topic`, sublabel: `${tone}.events`, x: colX(c), y: rowY(r + 1), group: tone });
    edges.push({ id: `${tone}-in`, from: `${tone}-1`, to: `${tone}-2`, kind: "async" });
    if (i > 0) edges.push({ id: `${tone}-cross`, from: `${tones[i - 1]}-2`, to: `${tone}-1`, kind: "async" });
  });
  return file("Group tones", "Every boundary tone, with cross-boundary edges.", nodes, edges, { groups });
}

/** Ids, references and duplicates — shared by the unit tests and the Lab's JSON loader. */
export function diagramProblems(d: DiagramFile): string[] {
  const problems: string[] = [];
  if (d.format !== DIAGRAM_FORMAT) problems.push(`format is ${String(d.format)}`);
  const ids = new Set<string>();
  for (const n of d.nodes) {
    if (ids.has(n.id)) problems.push(`duplicate node id ${n.id}`);
    ids.add(n.id);
    if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) problems.push(`node ${n.id} has a non-numeric position`);
  }
  const groupIds = new Set((d.groups ?? []).map((g) => g.id));
  for (const n of d.nodes) if (n.group && !groupIds.has(n.group)) problems.push(`node ${n.id} is in missing group ${n.group}`);
  const edgeIds = new Set<string>();
  for (const e of d.edges) {
    if (edgeIds.has(e.id)) problems.push(`duplicate edge id ${e.id}`);
    edgeIds.add(e.id);
    if (!ids.has(e.from)) problems.push(`edge ${e.id} starts at missing node ${e.from}`);
    if (!ids.has(e.to)) problems.push(`edge ${e.id} ends at missing node ${e.to}`);
  }
  return problems;
}
