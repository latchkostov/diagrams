import { describe, expect, it } from "vitest";
import kafkaJson from "../examples/kafka-order-pipeline.json";
import azureJson from "../examples/azure-service-bus-integration.json";

import type { DiagramFile, SimRole } from "../model/types";
import type { MessageTrace, TraceStep } from "../sim/types";
import { entryNode, traceOnce } from "./headless";
import { buildJourney, formatDuration, formatOffset } from "./journey";
import { tracePath } from "./path";
import { sequenceText, toMermaid } from "./mermaid";
import { buildSequence, type SequenceArrow, type SequenceNote } from "./sequence";
import { estimateWidth, SEQUENCE_THEMES, toSvg } from "./svg";

const kafka = kafkaJson as DiagramFile;
it("collects only reached nodes and sent edges, in first-use order, without journey construction", () => {
  const trace: MessageTrace = {
    ...tinyTrace,
    origin: "api",
    steps: [
      step(1, "copy", { node: "copy-only", parent: 1 }),
      step(2, "send", { node: "api", edge: "in-flight" }),
      step(3, "arrive", { node: "worker", edge: "not-sent" }),
      step(4, "send", { edge: "in-flight" }),
      step(5, "arrive", { node: "api" }),
      step(6, "park", { node: "park-only" }),
      step(7, "send"),
      step(8, "arrive"),
      step(9, "send", { edge: "retry", via: "retry" }),
      step(10, "arrive", { node: "worker" }),
    ],
  };
  expect(tracePath(trace)).toEqual({ nodes: ["api", "worker"], edges: ["in-flight", "retry"] });
  expect(tracePath({ ...trace, origin: "", steps: [] })).toEqual({ nodes: [], edges: [] });
});
it.each([10_000, 40_000])("bounds measurements when truncating a %i character Unicode participant label", (length) => {
  const label = "😀".repeat(length);
  const model = buildSequence(tinyTrace, tiny);
  model.participants[0].label = label;
  let calls = 0,
    characters = 0,
    longest = 0;
  const picture = toSvg(model, SEQUENCE_THEMES.light, (text, size, opts) => {
    calls++;
    characters += text.length;
    longest = Math.max(longest, text.length);
    return estimateWidth(text, size, opts);
  });
  expect(calls).toBeLessThan(100);
  expect(characters).toBeLessThan(10_000);
  expect(longest).toBeLessThanOrEqual(1025);
  expect(picture.svg).toContain("😀");
  expect(picture.svg).not.toMatch(/[\uD800-\uDBFF]…/u);
  expect(model.participants[0].label).toBe(label);
});
const azure = azureJson as DiagramFile;
// The public examples only (never the local-only private folder).
const publicExamples = Object.entries(
  import.meta.glob<DiagramFile>("../examples/*.json", { eager: true, import: "default" }),
).map(([path, diagram]) => ({ slug: path, diagram }));

/** A small hand-written trace: api → queue → worker (fails once, redelivered) → db (sync). */
const tiny: DiagramFile = {
  format: "diagrams/v1",
  title: "Tiny",
  nodes: [
    { id: "api", stencil: "source", label: "API", x: 0, y: 0 },
    { id: "q", stencil: "queue", label: "orders; #1", x: 0, y: 0 },
    { id: "w", stencil: "processor", label: "Worker", x: 0, y: 0 },
    { id: "db", stencil: "store", label: "DB", x: 0, y: 0 },
  ],
  edges: [
    { id: "a", from: "api", to: "q", label: "publish" },
    { id: "b", from: "q", to: "w" },
    { id: "c", from: "w", to: "db", kind: "sync", label: "INSERT" },
  ],
};
const step = (t: number, kind: TraceStep["kind"], extra: Partial<TraceStep> = {}): TraceStep => ({
  t,
  kind,
  id: 1,
  type: "Order",
  ...extra,
});
const tinyTrace: MessageTrace = {
  rootId: 1,
  type: "Order",
  origin: "api",
  startedAt: 1000,
  endedAt: 3000,
  done: true,
  partial: false,
  truncated: false,
  steps: [
    step(1000, "emit", { node: "api" }),
    step(1000, "send", { node: "api", edge: "a", via: "message", until: 1100 }),
    step(1100, "arrive", { node: "q", edge: "a" }),
    step(1100, "done", { node: "q" }),
    step(1100, "send", { node: "q", edge: "b", via: "message", until: 1200 }),
    step(1200, "arrive", { node: "w", edge: "b" }),
    step(1200, "start", { node: "w" }),
    step(1300, "fail", { node: "w", attempt: 1 }),
    step(1300, "retry", { node: "q", attempt: 1 }),
    step(1300, "send", { node: "w", edge: "b", via: "retry", until: 1400 }),
    step(2400, "send", { node: "q", edge: "b", via: "message", until: 2500 }),
    step(2500, "arrive", { node: "w", edge: "b" }),
    step(2500, "start", { node: "w" }),
    step(2600, "done", { node: "w", type: "Stored" }),
    step(2600, "send", { node: "w", edge: "c", via: "message", until: 2700, type: "Stored" }),
    step(2700, "arrive", { node: "db", edge: "c", type: "Stored" }),
    step(2700, "start", { node: "db", type: "Stored" }),
    step(2800, "done", { node: "db", type: "Stored" }),
    step(2800, "send", { node: "db", edge: "c", via: "reply", until: 3000, type: "Stored" }),
    step(2800, "end", { node: "db", type: "Stored", reason: "stored" }),
  ],
};

describe("journey", () => {
  it("lists hops with their latency, wait, processing and travel, and the totals", () => {
    const j = buildJourney(tinyTrace, tiny);
    expect(j.totalMs).toBe(2000);
    expect(j.rows.map((r) => r.kind)).toEqual(["origin", "hop", "hop", "fail", "redeliver", "hop"]);
    const [, toQueue, toWorker, , again, toDb] = j.rows;
    expect(toQueue).toMatchObject({ from: "api", node: "q", t: 100, latencyMs: 100, travelMs: 100 });
    expect(toWorker).toMatchObject({ from: "q", node: "w", latencyMs: 100 });
    // Back at the queue from 400 ms (the retry trip), redelivered at 1400 ms: a 1 s wait in the queue.
    expect(again).toMatchObject({ from: "q", node: "w", attempt: 2, latencyMs: 1100, waitMs: 1000 });
    expect(toDb).toMatchObject({ node: "db", sync: true, renamed: true, type: "Stored", processMs: 100 });
    expect(j).toMatchObject({ retries: 1, failures: 1, copies: 0, deadLettered: 0, dropped: 0 });
    expect(j.nodes).toEqual(["api", "q", "w", "db"]);
    expect(j.edges).toEqual(["a", "b", "c"]);
  });

  it("folds back-to-back failures at one node into one row", () => {
    const steps = [
      ...tinyTrace.steps.slice(0, 8),
      step(1400, "fail", { node: "w", attempt: 2 }),
      step(1500, "fail", { node: "w", attempt: 3 }),
    ];
    const rows = buildJourney({ ...tinyTrace, steps, done: false, endedAt: undefined }, tiny, 1600).rows;
    expect(rows.filter((r) => r.kind === "fail")).toEqual([expect.objectContaining({ attempt: 1, lastAttempt: 3 })]);
  });

  it("measures an unfinished journey up to now", () => {
    const j = buildJourney(
      { ...tinyTrace, done: false, endedAt: undefined, steps: tinyTrace.steps.slice(0, 6) },
      tiny,
      1450,
    );
    expect(j.totalMs).toBe(450);
    expect(j.done).toBe(false);
  });

  it("formats durations and offsets", () => {
    expect(formatDuration(45)).toBe("45 ms");
    expect(formatDuration(2412)).toBe("2.41 s");
    expect(formatDuration(12_340)).toBe("12.3 s");
    expect(formatDuration(65_000)).toBe("1 min 5 s");
    expect(formatOffset(880)).toBe("+0.88 s");
  });
});

describe("sequence diagram", () => {
  it("has participants in path order, typed arrows, replies, failures and gaps", () => {
    const seq = buildSequence(tinyTrace, tiny);
    expect(seq.participants.map((p) => p.id)).toEqual(["api", "q", "w", "db"]);
    const arrows = seq.items.filter((i): i is SequenceArrow => i.kind === "arrow");
    expect(arrows.map((a) => [a.from, a.to, a.style])).toEqual([
      ["api", "q", "async"],
      ["q", "w", "async"],
      ["w", "q", "retry"],
      ["q", "w", "async"],
      ["w", "db", "sync"],
      ["db", "w", "reply"],
    ]);
    expect(arrows[0]).toMatchObject({ label: "Order", detail: "publish" });
    expect(arrows[4]).toMatchObject({ label: "Stored", detail: "INSERT" });
    const notes = seq.items.filter((i): i is SequenceNote => i.kind === "note");
    expect(notes).toEqual([expect.objectContaining({ over: "w", tone: "warn", text: "✕ attempt 1 failed" })]);
    const gap = seq.items.find((i) => i.kind === "gap");
    expect(gap).toMatchObject({ t: 400, ms: 1000 });
    expect(gap?.kind === "gap" && gap.text).toBe("1.00 s waiting in orders; #1");
    expect(seq.summary).toBe("2.00 s end to end · 1 retry");
    expect(seq.title).toBe("Order #1");
  });

  it("marks dead letters and drops in red", () => {
    const dlq: MessageTrace = {
      ...tinyTrace,
      steps: [
        ...tinyTrace.steps.slice(0, 8),
        step(1400, "deadletter", { node: "q", attempt: 1 }),
        step(1400, "send", { node: "q", edge: "b", via: "dlq", until: 1500 }),
      ],
    };
    const seq = buildSequence(dlq, tiny);
    expect(seq.items.some((i) => i.kind === "arrow" && i.style === "dlq")).toBe(true);
    expect(seq.items.some((i) => i.kind === "note" && i.tone === "danger" && /Dead-lettered/.test(i.text))).toBe(true);
    expect(seq.summary).toContain("dead-lettered");
  });

  it("writes Mermaid sequenceDiagram text with the right arrows and safe text", () => {
    const text = toMermaid(buildSequence(tinyTrace, tiny));
    expect(text.split("\n").slice(0, 4)).toEqual([
      "---",
      'title: "Order #1 · 2.00 s end to end · 1 retry"',
      "---",
      "sequenceDiagram",
    ]);
    expect(text).toContain("participant q as orders#59; #35;1");
    expect(text).toContain("api-)q: Order (+0.00 s)<br/>publish");
    expect(text).toContain("w--)q: back to the broker after attempt 1");
    expect(text).toContain("w->>db: Stored (+1.60 s)<br/>INSERT");
    expect(text).toContain("db-->>w: reply");
    expect(text).toContain("Note over w: ✕ attempt 1 failed");
    expect(text).toMatch(/Note over api,db: ⏱ 1\.00 s waiting in orders#59; #35;1/);
    expect(sequenceText("a;b#c\nd")).toBe("a#59;b#35;c d");
  });

  it("renders escaped, self-contained SVG with test ids for participants and arrows", () => {
    const evil = { ...tiny, nodes: tiny.nodes.map((n) => (n.id === "api" ? { ...n, label: '<script>"x"&' } : n)) };
    const { svg, width, height } = toSvg(buildSequence(tinyTrace, evil), SEQUENCE_THEMES.light);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;&quot;x&quot;&amp;");
    expect(svg).toContain('data-testid="seq-participant-api"');
    expect(svg.match(/data-testid="seq-arrow-/g)).toHaveLength(6);
    expect(svg).toContain('data-style="dlq"'.replace("dlq", "retry"));
    expect(width).toBeGreaterThan(400);
    expect(height).toBeGreaterThan(200);
    expect(toSvg(buildSequence(tinyTrace, tiny), SEQUENCE_THEMES.dark).svg).toContain(SEQUENCE_THEMES.dark.background);
  });

  it("estimates text widths sensibly", () => {
    expect(estimateWidth("iii", 12)).toBeLessThan(estimateWidth("MMM", 12));
    expect(estimateWidth("abc", 12, { mono: true })).toBeCloseTo(21.6);
  });
});

describe("tracing the public examples end to end", () => {
  it("Kafka: one order fans out to every consumer group and back to the order service", () => {
    const trace = traceOnce(kafka)!;
    expect(trace.done).toBe(true);
    const j = buildJourney(trace, kafka);
    expect(j.copies).toBeGreaterThanOrEqual(4);
    for (const node of [
      "gateway",
      "orders",
      "order-events",
      "inventory",
      "payments",
      "notifications",
      "payment-events",
    ])
      expect(j.nodes).toContain(node);
    const seq = buildSequence(trace, kafka);
    expect(seq.participants[0].id).toBe("shopper");
    const styles = new Set(seq.items.flatMap((i) => (i.kind === "arrow" ? [i.style] : [])));
    expect(styles).toEqual(new Set(["sync", "reply", "async"]));
  });

  it("Azure Poison invoices: the dead-lettered invoice shows retries and the DLQ hop", () => {
    const poison = azure.simulations!.find((s) => s.id === "poison")!;
    const trace = traceOnce(azure, { simulation: poison, deadLetter: true })!;
    expect(trace.partial).toBe(false);
    const j = buildJourney(trace, azure);
    expect(j.deadLettered).toBe(1);
    expect(j.retries).toBeGreaterThan(0);
    expect(j.rows.at(-1)).toMatchObject({ kind: "dlq", node: "dlq", from: "commands" });
    expect(toMermaid(buildSequence(trace, azure))).toContain("commands-)dlq: PostInvoice (dead letter)");
  });

  it("every public example produces a finished trace and a sequence diagram", () => {
    expect(publicExamples.length).toBeGreaterThanOrEqual(5);
    for (const { slug, diagram } of publicExamples) {
      const trace = traceOnce(diagram);
      expect(trace?.done, slug).toBe(true);
      const seq = buildSequence(trace!, diagram);
      expect(seq.participants.length, slug).toBeGreaterThan(1);
      expect(toSvg(seq, SEQUENCE_THEMES.light).svg, slug).toContain("seq-arrow-0");
      expect(entryNode(diagram), slug).toBeDefined();
    }
  });

  it("is deterministic", () => {
    expect(traceOnce(kafka, { seed: 3 })).toEqual(traceOnce(kafka, { seed: 3 }));
  });

  it("accepts a custom role function", () => {
    const roleOf = (stencil: string) => (stencil === "source" ? "source" : "sink") as SimRole;
    const d: DiagramFile = {
      format: "diagrams/v1",
      title: "x",
      nodes: [
        { id: "a", stencil: "source", label: "A", x: 0, y: 0 },
        { id: "b", stencil: "sink", label: "B", x: 0, y: 0 },
      ],
      edges: [{ id: "ab", from: "a", to: "b" }],
    };
    const trace = traceOnce(d, { roleOf })!;
    expect(buildJourney(trace, d).nodes).toEqual(["a", "b"]);
  });
});
