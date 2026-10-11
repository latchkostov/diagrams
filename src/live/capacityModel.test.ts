import { describe, expect, it } from "vitest";
import { DIAGRAM_FORMAT, type DiagramFile, type Simulation } from "../model/types";
import kafka from "../examples/kafka-order-pipeline.json";
import iot from "../examples/iot-telemetry.json";
import {
  applyPreset,
  CAPACITY_STOPS,
  capacityView,
  computeFix,
  effectiveSimulation,
  emptyInputs,
  entryRates,
  formatMultiplier,
  formatRateInput,
  formatUtilization,
  freePlayProps,
  freePlayScale,
  freePlaySimulation,
  hasInputs,
  heatLevel,
  inputsWithoutFix,
  isPresetActive,
  nearestStop,
  parseRate,
  rateFromSlider,
  rateSliderMax,
  scaleOptions,
  scaleShape,
  selectRows,
  setEntryRate,
  sliderFromRate,
  TRAFFIC_STOPS,
  withFix,
} from "./capacityModel";

const KAFKA = kafka as DiagramFile;
const IOT = iot as DiagramFile;
const blackFriday = KAFKA.simulations!.find((s) => s.id === "black-friday")!;
const hotSpot = IOT.simulations!.find((s) => s.id === "hot-spot")!;

/** api → topic (3 partitions) → worker (6 replicas) → db, plus a second, idle consumer group. */
const small = (): DiagramFile => ({
  format: DIAGRAM_FORMAT,
  title: "small",
  nodes: [
    { id: "api", stencil: "client.browser", label: "Shop", x: 0, y: 0, props: { ratePerSec: 100 } },
    { id: "topic", stencil: "kafka.topic", label: "orders.created", x: 0, y: 0, props: { partitions: 3 } },
    {
      id: "worker",
      stencil: "service.go",
      label: "Payments",
      x: 0,
      y: 0,
      props: { replicas: 6, concurrency: 1, latencyMs: 50 },
    },
    { id: "audit", stencil: "service.java", label: "Audit", x: 0, y: 0, props: { latencyMs: 10 } },
    { id: "db", stencil: "postgres", label: "Ledger", x: 0, y: 0 },
  ],
  edges: [
    { id: "e1", from: "api", to: "topic" },
    { id: "e2", from: "topic", to: "worker", props: { group: "payments" } },
    { id: "e3", from: "topic", to: "audit", props: { group: "audit" } },
    { id: "e4", from: "worker", to: "db", kind: "sync" },
  ],
});

describe("heat levels and formatting", () => {
  it("colours by utilization: green < 60%, amber to 90%, red, pulsing above 100%", () => {
    expect(heatLevel(0.59, 10)).toBe("ok");
    expect(heatLevel(0.6, 10)).toBe("warn");
    expect(heatLevel(0.89, 10)).toBe("warn");
    expect(heatLevel(0.9, 10)).toBe("hot");
    expect(heatLevel(1, 10)).toBe("hot");
    expect(heatLevel(1.01, 10)).toBe("over");
    expect(heatLevel(Infinity, 10)).toBe("over");
    expect(heatLevel(0, 0)).toBe("idle");
  });

  it("formats rates for input boxes without losing precision", () => {
    expect(formatRateInput(25)).toBe("25");
    expect(formatRateInput(2.5)).toBe("2.5");
    expect(formatRateInput(2000)).toBe("2k");
    expect(formatRateInput(1250)).toBe("1.25k");
    expect(formatRateInput(1234)).toBe("1,234");
    expect(formatRateInput(1_500_000)).toBe("1.5M");
    expect(formatRateInput(0)).toBe("0");
  });

  it("parses k / M suffixes, separators and units", () => {
    expect(parseRate("2000")).toBe(2000);
    expect(parseRate("2,000")).toBe(2000);
    expect(parseRate("2k")).toBe(2000);
    expect(parseRate(" 1.5 M ")).toBe(1_500_000);
    expect(parseRate("2.5/s")).toBe(2.5);
    expect(parseRate("40 msg/s")).toBe(40);
    expect(parseRate("")).toBeNaN();
    expect(parseRate("-3")).toBeNaN();
    expect(parseRate("lots")).toBeNaN();
  });

  it("formats utilization and multipliers", () => {
    expect(formatUtilization(0.823)).toBe("82%");
    expect(formatUtilization(2.34)).toBe("234%");
    expect(formatUtilization(80)).toBe("80×");
    expect(formatUtilization(Infinity)).toBe("∞");
    expect(formatMultiplier(3)).toBe("3×");
    expect(formatMultiplier(0.25)).toBe("0.25×");
    expect(formatMultiplier(1.25)).toBe("1.3×");
  });

  it("slider stops cover the ranges on a log scale and include the round values", () => {
    expect(TRAFFIC_STOPS[0]).toBe(0.1);
    expect(TRAFFIC_STOPS.at(-1)).toBe(10);
    expect(TRAFFIC_STOPS).toContain(3);
    expect(TRAFFIC_STOPS).toContain(5);
    expect(CAPACITY_STOPS).toContain(0.5);
    expect(TRAFFIC_STOPS[nearestStop(TRAFFIC_STOPS, 2.9)]).toBe(3);
    expect(TRAFFIC_STOPS[nearestStop(TRAFFIC_STOPS, 1)]).toBe(1);
  });

  it("maps the rate slider logarithmically with round values, and back", () => {
    const max = rateSliderMax(2000);
    expect(max).toBe(20_000);
    expect(rateFromSlider(0, max)).toBe(0);
    expect(rateFromSlider(120, max)).toBe(20_000);
    const pos = sliderFromRate(2000, max);
    expect(rateFromSlider(pos, max)).toBeGreaterThan(1800);
    expect(rateFromSlider(pos, max)).toBeLessThan(2200);
    expect(String(rateFromSlider(77, max))).toMatch(/^\d{1,2}0*$/);
  });

  it("offers the 1/2/5 series for the dot scale, always including the current one", () => {
    expect(scaleOptions(50, 50)).toEqual(expect.arrayContaining([1, 2, 5, 10, 20, 50, 100, 1000]));
    expect(scaleOptions(1, 7)).toContain(7);
  });
});

describe("inputs → simulation", () => {
  it("scales an entry point's profiles to a new peak, or adds a steady one", () => {
    const sim = structuredClone(blackFriday);
    setEntryRate(sim, "shopper", 6000);
    expect(sim.traffic[0].shape).toMatchObject({ kind: "constant", ratePerSec: 6000, durationMs: 10_000 });
    setEntryRate(sim, "metrics", 10);
    expect(sim.traffic.at(-1)).toMatchObject({
      node: "metrics",
      shape: { kind: "constant", ratePerSec: 10, fromMs: 0, durationMs: 10_000 },
    });
    expect(scaleShape({ kind: "burst", count: 100, spreadMs: 1000 }, 2.5)).toMatchObject({ count: 250 });
    expect(
      scaleShape({ kind: "ramp", startRate: 10, stages: [{ durationMs: 1000, targetRate: 50 }] }, 2),
    ).toMatchObject({ startRate: 20, stages: [{ targetRate: 100 }] });
  });

  it("applies multipliers, scale and prop overrides without touching the saved simulation", () => {
    const before = JSON.stringify(blackFriday);
    const sim = effectiveSimulation(blackFriday, {
      traffic: 3,
      scale: 100,
      props: { payments: { latencyMs: 300 } },
      rates: {},
    });
    expect(sim.multipliers).toEqual({ traffic: 3, capacity: 1 });
    expect(sim.scale).toBe(100);
    expect(sim.setup?.props?.payments).toEqual({ replicas: 6, latencyMs: 300 });
    expect(JSON.stringify(blackFriday)).toBe(before);
    expect(effectiveSimulation(blackFriday, emptyInputs())).toEqual(blackFriday);
    expect(hasInputs(emptyInputs())).toBe(false);
    expect(hasInputs({ ...emptyInputs(), traffic: 1 })).toBe(true);
  });

  it("free play: sources become steady traffic, the engine gets rate × traffic, scale is automatic", () => {
    const d = small();
    const sim = freePlaySimulation(d, { ...emptyInputs(), traffic: 2 });
    expect(sim.traffic).toEqual([
      expect.objectContaining({ node: "api", shape: expect.objectContaining({ ratePerSec: 100 }) }),
    ]);
    expect(sim.multipliers).toEqual({ traffic: 2, capacity: 1 });
    expect(freePlayProps(d, { ...emptyInputs(), traffic: 2 })).toEqual({ api: { ratePerSec: 200 } });
    expect(freePlayProps(d, emptyInputs())).toEqual({});
    expect(freePlayScale(d, emptyInputs())).toBe(2);
    expect(freePlayScale(d, { ...emptyInputs(), rates: { api: 30 } })).toBe(1);
    expect(freePlayScale(d, { ...emptyInputs(), scale: 10 })).toBe(10);
  });

  it("entry points are sources plus nodes with traffic, at their base peak rate", () => {
    expect([...entryRates(KAFKA, blackFriday, emptyInputs())]).toEqual([["shopper", 2000]]);
    expect([...entryRates(KAFKA, null, emptyInputs())]).toEqual([["shopper", 25]]);
    expect(entryRates(KAFKA, blackFriday, { ...emptyInputs(), rates: { shopper: 3000 } }).get("shopper")).toBe(3000);
  });
});

describe("capacity view", () => {
  it("Kafka Black Friday makes sense with zero input: busy but healthy, databases stay neutral", () => {
    const view = capacityView(KAFKA, blackFriday);
    expect(view.nodes.payments).toMatchObject({ level: "warn", text: "78% · 2k/s of 2.6k/s" });
    expect(view.nodes["payment-db"].level).toBe("idle");
    expect(view.nodes.gateway.level).toBe("idle");
    expect(view.tone).toBe("warn");
    expect(view.fix).toBeNull();
  });

  it("3× traffic saturates payments; the fix raises replicas and lands everything in green", () => {
    const sim = effectiveSimulation(blackFriday, { ...emptyInputs(), traffic: 3 });
    const view = capacityView(KAFKA, sim);
    expect(view.nodes.payments.level).toBe("over");
    expect(view.headline).toMatch(/over capacity/);
    expect(view.fix?.changes).toEqual(
      expect.arrayContaining([{ nodeId: "payments", label: "Payments service", key: "replicas", from: 6, to: 26 }]),
    );
    const fixed = capacityView(KAFKA, withFix(sim, view.fix!));
    for (const id of ["orders", "inventory", "payments", "notifications", "order-events", "payment-events"])
      expect(fixed.nodes[id].level, id).toBe("ok");
    expect(fixed.fix).toBeNull();
  });

  it("idle replicas behind too few partitions: the headline explains and the fix adds partitions", () => {
    const view = capacityView(IOT, hotSpot);
    expect(view.top?.id).toBe("hot");
    expect(view.headline).toBe("Device state projector: 63 of 64 replicas idle");
    expect(view.detail).toMatch(/can't use more consumers than partitions/);
    expect(view.fix?.changes).toEqual([expect.objectContaining({ nodeId: "hub", key: "partitions", from: 1, to: 64 })]);
    expect(capacityView(IOT, withFix(hotSpot, view.fix!)).nodes.hot.idleReplicas).toBe(0);
  });

  it("a saturated consumer behind a topic needs partitions as well as replicas", () => {
    const d = small();
    // 100/s × 3 = 300/s into Payments: 3 active replicas × 20/s = 60/s.
    const sim = freePlaySimulation(d, { ...emptyInputs(), traffic: 3 });
    const view = capacityView(d, sim);
    expect(view.nodes.worker).toMatchObject({ level: "over", activeReplicas: 3, idleReplicas: 3 });
    const fix = computeFix(d, sim, view.nodes, view.top)!;
    const replicas = fix.changes.find((c) => c.key === "replicas")!;
    const partitions = fix.changes.find((c) => c.key === "partitions")!;
    expect(replicas).toMatchObject({ nodeId: "worker", from: 6 });
    expect(partitions).toMatchObject({ nodeId: "topic", from: 3, to: replicas.to });
    expect(capacityView(d, withFix(sim, fix)).nodes.worker.level).toBe("ok");
  });

  it("fixes are written as base values under Capacity ×", () => {
    const sim = effectiveSimulation(blackFriday, { ...emptyInputs(), traffic: 1.5, capacity: 0.5 });
    const view = capacityView(KAFKA, sim);
    const payments = view.fix!.changes.find((c) => c.nodeId === "payments")!;
    expect(payments.from).toBe(6);
    // Effective replicas are base × 0.5, so the base doubles what the analysis asked for.
    expect(capacityView(KAFKA, withFix(sim, view.fix!)).nodes.payments.level).toBe("ok");
    expect(payments.to).toBeGreaterThan(12);
  });

  it("no traffic: says so instead of guessing", () => {
    const view = capacityView(small(), freePlaySimulation(small(), { ...emptyInputs(), rates: { api: 0 } }));
    expect(view.top).toBeUndefined();
    expect(view.headline).toBe("No traffic to analyze");
  });

  it("dropping a fix's overrides keeps the rest", () => {
    const fix = { label: "", changes: [{ nodeId: "a", label: "A", key: "replicas" as const, from: 1, to: 2 }] };
    expect(
      inputsWithoutFix({ ...emptyInputs(), props: { a: { replicas: 4, latencyMs: 9 }, b: { replicas: 1 } } }, fix)
        .props,
    ).toEqual({ a: { latencyMs: 9 }, b: { replicas: 1 } });
    expect(inputsWithoutFix({ ...emptyInputs(), props: { a: { replicas: 4 } } }, fix).props).toEqual({});
  });
});

describe("panel rows", () => {
  const many = (): DiagramFile => {
    const d = small();
    for (let i = 0; i < 6; i++) {
      d.nodes.push({
        id: `svc${i}`,
        stencil: "service.node",
        label: `Svc ${i}`,
        x: 0,
        y: 0,
        props: { latencyMs: 10 + i * 40 },
      });
      d.edges.push({ id: `x${i}`, from: "api", to: `svc${i}` });
    }
    return d;
  };

  it("shows the busiest services plus the bottleneck's fix targets, hiding the rest behind Show all", () => {
    const d = many();
    const sim = freePlaySimulation(d, { ...emptyInputs(), traffic: 3 });
    const view = capacityView(d, sim);
    const rows = selectRows(d, view, entryRates(d, null, emptyInputs()).keys(), { limit: 2 });
    expect(rows.entries).toEqual(["api"]);
    expect(rows.services[0]).toBe(view.top!.id);
    for (const c of view.fix!.changes) expect([...rows.services, ...rows.brokers]).toContain(c.nodeId);
    expect(rows.hidden).toBeGreaterThan(0);
    const all = selectRows(d, view, ["api"], { showAll: true });
    expect(all.services).toHaveLength(8);
    expect(all.hidden).toBe(0);
    // Busiest first.
    const u = all.services.map((id) => view.nodes[id].utilization);
    expect([...u].sort((a, b) => b - a)).toEqual(u);
  });
});

describe("presets", () => {
  const sim: Simulation = blackFriday;
  it("Black Friday, Half the pods and Double partitions combine; Normal resets them", () => {
    let inputs = applyPreset("black-friday", emptyInputs(), KAFKA, sim);
    expect(inputs.traffic).toBe(5);
    inputs = applyPreset("half-pods", inputs, KAFKA, sim);
    expect(inputs.capacity).toBe(0.5);
    inputs = applyPreset("double-partitions", inputs, KAFKA, sim);
    expect(inputs.props["order-events"]).toEqual({ partitions: 128 });
    expect(inputs.props["payment-events"]).toEqual({ partitions: 128 });
    // Idempotent: doubling again doesn't quadruple.
    expect(applyPreset("double-partitions", inputs, KAFKA, sim).props["order-events"]).toEqual({ partitions: 128 });
    for (const id of ["black-friday", "half-pods", "double-partitions"] as const)
      expect(isPresetActive(id, inputs, KAFKA, sim)).toBe(true);
    expect(isPresetActive("normal", inputs, KAFKA, sim)).toBe(false);
    const normal = applyPreset(
      "normal",
      { ...inputs, props: { ...inputs.props, payments: { latencyMs: 90 } } },
      KAFKA,
      sim,
    );
    expect(normal).toMatchObject({ traffic: 1, capacity: 1, props: { payments: { latencyMs: 90 } } });
    expect(normal.props["order-events"]).toBeUndefined();
    expect(isPresetActive("normal", normal, KAFKA, sim)).toBe(true);
    expect(isPresetActive("normal", emptyInputs(), KAFKA, sim)).toBe(true);
  });

  it("presets change the analysis the way their names say", () => {
    const util = (inputs: ReturnType<typeof emptyInputs>) =>
      capacityView(KAFKA, effectiveSimulation(sim, inputs)).nodes.payments.utilization;
    const normal = util(emptyInputs());
    expect(util(applyPreset("black-friday", emptyInputs(), KAFKA, sim))).toBeCloseTo(normal * 5);
    expect(util(applyPreset("half-pods", emptyInputs(), KAFKA, sim))).toBeCloseTo(normal * 2);
  });
});

describe("fourth review planning regressions", () => {
  it("bounds scale options even when automatic bounds overflow", () => {
    for (const auto of [Infinity, NaN, Number.MAX_VALUE, Number.MAX_SAFE_INTEGER]) {
      const options = scaleOptions(auto, 50);
      expect(options).toContain(50);
      expect(options.length).toBeLessThanOrEqual(25);
      expect(options.every((v) => Number.isFinite(v) && v >= 1)).toBe(true);
    }
  });

  it("partition fixes give headroom with a nonprocessor in the same filtered group", () => {
    const d = small();
    d.nodes.find((n) => n.id === "topic")!.props = { partitions: 1 };
    d.nodes.find((n) => n.id === "worker")!.props = { replicas: 1, concurrency: 1, latencyMs: 100 };
    d.edges = d.edges.filter((e) => e.to !== "audit");
    d.edges.find((e) => e.id === "e2")!.props = { group: "shared", filter: ["Order"] };
    d.edges.push({ id: "sink", from: "topic", to: "db", props: { group: "shared", filter: ["Invoice"] } });
    const sim: Simulation = {
      id: "r",
      title: "r",
      traffic: [
        { id: "t", node: "api", messageType: "Order", shape: { kind: "constant", ratePerSec: 100, durationMs: 1000 } },
      ],
    };
    const view = capacityView(d, sim);
    expect(view.fix).not.toBeNull();
    const fixed = capacityView(d, withFix(sim, view.fix!));
    expect(fixed.nodes.worker.utilization).toBeLessThanOrEqual(0.6);
    expect(fixed.nodes.topic.utilization).toBeLessThanOrEqual(0.6);
  });
});
