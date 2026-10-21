import { describe, expect, it } from "vitest";
import type { Simulation } from "../model/types";
import { advanceHeadless, createHeadlessRun } from "../sim/headless";
import { waitingFixture } from "../lab/waitingFixture";
import { LiveController } from "./controller";

// PR #225 delta review (20261021-123751): a fix verification replays the run the person actually watched. Each case
// drives the live controller, then replays its verification context headless with the same seed and compares the
// complete node and edge state at the live time.

function replay(c: LiveController) {
  const context = c.verificationContext();
  const run = createHeadlessRun(context.origin.diagram, context.origin.simulation, { remaining: 1_000_000 }, context);
  advanceHeadless(run, c.snapshot().time);
  return run;
}

function expectParity(c: LiveController) {
  const live = c.snapshot();
  const headless = replay(c).engine.snapshot();
  expect(headless.time).toBe(live.time);
  expect(headless.nodes).toEqual(live.nodes);
  expect(headless.edges).toEqual(live.edges);
}

const loaded = (extra: Partial<Simulation> = {}): Simulation => ({
  id: "load",
  title: "Load",
  seed: 7,
  scale: 1,
  durationMs: 8000,
  traffic: [{ id: "load", node: "source", shape: { kind: "constant", ratePerSec: 25, durationMs: 8000 } }],
  ...extra,
});

describe("Continue keeps its place among live controls", () => {
  it.each(["before", "after"] as const)(
    "a concurrency change made %s Continue at a same-time timeline change",
    (when) => {
      const c = new LiveController(waitingFixture());
      try {
        c.selectSimulation(
          loaded({
            timeline: [0, 1000].flatMap((atMs) => [
              { atMs, action: { do: "note" as const, text: "Pause", pause: true } },
              { atMs, action: { do: "props" as const, node: "caller", props: { concurrency: 1 } } },
            ]),
          }),
        );
        for (let pause = 0; pause < 2; pause++) {
          expect(c.getState().run?.waiting).toBe(true);
          if (when === "before") c.setNodeProps("caller", { concurrency: 4 });
          c.resume();
          if (when === "after") c.setNodeProps("caller", { concurrency: 4 });
          expect(c.effectiveProps("caller").concurrency).toBe(when === "after" ? 4 : 1);
          c.step(1000);
        }
        c.step(1000);
        expectParity(c);
      } finally {
        c.dispose();
      }
    },
  );

  it("a manual slowdown after Continue outlives a same-time scripted slowdown", () => {
    const c = new LiveController(waitingFixture());
    try {
      c.selectSimulation(
        loaded({
          timeline: [
            { atMs: 0, action: { do: "note", text: "Continue", pause: true } },
            { atMs: 0, action: { do: "fault", fault: { kind: "slow", node: "partner", factor: 10 } } },
          ],
        }),
      );
      c.resume();
      c.setFault({ kind: "slow", node: "partner", factor: 2 });
      c.step(3000);
      expectParity(c);
    } finally {
      c.dispose();
    }
  });

  it("two pausing notes at one moment keep a control made between their Continues", () => {
    const c = new LiveController(waitingFixture());
    try {
      c.selectSimulation(
        loaded({
          timeline: [
            { atMs: 500, action: { do: "note", text: "First", pause: true } },
            { atMs: 500, action: { do: "props", node: "caller", props: { concurrency: 1 } } },
            { atMs: 500, action: { do: "note", text: "Second", pause: true } },
            { atMs: 500, action: { do: "props", node: "caller", props: { concurrency: 2 } } },
          ],
        }),
      );
      c.step(1000);
      expect(c.getState().run?.waiting).toBe(true);
      c.resume();
      expect(c.getState().run?.waiting).toBe(true);
      c.setNodeProps("caller", { concurrency: 6 });
      c.setNodeProps("partner", { latencyMs: 400 });
      c.resume();
      c.setNodeProps("partner", { latencyMs: 100 });
      c.step(2000);
      expectParity(c);
    } finally {
      c.dispose();
    }
  });
});

describe("the run origin stays separate from inputs changed during the run", () => {
  it.each(["capacity", "traffic", "props", "diagram"] as const)("an immediate %s change keeps its time", (kind) => {
    const d = waitingFixture();
    const c = new LiveController(d);
    try {
      c.selectSimulation(loaded());
      c.step(2000);
      const sent = c.snapshot().nodes.source.processed;
      if (kind === "diagram") {
        const next = structuredClone(d);
        next.nodes[1].props!.concurrency = 8;
        expect(c.updateDiagram(next)).toBe("patched");
      } else
        c.setInputs({
          rates: {},
          props: kind === "props" ? { caller: { concurrency: 8 } } : {},
          ...(kind === "traffic" ? { traffic: 0 } : kind === "capacity" ? { capacity: 2 } : {}),
        });
      expect(c.busy).toBe(false);
      c.step(1000);
      if (kind === "traffic") expect(c.snapshot().nodes.source.processed).toBe(sent);
      expectParity(c);
    } finally {
      c.dispose();
    }
  });

  it("free play keeps a Capacity × change at its time", () => {
    const d = waitingFixture();
    d.nodes[0].props = { ratePerSec: 25 };
    const c = new LiveController(d);
    try {
      c.setTraffic(true);
      c.step(2000);
      c.setInputs({ rates: {}, props: {}, capacity: 2 });
      expect(c.busy).toBe(false);
      c.step(1000);
      expectParity(c);
    } finally {
      c.dispose();
    }
  });

  it("a node tweak later superseded by Inputs still ran until the Inputs change", () => {
    const c = new LiveController(waitingFixture());
    try {
      c.selectSimulation(loaded());
      c.step(1000);
      c.setNodeProps("caller", { concurrency: 1 });
      c.step(1000);
      c.setInputs({ rates: {}, props: { caller: { concurrency: 8 } } });
      c.step(1000);
      expectParity(c);
    } finally {
      c.dispose();
    }
  });

  it("seeking back to a checkpoint keeps the traffic switch the live run restored there", () => {
    const d = waitingFixture();
    d.nodes[0].props = { ratePerSec: 25 };
    const c = new LiveController(d);
    try {
      c.selectSimulation(loaded({ traffic: [], durationMs: 20000 }));
      c.setTraffic(true);
      for (let i = 0; i < 6; i++) c.step(1000);
      c.setTraffic(false);
      c.step(2000);
      c.seek(5500);
      c.step(1500);
      expectParity(c);
    } finally {
      c.dispose();
    }
  });

  it("a rebuild that rewrites history replaces the origin", async () => {
    const c = new LiveController(waitingFixture(), { replayDelayMs: 0 });
    try {
      c.selectSimulation(loaded());
      c.step(2000);
      c.setNodeProps("caller", { concurrency: 2 });
      c.step(1000);
      const before = c.verificationContext();
      c.setInputs({ rates: { source: 40 }, props: {} });
      for (let guard = 0; guard < 500 && c.busy; guard++) await new Promise((resolve) => setTimeout(resolve, 2));
      expect(c.busy).toBe(false);
      const after = c.verificationContext();
      expect(after.revision).toBeGreaterThan(before.revision);
      expect(after.origin.simulation.traffic[0].shape).toMatchObject({ ratePerSec: 40 });
      c.step(1000);
      expectParity(c);
    } finally {
      c.dispose();
    }
  });
});
