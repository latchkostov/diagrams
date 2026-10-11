import { describe, expect, it, vi } from "vitest";
import type { DiagramFile, Expectation, SimRole, Simulation, TrafficShape } from "../model/types";
import { createEngine } from "./engine";
import { createSimulationRun, estimateTotalMs, trafficRateAt, trafficWindow } from "./simulation";
import type { SimulationRun } from "./types";

const diagram: DiagramFile = {
  format: "diagrams/v1",
  title: "Runner test",
  nodes: [
    { id: "source", stencil: "source", label: "Source", x: 0, y: 0 },
    { id: "broker", stencil: "topic", label: "Events", x: 0, y: 0, props: { partitions: 12 } },
    { id: "worker", stencil: "processor", label: "Worker", x: 0, y: 0, props: { latencyMs: 20, concurrency: 12 } },
    { id: "store", stencil: "store", label: "Store", x: 0, y: 0 },
    { id: "dlq", stencil: "sink", label: "DLQ", x: 0, y: 0 },
  ],
  edges: [
    { id: "publish", from: "source", to: "broker", props: { travelMs: 20 } },
    { id: "consume", from: "broker", to: "worker", props: { group: "workers", travelMs: 20, filter: ["Order*"] } },
    { id: "persist", from: "worker", to: "store", props: { travelMs: 20 } },
    { id: "deadletter", from: "broker", to: "dlq", props: { dlq: true, travelMs: 20 } },
  ],
};
const options = { roleOf: (id: string) => id as SimRole };
function make(patch: Partial<Simulation> = {}, input = diagram): SimulationRun {
  return createSimulationRun(input, { id: "test", title: "Test", seed: 7, traffic: [], ...patch }, options);
}
function finish(run: SimulationRun, speed = 1, dt = 37): void {
  run.setSpeed(speed);
  for (let steps = 0; !run.state().done && steps < 650_000 / (dt * speed) + 100; steps++) {
    if (run.state().waiting) run.resume();
    run.step(dt);
  }
  expect(run.state().done).toBe(true);
  expect(run.state().time).toBeLessThanOrEqual(600_000);
}

describe("runner lifecycle regressions", () => {
  it("drains all scheduled timeline injections before finishing", () => {
    const run = make({ timeline: [{ atMs: 0, action: { do: "inject", node: "dlq", count: 3, spreadMs: 10_000 } }] });
    for (let i = 0; !run.state().done && i < 2000; i++) run.step(10);
    expect(run.state().done).toBe(true);
    expect(run.engine.snapshot().nodes.dlq.processed).toBe(3);
    expect(run.state().time).toBeGreaterThanOrEqual(11_500);
  });
  it("leaves a caller-owned engine's methods intact across reuse", () => {
    const engine = createEngine(options);
    const setSpeed = engine.setSpeed;
    for (let i = 0; i < 100; i++) createSimulationRun(diagram, { id: "r", title: "Reuse", traffic: [] }, { engine });
    expect(engine.setSpeed).toBe(setSpeed);
  });
  it("samples expectations without constructing rendering snapshots", () => {
    const engine = createEngine(options);
    const snapshot = vi.spyOn(engine, "snapshot");
    const run = createSimulationRun(
      diagram,
      {
        id: "r",
        title: "Metrics",
        traffic: [],
        durationMs: 100,
        expectations: [expectation({ metric: { system: "inSystem" }, op: "==", value: 0, when: "always" })],
      },
      { engine },
    );
    run.step(100);
    expect(run.state().expectations[0].status).toBe("pass");
    expect(snapshot).not.toHaveBeenCalled();
  });
});
const metric = { node: "store", field: "processed" } as const;
const expectation = (patch: Partial<Expectation> = {}): Expectation => ({
  id: "e",
  label: "Stored",
  metric,
  op: "==",
  value: 1,
  ...patch,
});

describe("traffic functions and integration", () => {
  it("previews burst rates and windows, including a discrete impulse", () => {
    const shape: TrafficShape = { kind: "burst", count: 100, atMs: 200, spreadMs: 2000 };
    expect(trafficWindow(shape)).toEqual({ startMs: 200, endMs: 2200 });
    expect([-1, 199, 200, 1000, 2200].map((t) => trafficRateAt(shape, t))).toEqual([0, 0, 50, 50, 0]);
    expect(trafficRateAt({ kind: "burst", count: 2 }, 0)).toBe(2000);
  });
  it("previews a constant rate within a half-open window", () => {
    const shape: TrafficShape = { kind: "constant", fromMs: 100, durationMs: 3000, ratePerSec: 12 };
    expect(trafficWindow(shape)).toEqual({ startMs: 100, endMs: 3100 });
    expect([0, 100, 3000, 3100].map((t) => trafficRateAt(shape, t))).toEqual([0, 12, 12, 0]);
  });
  it("ramps from the previous rate through multiple stages", () => {
    const shape: TrafficShape = {
      kind: "ramp",
      fromMs: 100,
      startRate: 10,
      stages: [
        { durationMs: 1000, targetRate: 30 },
        { durationMs: 2000, targetRate: 0 },
      ],
    };
    expect(trafficWindow(shape)).toEqual({ startMs: 100, endMs: 3100 });
    expect([0, 100, 600, 1100, 2100, 3100].map((t) => trafficRateAt(shape, t))).toEqual([0, 10, 20, 30, 15, 0]);
  });
  it("previews spike base, peak and return to base", () => {
    const shape: TrafficShape = {
      kind: "spike",
      baseRate: 10,
      peakRate: 40,
      atMs: 1000,
      peakMs: 500,
      durationMs: 3000,
    };
    expect(trafficWindow(shape)).toEqual({ startMs: 0, endMs: 3000 });
    expect([-1, 0, 999, 1000, 1499, 1500, 3000].map((t) => trafficRateAt(shape, t))).toEqual([
      0, 10, 10, 40, 40, 10, 0,
    ]);
  });
  it.each([
    [{ kind: "burst", count: 101, atMs: 105, spreadMs: 1003 }, 101],
    [{ kind: "burst", count: 57 }, 57],
    [{ kind: "constant", ratePerSec: 23, fromMs: 103, durationMs: 2017 }, 46],
    [
      {
        kind: "ramp",
        startRate: 10,
        stages: [
          { durationMs: 1000, targetRate: 30 },
          { durationMs: 2000, targetRate: 0 },
        ],
      },
      50,
    ],
    [
      {
        kind: "ramp",
        stages: [
          { durationMs: 0, targetRate: 20 },
          { durationMs: 1000, targetRate: 40 },
        ],
      },
      30,
    ],
    [{ kind: "spike", baseRate: 10, peakRate: 40, atMs: 1003, peakMs: 507, durationMs: 3000 }, 45],
  ] as [TrafficShape, number][])("injects the area of %j with per-profile accumulation", (shape, count) => {
    const run = make({ traffic: [{ id: "t", node: "source", messageType: "OrderPlaced", shape }] });
    finish(run);
    expect(run.engine.snapshot().nodes.source.processed).toBe(count);
    expect(run.engine.snapshot().nodes.store.processed).toBe(count);
  });
  it("keeps fractional credits separate across profiles", () => {
    const run = make({
      traffic: ["a", "b"].map((id) => ({
        id,
        node: "source",
        shape: { kind: "constant", ratePerSec: 0.6, durationMs: 1000 },
      })),
    });
    finish(run);
    expect(run.engine.snapshot().nodes.source.processed).toBe(0);
  });
  it("submits a spread burst exactly once when its start time is crossed", () => {
    const run = make({
      traffic: [
        {
          id: "t",
          node: "source",
          messageType: "OrderPlaced",
          shape: { kind: "burst", count: 37, atMs: 105, spreadMs: 703 },
        },
      ],
    });
    const inject = vi.spyOn(run.engine, "inject");
    run.step(100);
    expect(inject).not.toHaveBeenCalled();
    run.step(10);
    expect(inject).toHaveBeenCalledExactlyOnceWith("source", 37, { type: "OrderPlaced", spreadMs: 703 });
    finish(run);
    expect(inject).toHaveBeenCalledTimes(1);
    expect(run.engine.snapshot().nodes.store.processed).toBe(37);
  });
});

describe("timeline, notes and setup", () => {
  it("applies setup before injection, preserves stable same-time ordering and sorts timestamps", () => {
    const run = make({
      setup: {
        status: { worker: "paused", missing: "down" },
        props: { worker: { latencyMs: 0, concurrency: 20 }, missing: { latencyMs: 1 } },
      },
      timeline: [
        { atMs: 100, action: { do: "status", node: "worker", status: "up" } },
        { atMs: 0, action: { do: "inject", node: "worker", count: 3, messageType: "OrderPlaced" } },
        { atMs: 100, action: { do: "props", node: "worker", props: { emits: "OrderStored" } } },
        { atMs: 100, action: { do: "note", text: "Ready", focus: ["worker", "missing"] } },
      ],
    });
    expect(run.engine.snapshot().nodes.worker.backlog).toBe(3);
    run.step(100);
    expect(run.state().note).toEqual({ text: "Ready", focus: ["worker"], atMs: 100 });
    run.step(10);
    expect(
      run.engine
        .snapshot()
        .particles.filter((p) => p.kind === "message")
        .every((p) => p.type === "OrderStored"),
    ).toBe(true);
    finish(run);
    expect(run.engine.snapshot().nodes.store.processed).toBe(3);
  });
  it("status down and recovery grow lag then drain it", () => {
    const run = make({
      setup: { status: { worker: "down" } },
      traffic: [{ id: "t", node: "broker", messageType: "OrderPlaced", shape: { kind: "burst", count: 20 } }],
      timeline: [{ atMs: 500, action: { do: "status", node: "worker", status: "up" } }],
    });
    run.step(400);
    expect(run.engine.snapshot().nodes.broker.lag.workers).toBe(20);
    finish(run);
    expect(run.engine.snapshot().nodes.store.processed).toBe(20);
  });
  it("props actions change processing failures", () => {
    const run = make({
      timeline: [
        { atMs: 0, action: { do: "props", node: "worker", props: { failureRate: 1 } } },
        { atMs: 0, action: { do: "inject", node: "broker", count: 3, messageType: "OrderPlaced" } },
      ],
    });
    finish(run);
    expect(run.engine.snapshot().nodes.broker.deadLettered).toBe(3);
    expect(run.engine.snapshot().nodes.worker.failed).toBe(9);
  });
  it.each([0, 100])("pausing notes at %i block engine time, traffic and following actions until resumed", (atMs) => {
    const run = make({
      traffic: [
        {
          id: "t",
          node: "source",
          messageType: "OrderPlaced",
          shape: { kind: "constant", ratePerSec: 10, durationMs: 1000 },
        },
      ],
      timeline: [
        { atMs, action: { do: "note", text: "Look here", focus: ["broker"], pause: true } },
        { atMs, action: { do: "status", node: "worker", status: "paused" } },
        { atMs: 200, action: { do: "status", node: "worker", status: "up" } },
      ],
    });
    run.setSpeed(4);
    run.step(1000);
    expect(run.state().waiting).toBe(true);
    expect(run.state().time).toBe(atMs);
    const before = run.engine.snapshot();
    run.step(30_000);
    expect(run.engine.snapshot()).toEqual(before);
    expect(run.engine.snapshot().nodes.worker.status).toBe("up");
    run.resume();
    expect(run.engine.snapshot().nodes.worker.status).toBe("paused");
    finish(run);
    expect(run.engine.snapshot().nodes.store.processed).toBe(10);
  });
  it("notes replace earlier notes and expire after six simulation seconds", () => {
    const run = make({
      durationMs: 10_000,
      timeline: [
        { atMs: 0, action: { do: "note", text: "First" } },
        { atMs: 100, action: { do: "note", text: "Second" } },
      ],
    });
    run.step(100);
    expect(run.state().note?.text).toBe("Second");
    run.step(5990);
    expect(run.state().note?.text).toBe("Second");
    run.step(10);
    expect(run.state().note).toBeUndefined();
  });
  it("resumes consecutive same-time pausing notes one at a time", () => {
    const run = make({
      timeline: [
        { atMs: 0, action: { do: "note", text: "First", pause: true } },
        { atMs: 0, action: { do: "note", text: "Second", pause: true } },
        { atMs: 0, action: { do: "inject", node: "worker", count: 1 } },
      ],
    });
    expect(run.state().note?.text).toBe("First");
    run.resume();
    expect(run.state().note?.text).toBe("Second");
    expect(run.state().waiting).toBe(true);
    run.step(1000);
    expect(run.state().time).toBe(0);
    run.resume();
    expect(run.state().waiting).toBe(false);
    finish(run);
    expect(run.engine.snapshot().nodes.store.processed).toBe(1);
  });
  it("computes labelled markers and returns isolated state copies", () => {
    const run = make({
      traffic: [
        {
          id: "t",
          label: "Checkout ramp",
          node: "source",
          shape: { kind: "constant", fromMs: 100, ratePerSec: 1, durationMs: 200 },
        },
      ],
      timeline: [
        { atMs: 0, action: { do: "note", text: "Begin" } },
        { atMs: 50, action: { do: "props", node: "worker", props: {} } },
        { atMs: 50, action: { do: "status", node: "worker", status: "up" } },
        { atMs: 50, action: { do: "inject", node: "worker", count: 0 } },
      ],
    });
    const markers = run.state().markers;
    expect(markers.map((m) => m.kind)).toEqual(["note", "props", "status", "inject", "traffic", "traffic"]);
    expect(markers[4].label).toBe("Checkout ramp");
    markers[0].label = "mutated";
    expect(run.state().markers[0].label).toBe("Begin");
  });
  it("ignores unknown action and traffic node ids", () => {
    const run = make({
      traffic: [{ id: "t", node: "missing", shape: { kind: "burst", count: 3 } }],
      timeline: [
        { atMs: 0, action: { do: "inject", node: "missing", count: 5 } },
        { atMs: 0, action: { do: "status", node: "missing", status: "down" } },
        { atMs: 0, action: { do: "props", node: "missing", props: { latencyMs: 0 } } },
      ],
    });
    finish(run);
    expect(run.engine.snapshot().inSystem).toBe(0);
  });
});

describe("expectations", () => {
  it.each(["always", "eventually", "end", "at"] as const)("%s passes and fails", (when) => {
    for (const succeeds of [true, false]) {
      const run = make({
        traffic: [{ id: "t", node: "source", messageType: "OrderPlaced", shape: { kind: "burst", count: 1 } }],
        expectations: [expectation({ when, atMs: 500, op: succeeds ? ">=" : ">", value: succeeds ? 0 : 100 })],
      });
      finish(run);
      expect(run.state().expectations[0].status).toBe(succeeds ? "pass" : "fail");
      expect(run.state().expectations[0].value).toBe(1);
    }
  });
  it("always failure sticks after recovery; eventually success sticks after value changes", () => {
    const run = make({
      setup: { status: { worker: "paused" } },
      traffic: [{ id: "t", node: "broker", messageType: "OrderPlaced", shape: { kind: "burst", count: 5 } }],
      timeline: [{ atMs: 100, action: { do: "status", node: "worker", status: "up" } }],
      expectations: [
        expectation({ id: "always", metric: { node: "broker", field: "lag" }, value: 0, when: "always" }),
        expectation({
          id: "eventually",
          metric: { node: "broker", field: "lag" },
          op: ">",
          value: 0,
          when: "eventually",
        }),
      ],
    });
    finish(run);
    expect(run.state().expectations).toMatchObject([
      { status: "fail", value: 0 },
      { status: "pass", value: 0 },
    ]);
  });
  it("end and at remain pending until checked, with at checked only once", () => {
    const run = make({
      durationMs: 1000,
      timeline: [{ atMs: 200, action: { do: "inject", node: "store", count: 1 } }],
      expectations: [expectation({ id: "end" }), expectation({ id: "at", when: "at", atMs: 100, value: 0 })],
    });
    expect(run.state().expectations.every((e) => e.status === "pending")).toBe(true);
    run.step(100);
    expect(run.state().expectations[1].status).toBe("pass");
    finish(run);
    expect(run.state().expectations).toMatchObject([
      { status: "pass", value: 1 },
      { status: "pass", value: 1 },
    ]);
  });
  it("checks lag by group and defaults to the maximum, and measures system inSystem", () => {
    const input = structuredClone(diagram);
    input.nodes.push({ id: "other", stencil: "processor", label: "Other", x: 0, y: 0, props: { status: "paused" } });
    input.edges.push({
      id: "other-consume",
      from: "broker",
      to: "other",
      props: { group: "other", filter: ["Invoice"] },
    });
    const run = make(
      {
        durationMs: 100,
        setup: { status: { worker: "paused" } },
        timeline: [
          { atMs: 0, action: { do: "inject", node: "broker", count: 3, messageType: "OrderPlaced" } },
          { atMs: 0, action: { do: "inject", node: "broker", count: 7, messageType: "Invoice" } },
        ],
        expectations: [
          expectation({ id: "group", metric: { node: "broker", field: "lag", group: "workers" }, value: 3 }),
          expectation({ id: "max", metric: { node: "broker", field: "lag" }, value: 7 }),
          expectation({ id: "system", metric: { system: "inSystem" }, value: 10 }),
        ],
      },
      input,
    );
    finish(run);
    expect(run.state().expectations.every((e) => e.status === "pass")).toBe(true);
  });
  it.each(["<", "<=", "==", ">=", ">"] as const)("supports %s comparisons", (op) => {
    const value = op === "<" ? 1 : op === ">" ? -1 : 0;
    const run = make({ expectations: [expectation({ op, value })] });
    finish(run);
    expect(run.state().expectations[0].status).toBe("pass");
  });
  it("fails unreached at and eventually expectations on early termination", () => {
    const run = make({
      durationMs: 20,
      expectations: [expectation({ when: "at", atMs: 100 }), expectation({ id: "eventually", when: "eventually" })],
    });
    finish(run);
    expect(run.state().expectations.every((e) => e.status === "fail")).toBe(true);
  });
  it("ignores metrics for unknown node ids", () => {
    const run = make({ expectations: [expectation({ metric: { node: "missing", field: "processed" } })] });
    finish(run);
    expect(run.state().expectations[0].status).toBe("pending");
  });
});

describe("completion and replay", () => {
  it("stops at duration even with retained messages, and ignores later steps", () => {
    const run = make({
      durationMs: 200,
      setup: { status: { worker: "paused" } },
      traffic: [{ id: "t", node: "broker", messageType: "OrderPlaced", shape: { kind: "burst", count: 2 } }],
    });
    finish(run);
    expect(run.state().time).toBe(200);
    expect(run.engine.snapshot().inSystem).toBe(2);
    const snapshot = run.engine.snapshot();
    run.step(2000);
    run.resume();
    expect(run.engine.snapshot()).toEqual(snapshot);
  });
  it("waits for future timeline/traffic and 1.5 seconds of continuous drain grace", () => {
    const run = make({ timeline: [{ atMs: 3000, action: { do: "inject", node: "store", count: 1 } }] });
    run.step(2000);
    expect(run.state().done).toBe(false);
    finish(run);
    expect(run.state().time).toBe(4550);
    const empty = make();
    finish(empty);
    expect(empty.state().time).toBe(1500);
  });
  it("restarts the drain grace when new work arrives", () => {
    const run = make();
    run.step(1000);
    run.engine.inject("store", 1);
    run.step(490);
    expect(run.state().done).toBe(false);
    finish(run);
    expect(run.state().time).toBe(2550);
  });
  it("stops a zero-duration run immediately and ignores invalid frame times", () => {
    const zero = make({ durationMs: 0 });
    expect(zero.state().done).toBe(true);
    const run = make();
    for (const dt of [0, -1, NaN, Infinity]) run.step(dt);
    expect(run.state().time).toBe(0);
    finish(run);
  });
  it("caps undrainable runs at ten minutes", () => {
    const run = make({
      setup: { status: { worker: "paused" } },
      traffic: [{ id: "t", node: "broker", messageType: "OrderPlaced", shape: { kind: "burst", count: 1 } }],
    });
    finish(run, 8, 1000);
    expect(run.state().time).toBe(600_000);
  });
  it("estimates explicit duration or last scheduled event plus drain allowance", () => {
    expect(estimateTotalMs({ id: "s", title: "s", traffic: [], durationMs: 1234 })).toBe(1234);
    expect(
      estimateTotalMs({
        id: "s",
        title: "s",
        traffic: [{ id: "t", node: "source", shape: { kind: "burst", count: 1, atMs: 3000, spreadMs: 2000 } }],
        timeline: [{ atMs: 7000, action: { do: "note", text: "End" } }],
      }),
    ).toBe(17_000);
    expect(estimateTotalMs({ id: "s", title: "s", traffic: [], durationMs: 900_000 })).toBe(600_000);
  });
  it("same seed, restart, speed and frame sizes give identical final snapshots", () => {
    const simulation: Partial<Simulation> = {
      setup: { props: { worker: { failureRate: 0.35 } } },
      traffic: [
        {
          id: "t",
          node: "source",
          messageType: "OrderPlaced",
          shape: { kind: "spike", baseRate: 20, peakRate: 50, atMs: 1000, peakMs: 1000, durationMs: 3000 },
        },
      ],
      timeline: [{ atMs: 300, action: { do: "props", node: "worker", props: { concurrency: 6 } } }],
    };
    const first = make(simulation);
    finish(first);
    const expected = first.engine.snapshot();
    const fast = make(simulation);
    finish(fast, 4, 111);
    expect(fast.engine.snapshot()).toEqual(expected);
    first.restart();
    finish(first, 4, 23);
    expect(first.engine.snapshot()).toEqual(expected);
    const changed = make(simulation);
    changed.step(713);
    changed.setSpeed(4);
    changed.step(89);
    finish(changed, 0.25, 73);
    expect(changed.engine.snapshot()).toEqual(expected);
  });
  it("reuses and seeds an existing engine and resets setup overrides on restart", () => {
    const existing = createEngine({ ...options, seed: 900 });
    const simulation: Simulation = {
      id: "s",
      title: "s",
      seed: 7,
      setup: { props: { worker: { failureRate: 0.4 } } },
      traffic: [{ id: "t", node: "broker", messageType: "OrderPlaced", shape: { kind: "burst", count: 20 } }],
    };
    const reused = createSimulationRun(diagram, simulation, { ...options, engine: existing });
    expect(reused.engine).toBe(existing);
    finish(reused);
    const fresh = createSimulationRun(diagram, simulation, options);
    finish(fresh);
    expect(reused.engine.snapshot()).toEqual(fresh.engine.snapshot());
    reused.engine.setNodeStatus("worker", "down");
    reused.engine.setNodeProps("worker", { failureRate: 1 });
    reused.restart();
    finish(reused);
    expect(reused.engine.snapshot()).toEqual(fresh.engine.snapshot());
  });
});
