import { expect, it, vi } from "vitest";
import payment from "../examples/slow-payment-provider.json";
import busy from "../examples/scale-on-busy-threads.json";
import type { DiagramFile, Simulation } from "../model/types";
import type { VerificationContext } from "../sim/replayControls";
import * as headless from "../sim/headless";
import { confirmedThreadFix, THREAD_FIX_LIMITS, timeoutReplay } from "./threadFixPlan";
import { planScaling } from "../sim/scalingPlanner";
import { LiveController } from "./controller";
import { TroubleTracker } from "./useObservedTrouble";
import { planDescriptor } from "../planning/scalingPlanText";
import { waitingFixture } from "../lab/waitingFixture";

/** A saved simulation's run with no live controls. */
const saved = (diagram: DiagramFile, simulation: Simulation): VerificationContext => ({
  revision: 0,
  origin: { diagram, simulation, initialTraffic: false },
  controls: [],
});

const exhausted = (node: string, edge: string) => ({
  key: `threads-exhausted:${node}`,
  kind: "threads-exhausted" as const,
  node,
  headline: "",
  announce: "",
  detail: "",
  action: { kind: "free-thread" as const, edge },
});

it("chooses the inspector's verified busy-thread policy before changing call semantics", async () => {
  const d = busy as DiagramFile;
  const simulation = d.simulations![0];
  const plan = planScaling(d).find((p) => p.simulation === simulation.id)!;
  const fix = confirmedThreadFix({ context: saved(d, simulation), trouble: exhausted("caller", "call"), time: 15000 });
  expect(fix).toEqual({
    kind: "scale-threads",
    changes: plan.suggestions[0].fix,
    plan: planDescriptor(plan, plan.suggestions[0], (id) => d.nodes.find((n) => n.id === id)?.label ?? id),
  });
  const c = new LiveController(d);
  const tracker = new TroubleTracker(c, async (request) => confirmedThreadFix(request));
  const stop = tracker.subscribe(() => {});
  try {
    c.selectSimulation(simulation);
    for (let i = 0; i < 150; i++) c.step(100);
    await Promise.resolve();
    expect(tracker.current()?.action).toEqual(fix);
  } finally {
    stop();
    c.dispose();
  }
});

it("confirms an affordable timeout and rejects a timeout that leaves the caller exhausted", () => {
  const d = payment as DiagramFile;
  const trouble = {
    ...exhausted("checkout", "pay"),
    action: { kind: "add-timeout" as const, edge: "pay", deadlineMs: 600 },
  };
  const request = { context: saved(d, d.simulations![0]), trouble, time: 15000 };
  expect(confirmedThreadFix(request)).toEqual(trouble.action);
  expect(
    confirmedThreadFix({ ...request, trouble: { ...trouble, action: { ...trouble.action, deadlineMs: 1000 } } }),
  ).toEqual({ kind: "free-thread", edge: "pay" });
});

it("simulation-only traffic falls back from an unverified timeout to the next confirmed fix", async () => {
  const d = waitingFixture();
  d.nodes[0].props = { ratePerSec: 0 };
  d.nodes[1].props!.concurrency = 100;
  const simulation: Simulation = {
    id: "slow",
    title: "Slow call",
    durationMs: 20000,
    traffic: [{ id: "traffic", node: "source", shape: { kind: "constant", ratePerSec: 120, durationMs: 20000 } }],
    timeline: [{ atMs: 0, action: { do: "fault", fault: { kind: "slow", node: "partner", factor: 10 } } }],
  };
  d.simulations = [simulation];
  expect(timeoutReplay(d, "call", 600, { work: Infinity })).toEqual({
    settled: true,
    delivered: 0,
    timedOut: 0,
    failed: 0,
  });
  const trouble = {
    ...exhausted("caller", "call"),
    action: { kind: "add-timeout" as const, edge: "call", deadlineMs: 600 },
  };
  const c = new LiveController(d);
  const tracker = new TroubleTracker(c, async (request) => confirmedThreadFix(request));
  const stop = tracker.subscribe(() => {});
  try {
    c.selectSimulation(simulation);
    for (let i = 0; i < 150; i++) c.step(100);
    await Promise.resolve();
    expect(c.getState().snapshot.nodes.source.processed).toBeGreaterThan(0);
    expect(confirmedThreadFix({ context: saved(d, simulation), trouble, time: 15000 })).toEqual({
      kind: "free-thread",
      edge: "call",
    });
    expect(tracker.current()?.action).toEqual({ kind: "free-thread", edge: "call" });
  } finally {
    stop();
    c.dispose();
  }
});

it("rejects an over-budget scenario rather than offering a speculative fix", () => {
  const d = structuredClone(payment) as DiagramFile;
  d.nodes = Array.from({ length: 10000 }, (_, i) => ({ ...d.nodes[2], id: `n${i}` }));
  expect(
    confirmedThreadFix({ context: saved(d, d.simulations![0]), trouble: exhausted("checkout", "pay"), time: 15000 }),
  ).toBeUndefined();
});

it("passes every narration pause before confirming the same timeout", () => {
  const d = structuredClone(payment) as DiagramFile;
  const simulation = d.simulations![0];
  simulation.timeline!.unshift(
    { atMs: 0, action: { do: "note", text: "Start", pause: true } },
    { atMs: 1000, action: { do: "note", text: "Continue", pause: true } },
  );
  const trouble = {
    ...exhausted("checkout", "pay"),
    action: { kind: "add-timeout" as const, edge: "pay", deadlineMs: 600 },
  };
  expect(confirmedThreadFix({ context: saved(d, simulation), trouble, time: 15000 })).toEqual(trouble.action);
});

it("shares one allocation budget across the baseline and candidates and refuses exhausted replays deterministically", () => {
  const d = payment as DiagramFile;
  const trouble = {
    ...exhausted("checkout", "pay"),
    action: { kind: "add-timeout" as const, edge: "pay", deadlineMs: 600 },
  };
  const request = { context: saved(d, d.simulations![0]), trouble, time: 15000 };
  const original = headless.createHeadlessRun;
  const entries: { budget: { remaining: number }; remaining: number }[] = [];
  const spy = vi.spyOn(headless, "createHeadlessRun").mockImplementation((...args) => {
    entries.push({ budget: args[2], remaining: args[2].remaining });
    return original(...args);
  });
  const limit = THREAD_FIX_LIMITS.messages;
  try {
    expect(confirmedThreadFix(request)).toEqual(trouble.action);
    // The baseline, the timeout's normal-reply replay (free play) and the candidate: one budget.
    expect(entries).toHaveLength(3);
    expect(new Set(entries.map((e) => e.budget)).size).toBe(1);
    expect(entries[1].remaining).toBeLessThan(limit);
    const baseline = limit - entries[1].remaining;
    THREAD_FIX_LIMITS.messages = baseline + 1;
    for (let repeat = 0; repeat < 2; repeat++) {
      entries.length = 0;
      expect(confirmedThreadFix(request)).toBeUndefined();
      // The baseline spends it; the timeout's replay is refused, and so is the remaining candidate's.
      expect(entries).toHaveLength(3);
      expect(new Set(entries.map((e) => e.budget)).size).toBe(1);
      expect(entries[2].budget.remaining).toBeLessThan(0);
    }
  } finally {
    THREAD_FIX_LIMITS.messages = limit;
    spy.mockRestore();
  }
});

it("rejects explosive downstream fan-out before starting a replay", () => {
  const d = structuredClone(payment) as DiagramFile;
  const previous = d.nodes[2];
  for (let i = 0; i < 20; i++) {
    d.nodes.push({ ...previous, id: `copy-${i}` });
    for (let j = 0; j < 2; j++)
      d.edges.push({ id: `fan-${i}-${j}`, from: i ? `copy-${i - 1}` : "shop", to: `copy-${i}`, kind: "async" });
  }
  const spy = vi.spyOn(headless, "createHeadlessRun");
  try {
    expect(
      confirmedThreadFix({ context: saved(d, d.simulations![0]), trouble: exhausted("checkout", "pay"), time: 15000 }),
    ).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});

it("verifies a manually applied slowdown using the resolved run and logged controls", () => {
  const d = structuredClone(payment) as DiagramFile;
  const simulation = d.simulations![0];
  simulation.timeline = [];
  const c = new LiveController(d);
  try {
    c.selectSimulation(simulation);
    c.step(3000);
    c.setFault({ kind: "slow", node: "payment", factor: 10 });
    for (let i = 0; i < 120; i++) c.step(100);
    const trouble = {
      ...exhausted("checkout", "pay"),
      action: { kind: "add-timeout" as const, edge: "pay", deadlineMs: 600 },
    };
    expect(confirmedThreadFix({ context: saved(d, simulation), trouble, time: 15000 })).toBeUndefined();
    expect(confirmedThreadFix({ context: c.verificationContext(), trouble, time: 15000 })).toEqual(trouble.action);
  } finally {
    c.dispose();
  }
});
