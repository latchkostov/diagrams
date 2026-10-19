import { expect, it } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import { resourceLesson } from "../model/autoscaling";
import { createEngine } from "./engine";
import { analyzeCapacity } from "./capacity";
import { realSnapshot } from "./units";
import { callPolicy } from "./callPolicy";
import { PROFILES } from "../stencils/profiles";

function fixture(replyMs = 10, poolConnections?: number) {
  const d = waitingFixture();
  d.edges[1].props = { caller: { wait: "non-blocking", replyMs, poolConnections } };
  return d;
}

it("defaults by caller family and safely handles unknown stencil names", () => {
  for (const id of [
    "generic.service",
    ...Object.keys(PROFILES).filter((id) => PROFILES[id].family === "serverless"),
    "constructor",
    "__proto__",
  ])
    expect(callPolicy(id).blocking).toBe(true);
  for (const id of Object.keys(PROFILES).filter((id) =>
    ["device", "workflow", "proxy", "api-gateway"].includes(PROFILES[id].family),
  ))
    expect(callPolicy(id).blocking, id).toBe(false);
});

it("releases threads during the call and charges the reply slice exactly once", () => {
  const d = fixture(40);
  const e = createEngine({ seed: 17 });
  e.load(d);
  e.inject("source", 8);
  e.step(50);
  expect(e.snapshot().nodes.caller.threads).toMatchObject({ working: 0, waiting: 0, inFlight: 8 });
  expect(e.snapshot().edges.call.calls).toMatchObject({ inFlight: 8, held: 0 });
  e.step(220);
  expect(e.snapshot().nodes.caller.processed).toBe(0);
  e.step(100);
  expect(e.snapshot().nodes.caller.processed).toBe(8);
  expect(e.snapshot().inSystem).toBe(0);
});

it("caps calls in flight and queues extra calls without holding threads", () => {
  const e = createEngine({ seed: 17 });
  e.load(fixture(10, 2));
  e.inject("source", 8);
  e.step(50);
  expect(e.snapshot().edges.call.calls).toMatchObject({ inFlight: 2, held: 0 });
  expect(e.snapshot().nodes.caller.threads).toMatchObject({ working: 0, waiting: 0 });
  const cp = e.checkpoint();
  e.step(1500);
  const expected = e.snapshot();
  expect(expected.nodes.caller.processed).toBe(8);
  expect(expected.inSystem).toBe(0);
  e.restore(cp);
  e.step(1500);
  expect(e.snapshot()).toEqual(expected);
  expect(analyzeCapacity(fixture(10, 2)).nodes.caller.capacity).toBe(8);
});

it.each([1, 2, 10])("planner and sampled execution agree at scale %s", (scale) => {
  const d = fixture();
  d.nodes[0].props!.ratePerSec = 200;
  const e = createEngine({ seed: 17, scale });
  e.load(d);
  e.setTraffic(true);
  e.step(3000);
  const before = realSnapshot(e.snapshot()).nodes.caller.processed;
  e.step(10000);
  const rate = (realSnapshot(e.snapshot()).nodes.caller.processed - before) / 10;
  expect(analyzeCapacity(d).nodes.caller.capacity).toBe(200);
  expect(Math.abs(rate * 10 - 2000)).toBeLessThanOrEqual(scale);
});

it("charges continuation CPU and retains off-thread memory", () => {
  const d = fixture();
  d.nodes[1].props!.resources = { ...resourceLesson(), cpuMsPerMessage: 100, cpuLimitMilli: 1000 };
  const e = createEngine({ seed: 17 });
  e.load(d);
  e.inject("source", 1000);
  let memory = 0,
    inFlight = 0;
  for (let i = 0; i < 300; i++) {
    e.step(10);
    const n = e.snapshot().nodes.caller;
    memory = Math.max(memory, n.resources!.memoryMiB);
    inFlight = Math.max(inFlight, n.threads?.inFlight ?? 0);
  }
  const before = e.snapshot().nodes.caller.processed;
  e.step(10000);
  const s = e.snapshot().nodes.caller;
  expect((s.processed - before) / 10).toBeCloseTo(analyzeCapacity(d).nodes.caller.capacity, 0);
  expect(inFlight).toBeGreaterThan(0);
  expect(memory).toBeGreaterThan(128 + 4 * 2);
});

it.each([1, 10])("a capped sampled call reserves real connections at scale %s", (scale) => {
  const d = fixture(10, 2);
  const e = createEngine({ seed: 17, scale });
  e.load(d);
  e.inject("source", 100 / scale);
  let high = 0;
  for (let i = 0; i < 1000; i++) {
    e.step(10);
    const s = realSnapshot(e.snapshot());
    high = Math.max(high, s.edges.call.calls!.inFlight);
    expect(s.edges.call.calls!.inFlight).toBeLessThanOrEqual(2);
    expect(s.nodes.caller.threads!.inFlight ?? 0).toBeLessThanOrEqual(2);
    expect(s.nodes.caller.threads!.waiting).toBe(0);
  }
  expect(high).toBe(2);
  const s = realSnapshot(e.snapshot());
  expect(Math.abs(s.nodes.caller.processed - 80)).toBeLessThanOrEqual(scale + 2);
});

it("frees a mixed fan-out's thread when the blocking sibling replies", () => {
  const d = fixture(20);
  d.nodes.push({ ...d.nodes[2], id: "fast", props: { latencyMs: 50, api: { latencyMs: 50 }, jitter: 0 } });
  d.edges.push({ id: "held", from: "caller", to: "fast", kind: "sync", props: { caller: { wait: "blocking" } } });
  const e = createEngine({ seed: 17 });
  e.load(d);
  e.inject("source", 1);
  e.step(40);
  expect(e.snapshot().nodes.caller.threads!.waiting).toBe(1);
  expect(e.snapshot().edges.call.calls!.held).toBe(0);
  e.step(50);
  expect(e.snapshot().nodes.caller.threads!.waiting).toBe(0);
  expect(e.snapshot().nodes.caller.processed).toBe(0);
  e.step(300);
  expect(e.snapshot().nodes.caller.processed).toBe(1);
  expect(analyzeCapacity(d).nodes.caller.waits!.holdMs).toBe(80);
});

it("prioritizes reply continuations over new work and checkpoints the resume queue", () => {
  const d = fixture(30);
  d.nodes[1].props!.concurrency = 1;
  const e = createEngine({ seed: 17 });
  e.load(d);
  e.inject("source", 1000);
  e.step(280);
  const cp = e.checkpoint();
  e.step(100);
  const expected = e.snapshot();
  expect(expected.nodes.caller.processed).toBeGreaterThan(0);
  e.restore(cp);
  e.step(100);
  expect(e.snapshot()).toEqual(expected);
  e.setNodeStatus("partner", "down");
  e.step(1000);
  expect(e.snapshot().nodes.caller.failed).toBeGreaterThan(0);
});

it("keeps authored waiting settings dormant in historical revisions", () => {
  const d = fixture(100, 1);
  d.planning!.revision = "p3-a1";
  const e = createEngine({ seed: 17 });
  e.load(d);
  e.inject("source", 8);
  e.step(100);
  expect(e.snapshot().nodes.caller.processed).toBe(8);
  expect(e.snapshot().nodes.caller.threads).toBeUndefined();
  expect(e.snapshot().edges.call.calls).toBeUndefined();
  expect(analyzeCapacity(d).nodes.caller.capacity).toBe(400);
});

it("does not let broker prefetch impose an implicit cap on off-thread calls", () => {
  const d = fixture();
  d.nodes[0].stencil = "generic.topic";
  d.nodes[0].props = { partitions: 1 };
  d.nodes[2].props = { latencyMs: 2500, api: { latencyMs: 2500 }, jitter: 0 };
  const e = createEngine({ seed: 17 });
  e.load(d);
  e.inject("source", 2000);
  e.step(10000);
  expect(e.snapshot().nodes.caller.processed).toBeGreaterThan(1000);
  e.step(30000);
  expect(e.snapshot().inSystem).toBe(0);
});
