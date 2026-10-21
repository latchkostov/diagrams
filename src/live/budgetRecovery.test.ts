import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiagramFile, Simulation } from "../model/types";
import { resourceLesson } from "../model/autoscaling";
import { WorkBudgetError } from "../sim/engine";
import * as simulations from "../sim/simulation";
import { emptyInputs } from "./capacityModel";
import { LiveController } from "./controller";
import { SlowMotion } from "./slowmo/session";
import { buildScript, frameAt, stepStop } from "./slowmo/script";

const diagram: DiagramFile = {
  format: "diagrams/v2",
  title: "Budget recovery",
  nodes: [{ id: "source", stencil: "client.browser", label: "Source", x: 0, y: 0 }],
  edges: [],
};
const simulation = (rate = 100_000, scale = 1): Simulation => ({
  id: "budget",
  title: "Budget",
  scale,
  durationMs: 2000,
  traffic: [{ id: "rate", node: "source", shape: { kind: "constant", ratePerSec: rate, durationMs: 1000 } }],
});

afterEach(() => vi.restoreAllMocks());

describe("budget recovery requires a rebuild", () => {
  it("distinguishes a selected but refused draft from a rejected selection", () => {
    const c = new LiveController(diagram);
    try {
      const draft = simulation(300_000);
      expect(c.selectSimulation(draft)).toBe("selected-refused");
      expect(c.getState()).toMatchObject({ simulation: draft, needsRestart: true });
      expect(c.selectSimulation({ ...draft, id: "invalid", scale: 0 })).toBe("rejected");
      expect(c.getState().simulation).toEqual(draft);
      expect(c.selectSimulation(null)).toBe("selected");
      expect(c.getState()).toMatchObject({ simulation: null, needsRestart: false });
    } finally {
      c.dispose();
    }
  });

  it.each(["inputs", "restart"] as const)("an active replay lifecycle refusal recovers through %s", (recovery) => {
    vi.useFakeTimers();
    const d: DiagramFile = {
      ...diagram,
      planning: { revision: "p3-a1" },
      nodes: Array.from({ length: 11 }, (_, i) => ({
        id: `worker-${i}`,
        stencil: "service.dotnet",
        label: "Worker",
        x: i * 300,
        y: 0,
        props: { replicas: 1, resources: resourceLesson() },
      })),
    };
    const c = new LiveController(d, { replayDelayMs: 0, maxParticles: 0 });
    try {
      c.selectSimulation({ id: "replicas", title: "Replicas", durationMs: 10_000, traffic: [] });
      c.step(1000);
      for (const n of d.nodes) c.setNodeProps(n.id, { replicas: 1000 });
      c.step(1000);
      for (const n of d.nodes) c.setNodeProps(n.id, { replicas: 1 });
      c.step(1000);
      // The current fleet fits, but replaying the earlier live increases at 10x does not.
      let clock = 0;
      vi.spyOn(performance, "now").mockImplementation(() => (clock += 10));
      c.setInputs({ ...emptyInputs(), scale: 2, capacity: 10 });
      c.resume();
      c.setNodeStatus(d.nodes[0].id, "down");
      vi.runAllTimers();
      expect(c.getState()).toMatchObject({ needsRestart: true, playing: false });
      expect(c.getState().resourceError).toContain("100");
      expect(vi.getTimerCount()).toBe(0);
      const stopped = c.snapshot().time;
      c.setPlaying(true);
      c.step(100);
      c.advance(100);
      expect(c.snapshot().time).toBe(stopped);

      if (recovery === "restart") expect(c.restart()).toBe(true);
      else c.setInputs({ ...emptyInputs(), scale: 2, capacity: 1 });
      vi.runAllTimers();
      expect(c.getState()).toMatchObject({ needsRestart: false, resourceError: undefined });
      expect(c.getState().simulation?.id).toBe("replicas");
      expect(c.effectiveProps(d.nodes[0].id).status).not.toBe("down");
      expect(c.controlLog().some((e) => e.op.kind === "resume" || e.op.kind === "status")).toBe(false);
      const rebuilt = c.snapshot().time;
      c.step(100);
      expect(c.snapshot().time).toBe(rebuilt + 100);
      c.setPlaying(true);
      c.advance(100);
      expect(c.snapshot().time).toBe(rebuilt + 200);
    } finally {
      c.dispose();
      vi.useRealTimers();
    }
  });

  it("a refused rebuild cannot resume the old runner", () => {
    const c = new LiveController(diagram, { replayDelayMs: 0, maxParticles: 0 });
    c.selectSimulation(simulation(200_000, 10));
    c.step(500);
    c.setInputs({ ...emptyInputs(), scale: 1, traffic: 10 });
    const stopped = c.snapshot();
    const log = [...c.controlLog()];
    expect(c.getState().resourceError).toBeDefined();
    c.setPlaying(true);
    c.advance(100);
    c.step(100);
    c.resume();
    c.seek(1000);
    c.inject("source", 1);
    c.setNodeProps("source", { ratePerSec: 1 });
    c.setNodeStatus("source", "down");
    c.setTraffic(true);
    expect(c.getState()).toMatchObject({ needsRestart: true, playing: false });
    expect(c.snapshot()).toEqual(stopped);
    expect(c.controlLog()).toEqual(log);
    expect(c.getState().running).toMatchObject({ scale: 1, multipliers: { traffic: 10 } });
    c.dispose();
  });

  it.each(["script", "sampling"])("a multiplier change rebuilds after a refused %s change", async (kind) => {
    const build = vi.spyOn(simulations, "createSimulationRun");
    const c = new LiveController(diagram, { replayDelayMs: 0, maxParticles: 0 });
    c.selectSimulation(simulation(100_000, kind === "sampling" ? 10 : 1));
    const old = build.mock.results.at(-1)!.value as ReturnType<typeof simulations.createSimulationRun>;
    const patch = vi.spyOn(old, "setMultipliers");
    c.step(500);
    if (kind === "script") c.setBase(simulation(300_000));
    else c.setInputs({ ...emptyInputs(), scale: 1, traffic: 10 });
    expect(c.getState().resourceError).toBeDefined();
    c.setInputs({ ...emptyInputs(), scale: 1, traffic: 0.5 });
    expect(patch).not.toHaveBeenCalled();
    expect(c.getState().resourceError).toBeUndefined();
    expect(c.getState()).toMatchObject({ needsRestart: false, scale: 1 });
    await vi.waitFor(() => expect(c.snapshot().time).toBe(500));
    await vi.waitFor(() => {
      c.step(500);
      expect(c.snapshot().time).toBe(1000);
    });
    expect(c.getState().snapshot.nodes.source.processed).toBe(kind === "script" ? 150_000 : 50_000);
    c.dispose();
  });

  it("a refused injection blocks Play, Step and Continue until Restart recovers", () => {
    const c = new LiveController(diagram, { maxParticles: 0 });
    c.selectSimulation({
      ...simulation(),
      traffic: [],
      timeline: [
        { atMs: 500, action: { do: "note", text: "Wait", pause: true } },
        { atMs: 500, action: { do: "inject", node: "source", count: 30_000 } },
      ],
    });
    c.step(500);
    c.setInputs({ ...emptyInputs(), traffic: 10 });
    c.resume();
    const stopped = c.snapshot();
    c.setPlaying(true);
    c.advance(1000);
    c.step(1000);
    c.resume();
    expect(c.getState()).toMatchObject({ needsRestart: true, playing: false });
    expect(c.snapshot()).toEqual(stopped);
    c.setInputs(emptyInputs());
    c.restart();
    expect(c.getState()).toMatchObject({ needsRestart: false, resourceError: undefined });
    c.step(500);
    c.resume();
    c.step(1000);
    expect(c.getState().snapshot.nodes.source.processed).toBe(30_000);
    c.dispose();
  });

  it("cancels subsequent callbacks when a later async replay slice refuses work", () => {
    vi.useFakeTimers();
    const create = simulations.createSimulationRun;
    const build = vi.spyOn(simulations, "createSimulationRun");
    const c = new LiveController(diagram, { replayDelayMs: 0, maxParticles: 0 });
    try {
      c.selectSimulation(simulation(1));
      c.step(5000);
      build.mockImplementationOnce((...args) => {
        const run = create(...args);
        const step = run.step.bind(run);
        vi.spyOn(run, "step").mockImplementation((ms) => {
          if (run.state().time >= 100) throw new WorkBudgetError();
          step(ms);
        });
        return run;
      });
      let clock = 0;
      vi.spyOn(performance, "now").mockImplementation(() => (clock += 10));
      c.setInputs({ ...emptyInputs(), scale: 2 });
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      expect(c.getState().resourceError).toBeUndefined();
      vi.runAllTimers();
      expect(c.getState()).toMatchObject({ needsRestart: true, playing: false });
      expect(c.getState().resourceError).toBeDefined();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      c.dispose();
      vi.useRealTimers();
    }
  });

  it("slow motion exposes look-ahead refusal and keeps Live paused without arming", () => {
    const c = new LiveController(diagram, { maxParticles: 0 });
    c.selectSimulation({
      ...simulation(),
      durationMs: 20_000,
      traffic: [],
      timeline: [{ atMs: 10_000, action: { do: "inject", node: "source", count: 30_000 } }],
    });
    c.step(500);
    c.setInputs({ ...emptyInputs(), traffic: 10 });
    c.setPlaying(true);
    const slow = new SlowMotion(c, {
      code: { buildScript, frameAt, stepStop },
      build: () => {
        throw new Error("No trace expected");
      },
      schedule: (work) => {
        work();
        return () => {};
      },
    });
    slow.start({ kind: "next", node: "missing" });
    expect(slow.getState().status).toBe("off");
    expect(c.getState()).toMatchObject({ needsRestart: true, playing: false });
    expect(c.getState().resourceError).toBeDefined();
    c.advance(1000);
    expect(c.snapshot().time).toBe(500);
    slow.dispose();
    c.dispose();
  });
});
