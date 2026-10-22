import { expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import payment from "../examples/slow-payment-provider.json";
import busy from "../examples/scale-on-busy-threads.json";
import { createSimulationRun } from "../sim/simulation";
import { simulationEdges } from "../sim/simulationEdges";
import { realSnapshot } from "../sim/units";
import { affordableTimeout } from "./affordableTimeout";
import { TroubleWatcher } from "./observedTrouble";
import { LiveController } from "./controller";
import { TroubleTracker } from "./troubleTracker";
import { runEndResult } from "./runEndResult";
import { timeoutOutcome } from "./timeoutOutcome";
import { runChecks } from "../checks/run";
import { state as language, type Catalog } from "../i18n";
import { catalogs } from "virtual:i18n/catalogs";

it("uses Little's law with headroom and a readable value above the normal reply", () => {
  expect(affordableTimeout(200, 100, 120)).toBe(600);
  expect(affordableTimeout(200, 100, 140)).toBe(600);
  expect(affordableTimeout(250, 4, 100)).toBeUndefined();
  expect(affordableTimeout(Infinity, 100, 120)).toBeUndefined();
  expect(affordableTimeout(200, 100, 0)).toBe(1000);
});

it("translates a paused diagnosis on a language change without advancing playback", async () => {
  const c = new LiveController(payment as DiagramFile);
  const previous = { locale: language.l, catalog: language.c };
  c.setNodeStatus("checkout", "down");
  const tracker = new TroubleTracker(c);
  const unsubscribe = tracker.subscribe(() => {});
  try {
    const english = tracker.current()!.headline;
    const before = c.snapshot();
    expect(english).toBe("Checkout is down");
    language.l = "en-XA";
    language.c = (await catalogs["en-XA"]()).default as Catalog;
    language.f.forEach((notify) => notify());
    expect(tracker.current()!.headline).not.toBe(english);
    expect(tracker.current()!.headline).toContain("Checkout");
    expect(c.snapshot()).toEqual(before);
  } finally {
    unsubscribe();
    c.dispose();
    language.l = previous.locale;
    language.c = previous.catalog;
  }
});

it("keeps the exhausted caller ahead of downstream 504 losses and offers an affordable timeout", () => {
  const d = payment as DiagramFile;
  const sim = d.simulations![0];
  const run = createSimulationRun(d, sim);
  const watcher = new TroubleWatcher();
  const effective = simulationEdges(d, sim);
  let trouble;
  for (let i = 0; i < 150; i++) {
    run.step(100);
    trouble = watcher.observe(realSnapshot(run.engine.snapshot()), effective)[0];
  }
  expect(trouble).toMatchObject({
    node: "checkout",
    kind: "threads-exhausted",
    action: { kind: "add-timeout", edge: "pay", deadlineMs: 600 },
  });
  expect(trouble!.detail).toContain("API gateway gave up after 5 s (504)");
  const fixed = structuredClone(sim);
  fixed.setup = { edges: { pay: { caller: { deadlineMs: 600 } } } };
  const rerun = createSimulationRun(d, fixed);
  rerun.step(15000);
  expect(rerun.engine.snapshot().nodes.checkout.threads!.waiting).toBeLessThan(80);
  expect(rerun.engine.snapshot().nodes.checkout.backlog).toBeLessThan(5);
});

it("names gateway 504 pass-through at both gateway and source and keeps the deliberate timeout run quiet", () => {
  const d = payment as DiagramFile;
  const c = new LiveController(d);
  try {
    c.selectSimulation(d.simulations![0]);
    c.seek(15000);
    expect(timeoutOutcome(d, c.getState().snapshot, "gateway")).toContain("gave up after 5 s (504 passed to caller)");
    expect(timeoutOutcome(d, c.getState().snapshot, "shop")).toContain("API gateway");
    const typedGateway = { ...d, nodes: d.nodes.map((n) => (n.id === "gateway" ? { ...n, stencil: "nginx" } : n)) };
    expect(timeoutOutcome(typedGateway, c.getState().snapshot, "gateway")).toContain("504 passed to caller");
    expect(timeoutOutcome(typedGateway, c.getState().snapshot, "shop")).toContain("API gateway");
    c.selectSimulation(d.simulations![1]);
    const tracker = new TroubleTracker(c);
    const unsubscribe = tracker.subscribe(() => {});
    try {
      for (let i = 0; i < 200; i++) c.advance(100);
      expect(tracker.current()).toBeUndefined();
    } finally {
      unsubscribe();
    }
  } finally {
    c.dispose();
  }
});

it.each([payment])("teaches the two routes in each run-end line: $title", (input) => {
  const d = input as DiagramFile;
  const c = new LiveController(d);
  try {
    for (const sim of d.simulations!) {
      c.selectSimulation(sim);
      c.seek(sim.durationMs!);
      const result = runEndResult(c.getState(), d);
      expect(result).toContain("Orders DB completed");
      if (sim.id === "no-timeouts") expect(result).toContain("API gateway gave up after 5 s (504)");
      if (sim.id === "timeout-600") expect(result).toContain("Payments failed in 0.6 s instead of 5 s");
      if (sim.id === "blocking-pool") expect(result).toContain("threads held while waiting for the pool");
      if (sim.id === "pool-40") expect(result).toContain("threads freed while waiting for the pool");
    }
  } finally {
    c.dispose();
  }
});

it("credits busy-thread scaling only while the measured maximum can keep up", () => {
  const d = structuredClone(busy) as DiagramFile;
  d.simulations = [];
  const node = d.nodes.find((n) => n.id === "caller")!;
  expect(runChecks(d).findings.map((f) => f.id)).toContain("blocked-threads:caller");
  const setup = (busy as DiagramFile).simulations![1].setup!.props!.caller;
  node.props = { ...node.props, ...setup };
  expect(runChecks(d).findings.map((f) => f.id)).not.toContain("capacity:caller");
  expect(runChecks(d).findings.map((f) => f.id)).not.toContain("blocked-threads:caller");
  const a = node.props.autoscaling as { controller: { maxReplicas: number } };
  a.controller.maxReplicas = 4;
  expect(runChecks(d).findings.map((f) => f.id)).toContain("capacity:caller");
});
