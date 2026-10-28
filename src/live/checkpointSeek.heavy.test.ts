import fc from "fast-check";
import { expect, it, vi } from "vitest";
import type { DiagramFile, Simulation, SimRole } from "../model/types";
import { propertyRuns } from "../test/fastCheck";
import { LiveController } from "./controller";
import type { SimulationRun } from "../sim/types";

// Exercise real capture/restore with pressure on even a small graph, rather than allocating
// tens of MiB in every property run. Production uses exactly the same eviction policy.
const cap = 64 * 1024;
vi.mock("./checkpointRing", async (importOriginal) => {
  const original = await importOriginal<typeof import("./checkpointRing")>();
  return {
    ...original,
    trimCheckpoints: (entries: Parameters<typeof original.trimCheckpoints>[0]) =>
      original.trimCheckpoints(entries, 64 * 1024),
  };
});

function controller(seed: number, rate: number) {
  const diagram: DiagramFile = {
    format: "diagrams/v1",
    title: "Checkpoint seek property",
    nodes: [
      { id: "source", stencil: "source", label: "Source", x: 0, y: 0 },
      { id: "queue", stencil: "queue", label: "Queue", x: 0, y: 0 },
      {
        id: "worker",
        stencil: "processor",
        label: "Worker",
        x: 0,
        y: 0,
        props: { latencyMs: 80, jitter: 0.3, failureRate: 0.15 },
      },
      { id: "sink", stencil: "sink", label: "Sink", x: 0, y: 0 },
    ],
    edges: [
      { id: "a", from: "source", to: "queue" },
      { id: "b", from: "queue", to: "worker" },
      { id: "c", from: "worker", to: "sink", kind: "sync" },
    ],
  };
  const simulation: Simulation = {
    id: "seek",
    title: "Seek",
    seed,
    scale: 1,
    durationMs: 125_000,
    traffic: [{ id: "load", node: "source", shape: { kind: "constant", ratePerSec: rate, durationMs: 125_000 } }],
    timeline: [
      { atMs: 22_000, action: { do: "props", node: "worker", props: { concurrency: 3, latencyMs: 120 } } },
      { atMs: 53_000, action: { do: "status", node: "worker", status: "down" } },
      { atMs: 56_000, action: { do: "status", node: "worker", status: "up" } },
      { atMs: 71_000, action: { do: "inject", node: "source", count: 7 } },
    ],
  };
  const c = new LiveController(diagram, { roleOf: (s) => s as SimRole, maxParticles: 5 });
  expect(c.selectSimulation(simulation)).toBe("selected");
  return c;
}

const state = (c: LiveController) => JSON.stringify({ digest: c.digestInputs(), run: c.getState().run });

it("does not repeatedly clone an oversized checkpoint between capture intervals", () => {
  const c = controller(7, 1);
  const { runner } = c as unknown as { runner: SimulationRun };
  const capture = vi
    .spyOn(runner, "checkpoint")
    .mockImplementation(() => ({ time: runner.state().time, bytes: cap + 1 }));
  try {
    c.step(5000);
    expect(capture).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 8; i++) c.step(250);
    expect(capture).toHaveBeenCalledTimes(1);
    c.step(3000);
    expect(capture).toHaveBeenCalledTimes(2);
  } finally {
    capture.mockRestore();
    c.dispose();
  }
});

it.each(Array.from({ length: 30 }, (_, i) => i))(
  "random seeks under byte pressure match straight playback byte for byte, including RNG and scripted edits (batch %i)",
  (batch) => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.integer({ min: 1, max: 8 }),
        fc.array(fc.integer({ min: 1, max: 12_000 }), { minLength: 6, maxLength: 8 }),
        (seed, rate, ticks) => {
          const c = controller(seed, rate);
          try {
            c.seek(120_000);
            const ring = (c as unknown as { checkpoints: { cp: { time: number }; bytes: number }[] }).checkpoints;
            expect(ring.length).toBeLessThan(25);
            expect(ring.reduce((sum, entry) => sum + entry.bytes, 0)).toBeLessThanOrEqual(cap);
            for (const tick of ticks) {
              const target = tick * 10;
              c.seek(target);
              const straight = controller(seed, rate);
              try {
                for (let at = 0; at < target; at += 1000) straight.step(Math.min(1000, target - at));
                expect(state(c)).toBe(state(straight));
              } finally {
                straight.dispose();
              }
            }
          } finally {
            c.dispose();
          }
        },
      ),
      {
        numRuns: propertyRuns(1),
        ...(fc.readConfigureGlobal().seed === undefined ? {} : { seed: (fc.readConfigureGlobal().seed! + batch) | 0 }),
      },
    );
  },
);
