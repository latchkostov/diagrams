import { describe, expect, it, vi } from "vitest";
import { planningFixture } from "../lab/planningFixture";
import { capabilities } from "./capabilities";
import { explainNode } from "./explanation";
import { upgradePlanning, legacyExport } from "./migration";
import { createEngine } from "../sim/engine";
import { createSimulationRun } from "../sim/simulation";
import { analyzeCapacity } from "../sim/capacity";
import { resolveProps, resolveLegacyProps } from "../sim/defaults";
import * as defaults from "../sim/defaults";
import { PROFILES, FAMILIES, PROCESSOR_LESSON } from "../stencils/profiles";
import { catalog } from "../stencils/catalog";
import { validateDiagram, parseNative, serializeNative } from "../interop/native";
import { toFlow, fromFlow } from "../canvas/convert";
import { runChecks } from "../checks/run";
import { realNodeMetrics } from "../sim/units";
import { compileTopology } from "../sim/topology";
import { newPlanningProps } from "../model/planning";
import { diagramDiff } from "../model/diagramDiff";
import { describeDiagram } from "../ai/describe";
import * as topologyModule from "../sim/topology";
import { GROWTH_FACTOR, LINEAR_LIMIT } from "../test/complexity";
import { explanationRate, formatProcessingSeconds } from "./format";

describe("P1 planning contract", () => {
  it("never substitutes family defaults into legacy playback, even after a preset refresh", () => {
    const saved = PROCESSOR_LESSON.values.latencyMs;
    try {
      PROCESSOR_LESSON.values.latencyMs = 900;
      const props = { preset: "processor-lesson", presetRevision: "1" };
      expect(resolveLegacyProps("processor", "Orders", props, "service.dotnet").latencyMs).toBe(250);
      const d = planningFixture();
      d.nodes[1].props = {};
      const next = upgradePlanning(d);
      expect(analyzeCapacity(next).resolved.orders.latencyMs).toBe(250);
    } finally {
      PROCESSOR_LESSON.values.latencyMs = saved;
    }
  });
  it("maps every stencil explicitly without guessing an unknown id's family", () => {
    expect(Object.keys(PROFILES).sort()).toEqual(catalog.map((s) => s.id).sort());
    expect(PROFILES["kafka.topic"].family).toBe("log");
    expect(PROFILES["aws.sns"].family).toBe("pubsub");
    expect(PROFILES["kafka.cluster"].family).toBe("dependency");
    expect(PROFILES["postgres"].family).toBe("sql");
    expect(resolveLegacyProps("processor", "Custom", {}, "unknown").profile.family).toBeUndefined();
    expect(Object.values(FAMILIES).every((f) => f.settings.filter((s) => s.tier === "main").length <= 5)).toBe(true);
    expect(PROCESSOR_LESSON.sources.every((s) => s.evidence === "assumption" && !!s.unit)).toBe(true);
  });

  it("legacy omitted settings ignore a preset and upgrading preserves seeded snapshots and original objects", () => {
    const d = planningFixture("connections");
    d.nodes[1].props = {
      preset: "processor-lesson",
      presetRevision: "1",
      latencyMs: 4000,
      retry: "inplace",
      retryBackoffMs: 50,
    };
    const original = structuredClone(d);
    const upgraded = upgradePlanning(d);
    expect(d).toEqual(original);
    expect(upgraded.edges).toEqual(d.edges);
    const old = createEngine({ seed: 17 }),
      next = createEngine({ seed: 17 });
    old.load(d);
    next.load(upgraded);
    old.setTraffic(true);
    next.setTraffic(true);
    for (let i = 0; i < 300; i++) {
      old.step(100);
      next.step(100);
    }
    expect(next.snapshot()).toEqual(old.snapshot());
    expect(resolveLegacyProps("processor", "Orders", {}, "service.dotnet").profile.revision).toBe("legacy");
    expect(diagramDiff(d, upgraded).metaChanged).toBe(true);
  });

  it("pins defaults, preserves saved setup overrides and round-trips both versions through native and canvas", () => {
    const d = planningFixture();
    d.simulations = [{ id: "test", title: "Test", traffic: [], setup: { props: { orders: { latencyMs: 7000 } } } }];
    for (const doc of [d, upgradePlanning(d)]) {
      const result = parseNative(serializeNative(doc));
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error);
      expect(result.diagram).toEqual(doc);
      const flow = toFlow(doc);
      const copy = fromFlow(flow.meta, flow.nodes, flow.edges);
      expect(copy.planning).toEqual(doc.planning);
      expect(copy.format).toBe(doc.format);
      expect(copy.simulations).toEqual(doc.simulations);
    }
    const upgraded = upgradePlanning(d);
    expect(upgraded.nodes[1].props).toMatchObject({ preset: "processor-lesson", presetRevision: "1", concurrency: 4 });
    expect(analyzeCapacity(upgraded, d.simulations[0]).resolved.orders.latencyMs).toBe(7000);
    expect(newPlanningProps("processor", upgraded.planning)).toMatchObject({ presetRevision: "1" });
    expect(newPlanningProps("processor")).toBeUndefined();
  });

  it("analysis, checks and playback resolve the same node, including setup and live override precedence", () => {
    const d = upgradePlanning(planningFixture());
    const sim = { id: "s", title: "Run", traffic: [], setup: { props: { orders: { concurrency: 8 } } } };
    const expected = resolveProps(
      "processor",
      "Orders",
      { ...d.nodes[1].props, concurrency: 8 },
      "service.dotnet",
      d.planning,
    );
    const spy = vi.spyOn(defaults, "resolveProps");
    const run = createSimulationRun(d, sim, { seed: 4 });
    expect(
      spy.mock.results.some((r) => r.type === "return" && JSON.stringify(r.value) === JSON.stringify(expected)),
    ).toBe(true);
    expect(analyzeCapacity(d, sim).resolved.orders).toEqual(expected);
    run.engine.setNodeProps("orders", { concurrency: 12 });
    expect(run.engine.effectiveProps("orders").concurrency).toBe(12);
    runChecks(d, { rules: ["capacity"] });
    expect(spy.mock.calls.filter((args) => args[1] === "Orders").every((args) => args[4]?.revision === "p2")).toBe(
      true,
    );
    spy.mockRestore();
  });

  it("shows two consumer policies, one shared pool, publishes and calls; reconnection and deletion update capabilities", () => {
    const d = planningFixture("connections"),
      orders = d.nodes[1];
    const rows = capabilities(d, orders);
    expect(rows.filter((r) => r.kind === "consumes").map((r) => r.group)).toEqual(["billing", "returns"]);
    expect(rows.find((r) => r.kind === "publishes")).toMatchObject({ emits: "OrderHandled", peer: "queue" });
    expect(rows.find((r) => r.kind === "calls")).toMatchObject({ peer: "payments" });
    expect(analyzeCapacity(d).nodes.orders.capacity).toBe(1);
    d.edges.find((e) => e.id === "consume")!.to = "payments";
    expect(capabilities(d, orders).filter((r) => r.kind === "consumes")).toHaveLength(1);
    d.edges = d.edges.filter((e) => e.id !== "consume2");
    expect(capabilities(d, orders).some((r) => r.kind === "consumes")).toBe(false);
    expect(capabilities(planningFixture(), planningFixture().nodes[1])).toEqual([]);
    d.edges.push(
      { id: "dep", from: "topic", to: "orders", relation: "telemetry" },
      { id: "dlq", from: "topic", to: "orders", props: { dlq: true } },
      { id: "deny", from: "topic", to: "orders", props: { deny: true } },
    );
    expect(capabilities(d, orders).some((r) => r.kind === "consumes")).toBe(false);
  });

  it("Orders arithmetic names its contributor and differentiates saturation from the chosen 50% target", () => {
    const d = planningFixture();
    const x = explainNode(d, "orders")!;
    expect(x).toMatchObject({
      capacity: 1,
      offered: 3,
      activeReplicas: 1,
      slots: 4,
      seconds: 4,
      growth: 2,
      minimumReplicas: 3,
      targetReplicas: 6,
      target: 0.5,
      fixId: "capacity:orders",
      unit: "req/s",
    });
    expect(x.contributors).toEqual([{ edge: "request", node: "checkout", label: "Checkout", rate: 3 }]);
    for (const [replicas, utilization] of [
      [3, 1],
      [6, 0.5],
    ]) {
      d.nodes[1].props!.replicas = replicas;
      expect(analyzeCapacity(d).nodes.orders.utilization).toBe(utilization);
    }
    d.nodes.push({ id: "f5", stencil: "f5.bigip", label: "F5", x: 320, y: 140 });
    d.edges[0].to = "f5";
    d.edges.push({ id: "via", from: "f5", to: "orders", kind: "sync" });
    expect(explainNode(d, "orders")!.contributors[0]).toMatchObject({ label: "Checkout", via: "F5", rate: 3 });
  });

  it("keeps real arithmetic unchanged at sampling scale and consumes observed real metrics exactly once", () => {
    const d = planningFixture();
    const sim = {
      id: "s",
      title: "Scaled",
      scale: 50,
      traffic: [{ id: "t", node: "checkout", shape: { kind: "constant" as const, ratePerSec: 3, durationMs: 60_000 } }],
    };
    const run = createSimulationRun(d, sim, { seed: 9 });
    run.inject("orders", 200);
    for (let i = 0; i < 600; i++) run.step(100);
    const real = run.units.realSnapshot().nodes.orders;
    expect(real.throughput).toBeGreaterThan(0);
    const x = explainNode(d, "orders", { sim, observed: real })!;
    expect(x).toMatchObject({ capacity: 1, offered: 3, targetReplicas: 6 });
    expect(x.observed).toEqual({
      throughput: real.throughput,
      waiting: real.backlog,
      processed: real.processed,
      inFlight: real.inFlight,
    });
    expect(realNodeMetrics(real, 50)).toBe(real);
  });

  it("no-reader shares the check reason and consumer action, including denied and dead-letter routes", () => {
    const d = planningFixture("no-reader");
    const x = explainNode(d, "topic")!;
    expect(x).toMatchObject({
      reason: "no-reader",
      offered: 3,
      addConsumer: "topic",
      fixId: "no-reader:topic",
      changes: null,
    });
    expect(runChecks(d, { rules: ["no-reader"] }).findings[0].id).toBe(x.fixId);
    d.nodes.push({ id: "dead", stencil: "generic.queue", label: "Dead letters", x: 640, y: 140 });
    d.edges.push({ id: "dlq", from: "topic", to: "dead", props: { dlq: true } });
    expect(explainNode(d, "topic")!.reason).toBe("no-reader");
    d.edges.push({ id: "denied", from: "topic", to: "dead", props: { deny: true, dlq: false } });
    expect(explainNode(d, "topic")!.reason).toBe("no-reader");
  });

  it("separates physical delay, connections and active query slots; refuses unsupported revisions with an explicit path", () => {
    const d = upgradePlanning(planningFixture());
    d.edges[0].props = { travelMs: 450, networkDelayMs: 12 };
    d.nodes.push({
      id: "db",
      stencil: "postgres",
      label: "DB",
      x: 900,
      y: 140,
      props: { connections: 100, querySlots: 8 },
    });
    expect(compileTopology(d).edges[0].travelMs).toBe(450);
    expect(validateDiagram(d).ok).toBe(true);
    d.nodes[2].props!.connections = 0;
    expect(validateDiagram(d).ok).toBe(false);
    d.nodes[2].props!.connections = 100;
    d.nodes[2].props!.querySlots = Infinity;
    expect(validateDiagram(d).ok).toBe(false);
    d.nodes[2].props!.querySlots = 8;
    expect(validateDiagram({ ...d, planning: { revision: "p9" } })).toMatchObject({
      ok: false,
      error: expect.stringContaining("Unsupported planning revision"),
    });
    expect(validateDiagram({ ...d, format: "diagrams/v1" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("diagrams/v2"),
    });
    d.nodes[1].props!.presetRevision = "future";
    expect(validateDiagram(d)).toMatchObject({ ok: false, error: expect.stringContaining("unsupported preset") });
    const legacy = legacyExport(d);
    expect(legacy.losses).toEqual(
      expect.arrayContaining([
        "planning.revision",
        "db.props.connections",
        "db.props.querySlots",
        "request.props.networkDelayMs",
      ]),
    );
    expect(legacy.diagram.nodes[1].props!.latencyMs).toBe(4000);
    expect(validateDiagram(legacy.diagram).ok).toBe(true);
    d.nodes[1].props!.presetRevision = "1";
    d.edges[0].props.networkDelayMs = -1;
    // Edge contract validation belongs to the native reader, not just the generated schema.
    expect(validateDiagram(d).ok).toBe(false);
  });

  it("describe_diagram exposes capabilities and explanations for modest graphs", () => {
    const d = planningFixture("connections");
    const json = JSON.parse(describeDiagram(d, { format: "json" }));
    expect(json.nodes.find((n: { id: string }) => n.id === "orders").capabilities).toHaveLength(4);
    expect(describeDiagram(planningFixture())).toContain('"targetReplicas":6');
  });

  it("pins existing device size values and exposes their evidence without changing legacy playback", () => {
    const props = newPlanningProps("gateway", { revision: "p1" }, "f5.bigip")!;
    expect(props).toMatchObject({ preset: "device-size", presetRevision: "1", size: "campus" });
    const old = resolveLegacyProps("gateway", "F5", {}, "f5.bigip");
    const next = resolveProps("gateway", "F5", props, "f5.bigip", { revision: "p1" });
    expect(next.device).toEqual(old.device);
    expect(next.profile.evidence.find((s) => s.key === "gbps")).toMatchObject({ unit: "Gbps", evidence: "benchmark" });
    expect(
      resolveProps("gateway", "F5", { ...props, gbps: 37 }, "f5.bigip", { revision: "p1" }).profile.evidence[0]
        .evidence,
    ).toBe("assumption");
    const d = planningFixture();
    d.nodes.push({ id: "device", stencil: "f5.bigip", label: "F5", x: 320, y: 400 });
    const upgraded = upgradePlanning(d);
    expect(upgraded.nodes[2].props).toMatchObject({ preset: "device-size", gbps: old.device!.gbps });
    expect(validateDiagram(upgraded).ok).toBe(true);
    expect(
      validateDiagram({
        ...upgraded,
        simulations: [
          {
            id: "s",
            title: "Future preset",
            traffic: [],
            setup: { props: { device: { preset: "device-size", presetRevision: "2" } } },
          },
        ],
      }).ok,
    ).toBe(false);
  });
  it("explains an unavailable processor without offering a sizing fix", () => {
    const d = planningFixture();
    d.nodes[1].props!.status = "down";
    expect(explainNode(d, "orders")).toMatchObject({ status: "down", capacity: 0, changes: null });
  });
  it("describing large graphs reads the connections once rather than per node", () => {
    const compile = topologyModule.compileTopology;
    let reads = 0;
    const spy = vi.spyOn(topologyModule, "compileTopology").mockImplementation((d, role) => {
      const result = compile(d, role);
      return {
        ...result,
        edges: result.edges.map(
          (edge) =>
            new Proxy(edge, {
              get(target, key, receiver) {
                if (key === "to") reads++;
                return Reflect.get(target, key, receiver);
              },
            }),
        ),
      };
    });
    const work = (count: number) => {
      const d = planningFixture();
      d.nodes = Array.from({ length: count }, (_, i) => ({
        id: `n${i}`,
        stencil: "generic.service",
        label: `Service ${i}`,
        x: i * 300,
        y: 0,
      }));
      d.edges = d.nodes.slice(1).map((n, i) => ({ id: `e${i}`, from: d.nodes[i].id, to: n.id, kind: "sync" }));
      reads = 0;
      describeDiagram(d);
      return reads;
    };
    try {
      const small = work(256);
      expect(small).toBeGreaterThan(0);
      expect(work(256 * GROWTH_FACTOR) / small).toBeLessThan(LINEAR_LIMIT);
    } finally {
      spy.mockRestore();
    }
  });
  it("family presets respect the dispatch role and mixed inputs retain generic message units", () => {
    const props = { preset: "processor-lesson", presetRevision: "1" };
    const gateway = resolveProps("gateway", "Override", props, "service.dotnet", { revision: "p1" });
    expect(gateway.latencyMs).toBe(60);
    expect(gateway.profile.preset).toBeUndefined();
    const d = planningFixture();
    d.nodes.push({ id: "topic", stencil: "kafka.topic", label: "Events", x: 320, y: 420 });
    d.edges.push(
      { id: "publish", from: "checkout", to: "topic", kind: "async" },
      { id: "consume", from: "topic", to: "orders", kind: "async" },
    );
    expect(explainNode(d, "orders")).toMatchObject({ unit: "msg/s", offered: 6, capacity: 1 });
  });
  it("arithmetic never rounds a nonzero duration or sparse rate to zero", () => {
    expect(formatProcessingSeconds(0.001)).toBe("0.001");
    expect(explanationRate(0.001, "req/s")).toBe("0.001 req/s");
    expect(explanationRate(0.001, "msg/s")).toBe("0.001 msg/s");
  });
  it("connections show executable filters and omit dormant gateway and broker share settings", () => {
    const d = planningFixture("connections");
    d.nodes[0].stencil = "nginx";
    d.edges[0].props = { share: 0, filter: ["Checkout"] };
    expect(capabilities(d, d.nodes[0])[0]).toMatchObject({ filter: ["Checkout"] });
    expect(capabilities(d, d.nodes[0])[0].share).toBeUndefined();
    d.edges.push({ id: "relay", from: "topic", to: "queue", props: { share: 0 } });
    expect(capabilities(d, d.nodes[2]).find((r) => r.edge === "relay")!.share).toBeUndefined();
    d.edges.find((e) => e.id === "call")!.props = { share: 0.5, filter: ["Checkout"] };
    expect(capabilities(d, d.nodes[1]).find((r) => r.kind === "calls")).toMatchObject({
      share: 0.5,
      filter: ["Checkout"],
    });
  });
});
