import en from "../i18n/en";
import { describe, expect, it, vi, afterEach } from "vitest";
import { brokerAssignments } from "../sim/brokerAssignments";
import * as defaults from "../sim/defaults";
import { state, type Catalog } from "../i18n/core";
import { catalogs } from "virtual:i18n/catalogs";
import { presentFinding } from "../checks/presentation";
import { planningP2Fixture } from "../lab/planningP2Fixture";
import { createEngine } from "../sim/engine";
import { analyzeCapacity } from "../sim/capacity";
import { allocateGroupReplicas, compileTopology } from "../sim/topology";
import { sizingFix, sourceTraffic } from "../sim/capacityPlanning";
import { resolveNodeProps } from "../sim/defaults";
import { capabilities } from "./capabilities";
import { upgradePlanning, legacyExport } from "./migration";
import { parseNative, serializeNative } from "../interop/native";
import { nodeSimFields } from "../canvas/simFieldRules";
import { runChecks } from "../checks/run";
import type { DiagramFile } from "../model/types";
import { readFileSync, readdirSync } from "node:fs";

const run = (d: DiagramFile) => {
  const e = createEngine({ seed: 37 });
  e.load(d);
  e.setTraffic(true);
  return e;
};
const steps = (e: ReturnType<typeof run>, count: number) => {
  for (let i = 0; i < count; i++) e.step(100);
};
const fanout = ["aws.sns", "aws.eventbridge", "azure.service-bus.topic", "gcp.pubsub", "rabbitmq.exchange"];
afterEach(() => {
  state.l = "en";
  state.c = undefined;
  vi.restoreAllMocks();
});

describe("P2 broker assignment", () => {
  it.each(fanout)("%s unread subscription findings stay deterministic across locales", async (stencil) => {
    const d = planningP2Fixture(stencil);
    d.edges = d.edges.filter((edge) => edge.from !== "broker");
    const before = runChecks(d);
    const finding = before.findings.find((f) => f.id === "no-reader:broker")!;
    expect(finding.rationale).toBe(en["broker.noReader"]);
    expect(presentFinding(finding).rationale).toBe(finding.rationale);
    state.l = "de";
    state.c = (await catalogs.de()).default as Catalog;
    expect(runChecks(d)).toEqual(before);
    // A worker result crosses the structured-clone boundary before presentation.
    const cached = structuredClone(before);
    const shown = presentFinding(cached.findings.find((f) => f.id === "no-reader:broker")!);
    expect(shown.rationale).toBe("Keine Leser. Einen Leser hinzufügen.");
    expect(cached).toEqual(before);
    state.l = "en";
    state.c = undefined;
    expect(presentFinding(finding).rationale).toBe(finding.rationale);
  });

  it("check and agent analysis stay English while broker descriptors translate only in the UI", async () => {
    const d = planningP2Fixture("kafka.topic");
    const before = runChecks(d, { rules: ["capacity"] });
    const analysis = analyzeCapacity(d);
    state.l = "de";
    state.c = (await catalogs.de()).default as Catalog;
    expect(runChecks(d, { rules: ["capacity"] })).toEqual(before);
    expect(analyzeCapacity(d)).toEqual(analysis);
    const shown = presentFinding(before.findings[0]);
    expect(shown.message).not.toBe(before.findings[0].message);
    expect(shown.fix?.label).not.toBe(before.findings[0].fix?.label);
    expect(shown.fix?.ops).toEqual(before.findings[0].fix?.ops);
  });

  it("traffic presets and broker classification do not resolve every node's simulation properties", async () => {
    const { isPresetActive, emptyInputs } = await import("../live/capacityModel");
    const d = planningP2Fixture();
    const reads = vi.spyOn(defaults, "resolveNodeProps");
    isPresetActive("black-friday", emptyInputs(), d, null);
    isPresetActive("half-pods", emptyInputs(), d, null);
    isPresetActive("normal", emptyInputs(), d, null);
    expect(reads).toHaveBeenCalledTimes(0);
  });

  it.each(["aws.sns", "generic.queue"])(
    "%s keeps physical device capacity finite and routes competing demand to both readers",
    (stencil) => {
      const d = planningP2Fixture(stencil);
      if (stencil === "generic.queue") {
        delete d.planning;
        d.format = "diagrams/v1";
      }
      d.nodes[2].props = { replicas: 1, concurrency: 4, latencyMs: 250, jitter: 0 };
      d.nodes.push({
        id: "router",
        label: "Router",
        stencil: "generic.router",
        x: 0,
        y: 0,
        props: { gbps: 0.008, messageKB: 1000, replicas: 2, ha: "active-active", jitter: 0 },
      });
      d.edges.push({ id: "router-read", from: "broker", to: "router", props: { group: "billing", travelMs: 0 } });
      const a = analyzeCapacity(d);
      expect(a.nodes.router.capacity).toBe(2);
      expect(a.nodes.broker.capacity).toBe(18);
      expect(a.connections.read).toBeGreaterThan(0);
      expect(a.connections["router-read"]).toBeGreaterThan(0);
      const e = run(d);
      steps(e, 200);
      const before = e.snapshot();
      steps(e, 200);
      expect(e.snapshot().nodes.router.processed - before.nodes.router.processed).toBe(40);
      expect(e.snapshot().nodes.worker.processed - before.nodes.worker.processed).toBe(320);
      d.nodes.at(-1)!.props!.gbps = 0;
      const stopped = analyzeCapacity(d);
      expect(stopped.nodes.broker.capacity).toBe(16);
      expect(Number.isNaN(stopped.nodes.broker.capacity)).toBe(false);
    },
  );

  it("mixed log limits keep the winning count's noun, and a broker keeps its own lag vocabulary", () => {
    const d = planningP2Fixture("kafka.topic");
    d.nodes[1].props!.partitions = 6;
    d.nodes.push(
      { ...d.nodes[1], id: "shards", stencil: "aws.kinesis", props: { partitions: 1 } },
      { ...d.nodes[1], id: "exchange", stencil: "rabbitmq.exchange" },
    );
    d.edges.push(
      { id: "shard-reader", from: "shards", to: "worker", props: { group: "billing" } },
      { id: "nested", from: "broker", to: "exchange" },
      { id: "bound", from: "exchange", to: "dead", props: { dlq: false } },
    );
    for (const edges of [d.edges, [...d.edges].reverse()]) {
      const diagram = { ...d, edges };
      const a = analyzeCapacity(diagram).nodes.worker;
      expect(a.activeReplicas).toBe(6);
      expect(a.assignment?.assignment).toBe("partitions");
      const labels = brokerAssignments(diagram);
      expect(labels.consumers.get("worker")).toMatchObject({ count: 6, spec: { assignment: "partitions" } });
      expect(labels.brokers.get("exchange")?.group).toBe("binding");
    }
    expect(
      brokerAssignments(d, { broker: { partitions: 1 }, shards: { partitions: 7 } }).consumers.get("worker"),
    ).toMatchObject({ count: 7, spec: { assignment: "shards" } });
  });

  it("one finite burst is delivered once across readers sharing a subscription", () => {
    const d = planningP2Fixture();
    const ids = ["worker", "second", "third"];
    for (const id of ids.slice(1)) {
      d.nodes.push({ ...d.nodes[2], id });
      d.edges.push({ ...d.edges[1], id: `read-${id}`, to: id });
    }
    const e = createEngine({ seed: 37 });
    e.load(d);
    e.inject("broker", 240);
    steps(e, 200);
    const s = e.snapshot();
    expect(ids.reduce((sum, id) => sum + s.nodes[id].processed, 0)).toBe(240);
    for (const id of ids) expect(s.nodes[id].processed).toBeGreaterThan(0);
    for (const node of Object.values(s.nodes)) {
      expect(node.backlog + node.inFlight + node.dropped + node.failed + node.deadLettered).toBe(0);
    }
  });
  it("every new broker message is present in all 37 translated catalogs", () => {
    const keys = Object.keys(en).filter((key) => key.startsWith("broker."));
    const files = readdirSync("src/i18n/locales").filter(
      (name) => name.endsWith(".json") && !name.endsWith(".meta.json"),
    );
    expect(files).toHaveLength(37);
    for (const file of files) {
      const messages = JSON.parse(readFileSync(`src/i18n/locales/${file}`, "utf8")) as Record<string, string>;
      for (const key of keys) expect(messages[key], `${file}: ${key}`).toBeTruthy();
    }
  });

  it("producer size and provisioning metadata round-trip without imposing vendor ingest limits", () => {
    const d = planningP2Fixture("azure.event-hubs");
    d.nodes[1].props = { partitions: 3, messageKB: 128, ingestUnits: 2 };
    expect(resolveNodeProps(d, d.nodes[1]).broker).toMatchObject({
      messageKB: 128,
      ingestUnits: 2,
      ingestUnit: "throughput-units",
    });
    const e = run(d);
    steps(e, 200);
    const before = e.snapshot().nodes.worker.processed;
    e.setNodeProps("broker", { ingestUnits: 1, messageKB: 1024 });
    steps(e, 200);
    expect(e.snapshot().nodes.worker.processed - before).toBe(240);
    const result = parseNative(serializeNative(d));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.diagram.nodes[1].props).toMatchObject({ ingestUnits: 2, messageKB: 128 });
    expect(parseNative(serializeNative({ ...d, nodes: [{ ...d.nodes[1], props: { ingestUnits: -1 } }] })).ok).toBe(
      false,
    );
  });

  it("cluster wrapper passes through without a second broker assignment", () => {
    const d = planningP2Fixture("kafka.topic");
    d.edges[0].to = "cluster";
    d.edges.push({ id: "wrapped", from: "cluster", to: "broker", props: { travelMs: 0 } });
    expect(compileTopology(d).groups.has("cluster")).toBe(false);
    expect(analyzeCapacity(d).nodes.worker.activeReplicas).toBe(3);
    const e = run(d);
    steps(e, 200);
    expect(e.snapshot().nodes.worker).toMatchObject({ activeReplicas: 3, inFlight: 12 });
  });

  it("partition controls and presets remain absent on a subscription-only input panel", async () => {
    const { applyPreset, emptyInputs, partitionsNotes } = await import("../live/capacityModel");
    const d = planningP2Fixture();
    const inputs = applyPreset("double-partitions", emptyInputs(), d, null);
    expect(inputs.props).toEqual({});
    expect(partitionsNotes(d, null, { ...emptyInputs(), props: { broker: { partitions: 99 } } }).size).toBe(0);
  });

  it.each(fanout)("%s uses all configured slots and never proposes partitions", (stencil) => {
    const d = planningP2Fixture(stencil);
    const analysis = analyzeCapacity(d);
    expect(analysis.nodes.worker).toMatchObject({ activeReplicas: 8, idleReplicas: 0, capacity: 32 });
    const e = run(d);
    steps(e, 200);
    expect(e.snapshot().nodes.worker).toMatchObject({ activeReplicas: 8, idleReplicas: 0, inFlight: 32 });
    const before = e.snapshot().nodes.worker.processed;
    steps(e, 200);
    expect(e.snapshot().nodes.worker.processed - before).toBe(analysis.nodes.worker.capacity * 20);
    const sim = { id: "s", title: "Sizing", traffic: sourceTraffic(d) };
    const fix = sizingFix(d, sim, [analysis.nodes.worker])!;
    expect(fix.length).toBeGreaterThan(0);
    expect(fix.every((c) => c.key !== "partitions")).toBe(true);
    expect(runChecks(d, { rules: ["capacity"] }).findings[0].fix?.label).not.toMatch(/partition/i);
    expect(nodeSimFields("topic", stencil, d.planning)).not.toContain("partitions");
    expect(capabilities(d, d.nodes[2])[0].broker?.partitioned).toBe(false);
  });

  it.each(["kafka.topic", "azure.event-hubs", "aws.kinesis"])(
    "%s assigns only three instances to the named group",
    (stencil) => {
      const d = planningP2Fixture(stencil);
      const analysis = analyzeCapacity(d);
      expect(analysis.nodes.worker).toMatchObject({ activeReplicas: 3, idleReplicas: 5, capacity: 12 });
      const e = run(d);
      steps(e, 200);
      expect(e.snapshot().nodes.worker).toMatchObject({ activeReplicas: 3, inFlight: 12 });
      const before = e.snapshot().nodes.worker.processed;
      steps(e, 200);
      expect(e.snapshot().nodes.worker.processed - before).toBe(analysis.nodes.worker.capacity * 20);
      e.setNodeProps("broker", { partitions: 8 });
      expect(e.snapshot().nodes.worker.activeReplicas).toBe(8);
    },
  );

  it("SNS and Kafka in the same run use eight versus three instances", () => {
    const d = planningP2Fixture();
    d.nodes.push({ ...d.nodes[1], id: "log", stencil: "kafka.topic" }, { ...d.nodes[2], id: "log-reader" });
    d.edges.push(
      { id: "log-in", from: "source", to: "log" },
      { id: "log-out", from: "log", to: "log-reader", props: { group: "billing" } },
    );
    const e = run(d);
    steps(e, 200);
    expect(e.snapshot().nodes.worker.inFlight).toBe(32);
    expect(e.snapshot().nodes["log-reader"].inFlight).toBe(12);
  });

  it("distinct SNS readers sharing a subscription use every instance, including after a replica edit", () => {
    const d = planningP2Fixture();
    d.nodes[2].props!.replicas = 1;
    for (let i = 1; i < 8; i++) {
      d.nodes.push({ ...d.nodes[2], id: `reader-${i}` });
      d.edges.push({ ...d.edges[1], id: `read-${i}`, to: `reader-${i}` });
    }
    const e = run(d);
    steps(e, 200);
    for (const id of ["worker", ...Array.from({ length: 7 }, (_, i) => `reader-${i + 1}`)])
      expect(e.snapshot().nodes[id].inFlight).toBe(4);
    e.setNodeProps("worker", { replicas: 2 });
    steps(e, 100);
    expect(e.snapshot().nodes.worker.inFlight).toBe(8);
  });

  it.each(["kafka.topic", "aws.sns", "rabbitmq.exchange", "generic.queue"])(
    "%s: independent groups receive copies; queue readers compete",
    (stencil) => {
      const d = planningP2Fixture(stencil);
      d.nodes[0].props!.ratePerSec = 2;
      d.nodes.push({ ...d.nodes[2], id: "other" });
      d.edges.push({ ...d.edges[1], id: "other-read", to: "other", props: { group: "audit", travelMs: 0 } });
      const e = run(d);
      steps(e, 100);
      const snapshot = e.snapshot();
      const sum = snapshot.nodes.worker.processed + snapshot.nodes.other.processed;
      expect(sum).toBe(stencil === "generic.queue" ? 17 : 34);
      if (stencil === "generic.queue") {
        expect(snapshot.nodes.worker.processed).toBeGreaterThan(0);
        expect(snapshot.nodes.other.processed).toBeGreaterThan(0);
      } else {
        expect(snapshot.nodes.worker.processed).toBe(17);
        expect(snapshot.nodes.other.processed).toBe(17);
      }
      expect(snapshot.nodes.dead.processed).toBe(0);
      expect(
        compileTopology(d)
          .groups.get("broker")!
          .map((g) => g.name),
      ).not.toContain("recovery");
      expect(
        capabilities(
          d,
          d.nodes.find((n) => n.id === "dead")!,
        ),
      ).toEqual([]);
    },
  );

  it.each([...fanout, "generic.queue"])(
    "%s delivers the whole burst to each subscription; queues compete",
    (stencil) => {
      const d = planningP2Fixture(stencil);
      d.nodes.push({ ...d.nodes[2], id: "other" });
      d.edges.push({ ...d.edges[1], id: "other-read", to: "other", props: { group: "audit", travelMs: 0 } });
      const e = run(d);
      e.setTraffic(false);
      const count = 37;
      e.inject("source", count);
      steps(e, 200);
      const snapshot = e.snapshot();
      const readers = [snapshot.nodes.worker.processed, snapshot.nodes.other.processed];
      if (stencil === "generic.queue") {
        expect(readers.reduce((a, b) => a + b, 0)).toBe(count);
        for (const processed of readers) expect(processed).toBeGreaterThan(0);
      } else {
        expect(readers).toEqual([count, count]);
      }
      expect(snapshot.nodes.source.processed).toBe(count);
      expect(snapshot.nodes.dead.processed).toBe(0);
      expect(e.metrics()).toMatchObject({ inSystem: 0, pendingInjections: 0 });
      for (const node of Object.values(snapshot.nodes)) {
        expect(node).toMatchObject({ backlog: 0, inFlight: 0, failed: 0, dropped: 0, deadLettered: 0 });
      }
    },
  );

  it("exchange bindings fan out to queues without a broker-hop reservation cap", () => {
    const d = planningP2Fixture("rabbitmq.exchange");
    d.nodes[2].stencil = "rabbitmq.queue";
    d.nodes.push({ ...d.nodes[2], id: "other" });
    d.edges[1].props = { group: "first", travelMs: 900 };
    d.edges.push({ ...d.edges[1], id: "other-read", to: "other", props: { group: "second", travelMs: 900 } });
    const e = run(d);
    steps(e, 100);
    const before = e.snapshot();
    steps(e, 100);
    for (const id of ["worker", "other"])
      expect(e.snapshot().nodes[id].processed - before.nodes[id].processed).toBe(640);
    expect(e.snapshot().nodes.broker.backlog).toBe(0);
  });

  it("one allocator distinguishes logs from subscriptions and deduplicates readers", () => {
    const members = [
      { id: "a", role: "processor" as const, replicas: 8 },
      { id: "a", role: "processor" as const, replicas: 8 },
      { id: "b", role: "processor" as const, replicas: 8 },
    ];
    expect([...allocateGroupReplicas("topic", 3, members, true).values()]).toEqual([2, 1]);
    expect([...allocateGroupReplicas("topic", 3, members, false).values()]).toEqual([8, 8]);
  });

  it("legacy and p1 keep playback until upgrade; native files and legacy loss reports retain the revision", () => {
    const d = planningP2Fixture();
    delete d.planning;
    d.format = "diagrams/v1";
    const p1 = { ...d, format: "diagrams/v2" as const, planning: { revision: "p1" as const } };
    for (const old of [d, p1]) {
      expect(analyzeCapacity(old).nodes.worker.activeReplicas).toBe(3);
      const oldEngine = run(old);
      steps(oldEngine, 200);
      expect(oldEngine.snapshot().nodes.worker).toMatchObject({ activeReplicas: 3, inFlight: 12 });
      const upgraded = upgradePlanning(old);
      expect(analyzeCapacity(upgraded).nodes.worker.activeReplicas).toBe(8);
      const nextEngine = run(upgraded);
      steps(nextEngine, 200);
      expect(nextEngine.snapshot().nodes.worker).toMatchObject({ activeReplicas: 8, inFlight: 32 });
      expect(parseNative(serializeNative(upgraded))).toMatchObject({
        ok: true,
        diagram: { planning: { revision: "p3" } },
      });
      expect(legacyExport(upgraded).losses).toContain("planning.revision");
      expect(analyzeCapacity(legacyExport(upgraded).diagram).nodes.worker.activeReplicas).toBe(3);
    }
    expect(resolveNodeProps(d, d.nodes[4]).broker).toBeUndefined();
    expect(resolveNodeProps(upgradePlanning(d), d.nodes[1]).broker).toMatchObject({
      producerSizeUnit: "kB",
      ingestUnit: "messages/s",
    });
  });

  it("public example precision: legacy findings stay pinned; upgraded findings are reviewed", () => {
    const rows = readdirSync("src/examples", { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => {
        const d = JSON.parse(readFileSync(`src/examples/${entry.name}`, "utf8")) as DiagramFile;
        // P2's migration gate covers older models. New P3 showcases pin their own findings.
        if (
          d.planning?.revision === "p3" ||
          d.planning?.revision === "p3-a1" ||
          d.planning?.revision === "p3-w1" ||
          d.planning?.revision === "p3-w2"
        )
          return undefined;
        const p1 = upgradePlanning(d);
        p1.planning = { revision: "p1" };
        const findings = (d: DiagramFile) =>
          runChecks(d, { rules: ["capacity", "single-point"] }).findings.map((f) => f.id);
        expect(findings(upgradePlanning(d))).toEqual(findings(p1));
        return { example: entry.name.slice(0, -5), before: findings(d), after: findings(upgradePlanning(d)) };
      })
      .filter((row) => row !== undefined);
    // Fifteen retained legacy examples plus the vendor catalogue showcase.
    expect(rows.length).toBe(16);
    expect(rows.filter((r) => JSON.stringify(r.before) !== JSON.stringify(r.after))).toEqual([
      { example: "branch-to-datacentre", before: [], after: ["single-point:branch-router"] },
      { example: "cqrs-event-sourcing", before: [], after: ["single-point:gateway"] },
      {
        example: "event-driven-data-platform",
        before: [],
        after: ["single-point:webhook-receiver", "single-point:checkout"],
      },
      { example: "kafka-order-pipeline", before: [], after: ["single-point:gateway", "single-point:orders"] },
      { example: "outbox-saga-checkout", before: [], after: ["single-point:order-api"] },
      { example: "rag-assistant", before: [], after: ["single-point:rag-api"] },
    ]);
  });
});
