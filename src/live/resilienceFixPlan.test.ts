import { expect, it } from "vitest";
import storm from "../examples/retry-storm.json";
import type { DiagramFile } from "../model/types";
import { resilienceLadder, recovers, confirmedResilienceFix, type RecoveryEvidence } from "./resilienceFixPlan";
import { RECOMMENDED_RETRY } from "../sim/resiliencePresets";
import { THREAD_FIX_LIMITS } from "./threadFixPlan";
import { TroubleWatcher } from "./observedTrouble";
import { createSimulationRun } from "../sim/simulation";
import { realSnapshot } from "../sim/units";

it("each cumulative ladder edit equals its preset, retaining retry classes and idempotency", () => {
  const retry = {
    maxAttempts: 5,
    backoffMs: 0,
    strategy: "fixed" as const,
    retryOn: ["timeout" as const],
    idempotent: false,
  };
  const ladder = resilienceLadder({ retry, deadlineMs: 300 });
  expect(ladder.map((p) => p.step)).toEqual(["jitter", "budget", "breaker", "attempts"]);
  const jitter = {
    ...retry,
    backoffMs: RECOMMENDED_RETRY.backoffMs,
    strategy: RECOMMENDED_RETRY.strategy,
    maxBackoffMs: RECOMMENDED_RETRY.maxBackoffMs,
    jitter: RECOMMENDED_RETRY.jitter,
  };
  expect(ladder[0].caller).toEqual({ retry: jitter, deadlineMs: 300 });
  const budget = { ...jitter, budget: RECOMMENDED_RETRY.budget };
  expect(ladder[1].caller).toEqual({ retry: budget, deadlineMs: 300 });
  expect(ladder[2].caller).toEqual({ retry: budget, deadlineMs: 300, breaker: {} });
  expect(ladder[3].caller).toEqual({ retry: { ...budget, maxAttempts: 2 }, deadlineMs: 300, breaker: {} });
});

it("recovery requires all three bands in the same sample, within ten seconds, and 20% more successful work", () => {
  const before: RecoveryEvidence = {
    clear: 8000,
    preGoodput: 300,
    preBacklog: 3,
    threads: 48,
    integral: 100,
    points: [],
  };
  const after: RecoveryEvidence = {
    ...before,
    integral: 120,
    points: [{ time: 18000, goodput: 270, backlog: 51, amplification: 1.5 }],
  };
  expect(recovers(before, after)).toBe(true);
  for (const patch of [{ time: 18001 }, { goodput: 269 }, { backlog: 52 }, { amplification: 1.51 }])
    expect(recovers(before, { ...after, points: [{ ...after.points[0], ...patch }] })).toBe(false);
  expect(recovers(before, { ...after, integral: 119 })).toBe(false);
  expect(recovers({ ...before, preGoodput: 0 }, after)).toBe(false);
});

function context() {
  const diagram = structuredClone(storm) as DiagramFile;
  // Same generic story at one tenth of the traffic, within the shared replay budget.
  diagram.nodes[0].props!.ratePerSec = 30;
  diagram.nodes[2].props = { ...diagram.nodes[2].props, replicas: 1, concurrency: 4 };
  const simulation = structuredClone(diagram.simulations![0]);
  simulation.traffic[0].shape = { kind: "constant", ratePerSec: 30, durationMs: 60000 };
  return { revision: 0, origin: { diagram, simulation, initialTraffic: false }, controls: [] };
}

it("detects the retry storm ahead of downstream symptoms and refuses exhausted replay budgets", () => {
  const c = context(),
    watcher = new TroubleWatcher();
  const run = createSimulationRun(c.origin.diagram, c.origin.simulation);
  let troubles: ReturnType<TroubleWatcher["observe"]> = [];
  for (let i = 0; i < 15; i++) {
    run.step(1000);
    troubles = watcher.observe(realSnapshot(run.engine.snapshot()), c.origin.diagram);
  }
  expect(troubles[0]?.kind).toBe("retry-storm");
  const saved = THREAD_FIX_LIMITS.messages;
  try {
    THREAD_FIX_LIMITS.messages = 0;
    expect(confirmedResilienceFix({ context: c, edge: "pay", time: 15000 })).toBeUndefined();
  } finally {
    THREAD_FIX_LIMITS.messages = saved;
  }
});

it("confirms the first recovering cumulative edit by same-seed replay", () => {
  const result = confirmedResilienceFix({ context: context(), edge: "pay", time: 15000 });
  expect(result).toMatchObject({ kind: "resilience", edge: "pay", step: "breaker", caller: { breaker: {} } });
});

it.each(["async", "broker"])("confirms recovery at the affected request boundary with %s input", (kind) => {
  const c = context();
  c.origin.diagram.edges[0].kind = "async";
  if (kind === "broker") {
    const d = c.origin.diagram;
    d.nodes.push({ ...d.nodes[1], id: "queue", stencil: "generic.queue", props: { maxDeliveryCount: 1 } });
    d.edges[0].to = "queue";
    d.edges.push({ id: "delivery", from: "queue", to: "checkout" });
  }
  expect(confirmedResilienceFix({ context: c, edge: "pay", time: 15000 })).toMatchObject({ step: "breaker" });
});

it("ignores a persistent fault on a disconnected service when confirming recovery", () => {
  const c = context();
  c.origin.diagram.nodes.push({ ...c.origin.diagram.nodes[2], id: "unused" });
  c.origin.simulation.timeline!.push({
    atMs: 0,
    action: { do: "fault", fault: { kind: "fail", node: "unused", rate: 0.5 } },
  });
  c.origin.simulation.timeline!.sort((a, b) => a.atMs - b.atMs);
  expect(confirmedResilienceFix({ context: c, edge: "pay", time: 15000 })).toMatchObject({ step: "breaker" });
});

it("rejects an oversized replay before reading topology", () => {
  const c = context(),
    d = c.origin.diagram;
  d.nodes = new Array(5000).fill(d.nodes[0]);
  Object.defineProperty(d, "edges", {
    get() {
      return new Proxy([], {
        get(_target, key) {
          if (key === "length") return 4999;
          throw new Error("oversized replay traversed topology");
        },
      });
    },
  });
  expect(confirmedResilienceFix({ context: c, edge: "pay", time: 15000 })).toBeUndefined();
});

/** A service that is down for the whole run, with nothing playback sends it. */
function downService(c: ReturnType<typeof context>, id: string) {
  c.origin.diagram.nodes.push({ ...c.origin.diagram.nodes[2], id });
  c.origin.simulation.timeline!.push({ atMs: 0, action: { do: "status", node: id, status: "down" } });
  c.origin.simulation.timeline!.sort((a, b) => a.atMs - b.atMs);
}

it.each([
  ["a synchronous call from the callee", { from: "payments", to: "unused", kind: "sync" as const }],
  ["a synchronous call from the caller", { from: "checkout", to: "unused", kind: "sync" as const }],
  ["an asynchronous feed into the caller", { from: "unused", to: "checkout", kind: "async" as const }],
])("a down service behind %s with share 0 cannot suppress a confirmed fix", (_, edge) => {
  const c = context();
  downService(c, "unused");
  c.origin.diagram.edges.push({ id: "idle", ...edge, props: { share: 0 } });
  expect(confirmedResilienceFix({ context: c, edge: "pay", time: 15000 })).toMatchObject({ step: "breaker" });
});

it("a connection ending on a documentation shape cannot suppress a confirmed fix", () => {
  const c = context(),
    d = c.origin.diagram;
  d.annotations = [{ id: "note", kind: "shape", text: "Ledger (planned)", x: 900, y: 0, width: 120, height: 60 }];
  d.edges.push({ id: "documented", from: "payments", to: "note", kind: "sync" });
  expect(confirmedResilienceFix({ context: c, edge: "pay", time: 15000 })).toMatchObject({ step: "breaker" });
});
