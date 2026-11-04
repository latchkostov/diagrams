import { afterEach, expect, it, vi } from "vitest";
import { cacheFixture } from "../lab/cacheFixture";
import { autoscalingFixture } from "../lab/autoscalingFixture";
import type { Simulation } from "../model/types";
import type { EditorApi } from "../editor/types";

const simulation: Simulation = {
  id: "cache",
  title: "Cache requests",
  durationMs: 1000,
  traffic: [{ id: "read", node: "source", shape: { kind: "burst", count: 10, spreadMs: 100 } }],
};

// The ordinary unit setup installs the runtime. These entry points must work in a
// fresh realm too, before Live or any cache inspector has ever been opened.
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("headless planning starts a cache run in a fresh realm", async () => {
  vi.resetModules();
  const { createHeadlessRun, advanceHeadless } = await import("./headless");
  const run = createHeadlessRun(cacheFixture(), simulation, { remaining: 1000 });
  advanceHeadless(run, 1000);
  expect(run.engine.snapshot().nodes.cache.cache?.misses).toBeGreaterThan(0);
});

it("the scenario planner and agent description can size a cache diagram before Live", async () => {
  vi.resetModules();
  const { planScaling } = await import("./scalingPlanner");
  const { describeDiagram } = await import("../ai/describe");
  const diagram = cacheFixture();
  diagram.nodes[2] = { ...autoscalingFixture().nodes[1], id: "origin" };
  diagram.simulations = [simulation];
  expect(planScaling(diagram)[0]).toMatchObject({ simulation: "cache", status: "planned" });
  expect(describeDiagram(diagram)).toContain("Cache requests");
});

it("the browser's no-worker planning fallback awaits cache playback before sizing", async () => {
  vi.resetModules();
  vi.stubEnv("SSR", false);
  vi.stubGlobal("Worker", undefined);
  const { planOffThread } = await import("../canvas/checks/runner");
  const diagram = cacheFixture();
  diagram.nodes[2] = { ...autoscalingFixture().nodes[1], id: "origin" };
  diagram.simulations = [simulation];
  expect((await planOffThread(diagram))[0]).toMatchObject({ simulation: "cache", status: "planned" });
});

it("Checks evidence plays cache simulations in a fresh realm", async () => {
  vi.resetModules();
  const { collectEvidence } = await import("../checks/evidence");
  const evidence = collectEvidence({ ...cacheFixture(), simulations: [simulation] }, { now: () => 0 });
  expect(evidence.played.map((s) => s.id)).toEqual([simulation.id]);
});

it("headless traces can fetch through a cache in a fresh realm", async () => {
  vi.resetModules();
  const { traceOnce } = await import("../trace/headless");
  const trace = traceOnce(cacheFixture(), { from: "source" });
  expect(trace?.done).toBe(true);
});

it("the Lab's lazy engine loader prepares cache scenarios in a fresh realm", async () => {
  vi.resetModules();
  const { loadCreateEngine } = await import("../lab/scenarioRunner");
  const createEngine = await loadCreateEngine();
  const engine = createEngine!();
  engine.load(cacheFixture());
  engine.inject("source", 1);
  engine.step(1000);
  expect(engine.snapshot().nodes.cache.cache?.misses).toBeGreaterThan(0);
});

it("the tutorials' local peer runner loads cache playback before constructing either controller", async () => {
  vi.resetModules();
  const { createLocalPeerPractice } = await import("../tutorials/localPeerPractice");
  const diagram = cacheFixture();
  diagram.nodes[2].id = "worker";
  diagram.edges[1].to = "worker";
  diagram.simulations = [simulation];
  const editor: Pick<EditorApi, "getDiagram" | "updateNode"> = {
    getDiagram: () => diagram,
    updateNode: (id, patch) =>
      Object.assign(
        diagram.nodes.find((n) => n.id === id)!,
        patch,
      ),
  };
  const practice = createLocalPeerPractice();
  try {
    await practice.run("watch", editor as EditorApi);
    expect(practice.getSnapshot()).toMatchObject({ value: "ready", phase: "watch" });
  } finally {
    practice.dispose();
  }
});
