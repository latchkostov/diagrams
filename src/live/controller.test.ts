import { describe, expect, it, vi } from "vitest";
import { DIAGRAM_FORMAT, type DiagramFile, type Simulation } from "../model/types";
import type { SimRole } from "../model/types";
import { LiveController, structuralKey } from "./controller";
import kafka from "../examples/kafka-order-pipeline.json";
import { emptyInputs, freePlaySaveProps } from "./capacityModel";
import { autoscalingFixture, sampledCpuBudgetFixture } from "../lab/autoscalingFixture";
import { resourceLesson } from "../model/autoscalingLessons";
import * as admissions from "../sim/admission";
import * as allocations from "../sim/allocation";
import { LifecycleBudgetError } from "../model/resourceBudget";
import * as engines from "../sim/engine";
import { snapshotContinuity } from "./snapshotContinuity";

describe("runtime scripted traffic budget", () => {
  function controller() {
    const d = diagram();
    d.edges = [];
    const c = new LiveController(d, { roleOf, replayDelayMs: 0, maxParticles: 0 });
    c.selectSimulation({
      id: "budget",
      title: "Budget",
      scale: 1,
      durationMs: 2000,
      traffic: [{ id: "traffic", node: "api", shape: { kind: "constant", ratePerSec: 200_000, durationMs: 1000 } }],
    });
    c.step(500);
    c.setInputs({ ...emptyInputs(), traffic: 10 });
    c.setPlaying(true);
    return c;
  }
  it.each(["advance", "step", "seek"] as const)(
    "pauses and publishes recoverable budget exhaustion during %s",
    (action) => {
      const c = controller();
      expect(() => c[action](1000)).not.toThrow();
      expect(c.getState().playing).toBe(false);
      expect(c.getState().resourceError).toContain("restart with more messages per dot");
      expect(c.getState().snapshot).toEqual(c.realSnapshot());
      expect(c.getState().run!.time).toBe(c.getState().snapshot.time);
      c.setInputs({ ...emptyInputs(), traffic: 1 });
      c.restart();
      expect(c.getState().resourceError).toBeUndefined();
      c.setPlaying(true);
      c.advance(100);
      expect(c.snapshot().time).toBe(100);
      c.dispose();
    },
  );
  it("stops budget-exhausted look-ahead and restores the published run", () => {
    const c = controller(),
      before = c.snapshot(),
      look = c.lookAhead();
    try {
      expect(look.step(1000)).toBe(false);
    } finally {
      look.restore();
    }
    expect(c.snapshot()).toEqual(before);
    expect(c.getState().playing).toBe(false);
    expect(c.getState().resourceError).toContain("restart with more messages per dot");
    c.dispose();
  });
  it("Continue pauses when multiplied timeline injections exhaust the budget", () => {
    const d = diagram();
    d.edges = [];
    const c = new LiveController(d, { roleOf, maxParticles: 0 });
    c.selectSimulation({
      id: "continue",
      title: "Continue",
      scale: 1,
      traffic: [],
      durationMs: 2000,
      timeline: [
        { atMs: 500, action: { do: "note", text: "Wait", pause: true } },
        { atMs: 500, action: { do: "inject", node: "api", count: 30_000 } },
      ],
    });
    c.step(500);
    c.setInputs({ ...emptyInputs(), traffic: 10 });
    expect(() => c.resume()).not.toThrow();
    expect(c.getState().playing).toBe(false);
    expect(c.getState().resourceError).toContain("restart with more messages per dot");
    expect(c.getState().run!.time).toBe(c.getState().snapshot.time);
    c.dispose();
  });
  it("pauses budget-exhausted replay without leaving a replay pending", async () => {
    const c = controller();
    c.setInputs({ ...emptyInputs(), traffic: 10, scale: 2 });
    await vi.waitFor(() => expect(c.getState().resourceError).toContain("restart with more messages per dot"));
    expect(c.getState().playing).toBe(false);
    c.setInputs({ ...emptyInputs(), traffic: 1, scale: 2 });
    c.restart();
    c.step(100);
    expect(c.snapshot().time).toBe(100);
    c.dispose();
  });
});

const roles: Record<string, SimRole> = { src: "source", q: "queue", svc: "processor", db: "store" };
const roleOf = (stencil: string) => roles[stencil] ?? "none";

const diagram = (): DiagramFile => ({
  format: DIAGRAM_FORMAT,
  title: "t",
  nodes: [
    { id: "api", stencil: "src", label: "api", x: 0, y: 0 },
    { id: "queue", stencil: "q", label: "queue", x: 0, y: 0 },
    { id: "worker", stencil: "svc", label: "worker", x: 0, y: 0 },
    { id: "db", stencil: "db", label: "db", x: 0, y: 0 },
  ],
  edges: [
    { id: "e1", from: "api", to: "queue" },
    { id: "e2", from: "queue", to: "worker" },
    { id: "e3", from: "worker", to: "db" },
  ],
});

const storm: Simulation = {
  id: "storm",
  title: "storm",
  seed: 3,
  traffic: [{ id: "t", node: "api", messageType: "MemberJoined", shape: { kind: "burst", count: 20, spreadMs: 500 } }],
  timeline: [
    { atMs: 0, action: { do: "note", text: "go", focus: ["api"] } },
    { atMs: 1000, action: { do: "note", text: "wait for me", pause: true } },
  ],
  expectations: [{ id: "all", label: "all stored", metric: { node: "db", field: "processed" }, op: "==", value: 20 }],
};

const play = (c: LiveController, ms: number) => {
  for (let t = 0; t < ms; t += 16) c.advance(16);
};

describe("LiveController", () => {
  it("batches managed input and diagram edits into one admission reconfiguration", () => {
    const d: DiagramFile = {
      format: "diagrams/v2",
      title: "Shared account",
      planning: { revision: "p3" },
      nodes: ["a", "b"].map((id) => ({
        id,
        stencil: "generic.external-api",
        label: id,
        x: 0,
        y: 0,
        props: { api: { maxInFlight: 2, sharedConcurrency: "account" } },
      })),
      edges: [],
    };
    const c = new LiveController(d);
    const configure = vi.spyOn(admissions, "reconfigureAdmission");
    try {
      const props = Object.fromEntries(
        d.nodes.map((node) => [node.id, { api: { maxInFlight: 3, sharedConcurrency: "account" } }]),
      );
      c.setInputs({ ...emptyInputs(), props });
      expect(configure).toHaveBeenCalledTimes(1);
      configure.mockClear();
      // Clear overrides before reconciling authored values.
      c.setInputs(emptyInputs());
      configure.mockClear();
      const next = structuredClone(d);
      for (const node of next.nodes) node.props = { api: { maxInFlight: 4, sharedConcurrency: "account" } };
      expect(c.updateDiagram(next)).toBe("patched");
      expect(configure).toHaveBeenCalledTimes(1);
    } finally {
      configure.mockRestore();
      c.dispose();
    }
  });
  it("free play: inject flows downstream only while playing", () => {
    const c = new LiveController(diagram(), { roleOf });
    c.inject("api", 10);
    expect(c.snapshot().inSystem).toBe(10);
    play(c, 1000);
    expect(c.snapshot().time).toBe(0); // paused by default
    c.setPlaying(true);
    c.setSpeed(8);
    play(c, 2000);
    expect(c.snapshot().nodes.db.processed).toBe(10);
    expect(c.getState().speed).toBe(8);
  });

  it("publishes state to subscribers", () => {
    const c = new LiveController(diagram(), { roleOf });
    let calls = 0;
    const off = c.subscribe(() => calls++);
    c.setTraffic(true);
    c.setPlaying(true);
    expect(calls).toBe(2);
    expect(c.getState()).toMatchObject({ traffic: true, playing: true });
    off();
    c.setPlaying(false);
    expect(calls).toBe(2);
  });

  it("runs a saved simulation, waits on pausing notes, and finishes", () => {
    const c = new LiveController(diagram(), { roleOf });
    c.selectSimulation(storm);
    c.setSpeed(4);
    c.setPlaying(true);
    play(c, 600);
    expect(c.getState().run?.note?.text).toBe("go");
    play(c, 2000);
    c.publish();
    const waiting = c.getState().run!;
    expect(waiting.waiting).toBe(true);
    expect(waiting.note?.text).toBe("wait for me");
    const frozen = c.snapshot().time;
    play(c, 500);
    expect(c.snapshot().time).toBe(frozen);
    c.resume();
    play(c, 20_000);
    const end = c.getState();
    expect(end.run?.done).toBe(true);
    expect(end.playing).toBe(false);
    expect(end.run?.expectations[0]).toMatchObject({ status: "pass", value: 20 });
  });

  it("seeks forward and back deterministically", () => {
    const c = new LiveController(diagram(), { roleOf });
    c.selectSimulation(storm);
    c.seek(3000);
    const forward = c.snapshot();
    expect(forward.time).toBeGreaterThanOrEqual(2990);
    const processed = forward.nodes.db.processed;
    c.seek(500);
    expect(c.snapshot().time).toBeLessThan(600);
    c.seek(3000);
    expect(c.snapshot().nodes.db.processed).toBe(processed);
  });

  it.each([false, true])("constructs only the published snapshot per seek (playing=%s)", (playing) => {
    const create = vi.spyOn(engines, "createEngine");
    const c = new LiveController(diagram(), { roleOf });
    c.selectSimulation(storm);
    c.setPlaying(playing);
    const snapshot = vi.spyOn(create.mock.results.at(-1)!.value!, "snapshot");
    try {
      for (const target of [0, 3000, 500, 500]) {
        const before = c.snapshot();
        const continuity = snapshotContinuity.get(before);
        snapshot.mockClear();
        c.seek(target);
        const after = c.snapshot();
        expect(snapshot, `seek to ${target} from ${before.time}`).toHaveBeenCalledOnce();
        expect(after.time).toBe(target);
        expect(snapshotContinuity.get(after)).not.toBe(continuity);
        expect(snapshotContinuity.get(before)).toBe(continuity);
      }
    } finally {
      snapshot.mockRestore();
      create.mockRestore();
      c.dispose();
    }
  });

  it("steps a fixed slice and restarts clean", () => {
    const c = new LiveController(diagram(), { roleOf });
    c.step(250);
    expect(c.snapshot().time).toBe(250);
    c.setNodeStatus("worker", "down");
    expect(c.getState().tweaks.get("worker")?.status).toBe("down");
    const gen = c.getState().generation;
    c.restart();
    expect(c.snapshot().time).toBe(0);
    expect(c.getState().tweaks.size).toBe(0);
    expect(c.getState().generation).toBe(gen + 1);
  });

  it("tracks live tweaks and effective props", () => {
    const c = new LiveController(diagram(), { roleOf });
    c.setNodeProps("worker", { latencyMs: 500 });
    c.setNodeProps("worker", { failureRate: 0.5 });
    expect(c.getState().tweaks.get("worker")?.props).toEqual({ latencyMs: 500, failureRate: 0.5 });
    expect(c.effectiveProps("worker")).toEqual({ latencyMs: 500, failureRate: 0.5 });
    c.clearTweaks("worker");
    expect(c.getState().tweaks.size).toBe(0);
  });

  it("patches only changed diagram props, preserving setup and live overrides", () => {
    const d = diagram();
    d.nodes[2].props = { latencyMs: 100, concurrency: 4, emits: { Created: "Done", "*": "Other" } };
    const c = new LiveController(d, { roleOf });
    c.selectSimulation({ ...storm, traffic: [], timeline: [], setup: { props: { worker: { latencyMs: 5000 } } } });
    c.setNodeProps("worker", { failureRate: 0.25, emits: "Overridden" });
    const next = structuredClone(d);
    next.nodes[2].props!.concurrency = 1;
    next.nodes[2].props!.emits = { "*": "Other", Created: "Done" };
    expect(c.updateDiagram(next)).toBe("patched");
    expect(c.effectiveProps("worker")).toMatchObject({
      latencyMs: 5000,
      concurrency: 1,
      failureRate: 0.25,
      emits: "Overridden",
    });
    c.inject("worker", 1);
    c.step(500);
    expect(c.snapshot().nodes.worker.processed).toBe(0);
  });

  it("reads timeline prop changes from the engine without recording them as live tweaks", () => {
    const c = new LiveController(diagram(), { roleOf });
    c.selectSimulation({
      ...storm,
      timeline: [{ atMs: 100, action: { do: "props", node: "worker", props: { concurrency: 1 } } }],
    });
    c.step(200);
    expect(c.effectiveProps("worker").concurrency).toBe(1);
    expect(c.getState().tweaks.size).toBe(0);
    const props = c.effectiveProps("worker");
    props.concurrency = 99;
    expect(c.effectiveProps("worker").concurrency).toBe(1);
  });

  it("ignores moves, patches props and rebuilds on structural edits", () => {
    const d = diagram();
    const c = new LiveController(d, { roleOf });
    c.inject("api", 5);
    const moved = { ...d, nodes: d.nodes.map((n) => ({ ...n, x: n.x + 50 })) };
    expect(c.updateDiagram(moved)).toBe("none");
    expect(structuralKey(moved)).toBe(structuralKey(d));
    const slowed = {
      ...moved,
      nodes: moved.nodes.map((n) => (n.id === "worker" ? { ...n, props: { latencyMs: 900, status: "paused" } } : n)),
    };
    expect(c.updateDiagram(slowed)).toBe("patched");
    expect(c.snapshot().nodes.worker.status).toBe("paused");
    expect(c.snapshot().inSystem).toBe(5); // nothing was lost
    const unslowed = {
      ...slowed,
      nodes: slowed.nodes.map((n) => (n.id === "worker" ? { ...n, props: undefined } : n)),
    };
    expect(c.updateDiagram(unslowed)).toBe("patched");
    expect(c.snapshot().inSystem).toBe(5);
    expect(c.effectiveProps("worker")).not.toHaveProperty("latencyMs");
    expect(c.snapshot().nodes.worker.status).toBe("up");
    const rewired = { ...unslowed, edges: unslowed.edges.slice(0, 2) };
    expect(c.updateDiagram(rewired)).toBe("reloaded");
  });

  it("injects at entry points", () => {
    const c = new LiveController(diagram(), { roleOf });
    expect(c.injectAtSources(3)).toEqual(["api"]);
    expect(c.snapshot().inSystem).toBe(3);
  });

  it("keeps the existing inspector naming semantics during a running simulation", () => {
    const d = diagram();
    const group = { id: "core", label: "Core", x: 0, y: 0, width: 400, height: 200 };
    d.groups = [group];
    const c = new LiveController(d, { roleOf });
    const simulation = { ...storm, setup: { props: { worker: { latencyMs: 500 } } } };
    c.selectSimulation(simulation);
    c.setPlaying(true);
    c.inject("api", 5);
    play(c, 500);
    const before = c.getState();
    const time = c.snapshot().time;
    const renamed = {
      ...d,
      groups: [{ ...group, label: "Platform" }],
      edges: d.edges.map((e) => ({ ...e, label: "Delivery" })),
    };
    expect(c.updateDiagram(renamed)).toBe("none");
    expect(c.getState().generation).toBe(before.generation);
    expect(c.snapshot().time).toBe(time);
    expect(c.getState().playing).toBe(true);
    expect(c.getState().simulation).toBe(simulation);
    expect(c.effectiveProps("worker").latencyMs).toBe(500);
    for (const field of ["label", "sublabel"] as const) {
      const generation = c.getState().generation;
      renamed.nodes = renamed.nodes.map((n) => (n.id === "api" ? { ...n, [field]: "New name" } : n));
      expect(c.updateDiagram(renamed)).toBe("reloaded");
      expect(c.getState().generation).toBe(generation + 1);
      expect(c.snapshot().time).toBe(0);
      expect(c.getState().playing).toBe(true);
      expect(c.getState().simulation).toBe(simulation);
      expect(c.effectiveProps("worker").latencyMs).toBe(500);
      expect(c.getState().run?.expectations).toHaveLength(1);
    }
  });

  it("plays a finished run again from the start", () => {
    const c = new LiveController(diagram(), { roleOf });
    c.selectSimulation({ ...storm, timeline: [] });
    c.setSpeed(8);
    c.setPlaying(true);
    play(c, 10_000);
    expect(c.getState().run?.done).toBe(true);
    c.setPlaying(true);
    expect(c.snapshot().time).toBe(0);
    expect(c.getState().playing).toBe(true);
  });

  it("publishes real units at scale > 1 while particles and the sampled snapshot stay in dots", () => {
    const sim: Simulation = {
      id: "sampled",
      title: "sampled",
      seed: 1,
      scale: 50,
      traffic: [{ id: "t", node: "api", shape: { kind: "burst", count: 1000 } }],
      expectations: [{ id: "all", label: "all", metric: { node: "db", field: "processed" }, op: "==", value: 1000 }],
    };
    const c = new LiveController(diagram(), { roleOf });
    c.selectSimulation(sim);
    c.setSpeed(8);
    c.setPlaying(true);
    play(c, 30000);
    c.publish();
    const state = c.getState();
    expect(state.scale).toBe(50);
    expect(c.snapshot().nodes.db.processed).toBe(20);
    expect(state.snapshot.nodes.db.processed).toBe(1000);
    expect(state.snapshot.units).toBe("real");
    // Expectations and badges now agree.
    expect(state.run?.expectations[0]).toMatchObject({ status: "pass", value: 1000 });
  });

  it("manual injections take real counts and carry fractions of a dot", () => {
    const sim: Simulation = { id: "s", title: "s", scale: 50, traffic: [] };
    const c = new LiveController(diagram(), { roleOf });
    c.selectSimulation(sim);
    c.inject("api", 100);
    expect(c.snapshot().inSystem).toBe(2);
    expect(c.getState().snapshot.inSystem).toBe(100);
    c.inject("api", 30);
    expect(c.snapshot().inSystem).toBe(2);
    c.inject("api", 30); // 60 carried: one more dot
    expect(c.snapshot().inSystem).toBe(3);
    // Free play keeps scale 1, so counts are exact.
    const free = new LiveController(diagram(), { roleOf });
    free.inject("api", 7);
    expect(free.snapshot().inSystem).toBe(7);
    expect(free.injectAtSources(3)).toEqual(["api"]);
    expect(free.getState().snapshot.inSystem).toBe(10);
  });

  describe("inputs & capacity", () => {
    const KAFKA = kafka as DiagramFile;
    const blackFriday = KAFKA.simulations!.find((x) => x.id === "black-friday")!;
    const running = () => {
      const c = new LiveController(KAFKA, { replayDelayMs: 0 });
      c.selectSimulation(blackFriday);
      c.setPlaying(true);
      play(c, 2000);
      return c;
    };

    it("multipliers and props patch the running run without restarting it", () => {
      const c = running();
      const { generation } = c.getState();
      const time = c.snapshot().time;
      c.setInputs({ ...emptyInputs(), traffic: 3, props: { payments: { replicas: 9 } } });
      const state = c.getState();
      expect(state.generation).toBe(generation);
      expect(c.snapshot().time).toBe(time);
      expect(state.run?.multipliers).toEqual({ traffic: 3, capacity: 1 });
      expect(c.effectiveProps("payments").replicas).toBe(9);
      expect(state.simulation).toBe(blackFriday);
      expect(state.running?.multipliers?.traffic).toBe(3);
      // Removing the override falls back to the saved setup.
      c.setInputs({ ...emptyInputs(), traffic: 3 });
      expect(c.effectiveProps("payments").replicas).toBe(6);
    });

    it("entry rates and the dot scale replay the run to the same moment", () => {
      vi.useFakeTimers();
      try {
        const c = running();
        const { generation } = c.getState();
        const time = c.snapshot().time;
        c.setInputs({ ...emptyInputs(), rates: { shopper: 4000 } });
        expect(c.getState().generation).toBeGreaterThan(generation);
        vi.runAllTimers();
        expect(c.snapshot().time).toBeGreaterThanOrEqual(time - 10);
        expect(c.getState().running?.traffic[0].shape).toMatchObject({ ratePerSec: 4000 });
        c.setInputs({ ...emptyInputs(), scale: 100 });
        vi.runAllTimers();
        expect(c.getState().scale).toBe(100);
        c.dispose();
      } finally {
        vi.useRealTimers();
      }
    });

    it("waits for rate edits to settle before replaying", () => {
      vi.useFakeTimers();
      try {
        const c = new LiveController(KAFKA, { replayDelayMs: 250 });
        c.selectSimulation(blackFriday);
        const { generation } = c.getState();
        c.setInputs({ ...emptyInputs(), rates: { shopper: 3000 } });
        c.setInputs({ ...emptyInputs(), rates: { shopper: 3500 } });
        expect(c.getState().generation).toBe(generation);
        vi.advanceTimersByTime(300);
        expect(c.getState().generation).toBe(generation + 1);
        c.setInputs({ ...emptyInputs(), rates: { shopper: 1000 } });
        c.flush();
        expect(c.getState().generation).toBe(generation + 2);
        c.dispose();
      } finally {
        vi.useRealTimers();
      }
    });

    it("a new saved definition keeps the inputs and patches live; selecting another simulation clears them", () => {
      const c = running();
      c.setInputs({ ...emptyInputs(), traffic: 2 });
      const { generation } = c.getState();
      const fixed = structuredClone(blackFriday);
      fixed.setup!.props!.payments = { replicas: 20 };
      c.setBase(fixed);
      expect(c.getState().generation).toBe(generation);
      expect(c.effectiveProps("payments").replicas).toBe(20);
      expect(c.getState().inputs.traffic).toBe(2);
      c.commitInputs({ ...fixed, multipliers: { traffic: 2, capacity: 1 } });
      expect(c.getState().inputs).toEqual(emptyInputs());
      expect(c.getState().generation).toBe(generation);
      c.selectSimulation(null);
      expect(c.getState().inputs).toEqual(emptyInputs());
    });

    it("free play: Traffic × scales source rates, Capacity × replicas, and busy rates pick a coarser dot", () => {
      const c = new LiveController(KAFKA, { replayDelayMs: 0 });
      expect(c.getState().scale).toBe(1);
      const { generation } = c.getState();
      c.setInputs({ ...emptyInputs(), traffic: 2, capacity: 2 });
      expect(c.getState().generation).toBe(generation);
      expect(c.effectiveProps("shopper").ratePerSec).toBe(50);
      c.setInputs({ ...emptyInputs(), rates: { shopper: 2000 } });
      expect(c.getState().generation).toBe(generation + 1);
      expect(c.getState().scale).toBe(50);
      expect(c.effectiveProps("shopper").ratePerSec).toBe(2000);
      // Saving folds the inputs into the diagram without touching the engine.
      const next = structuredClone(KAFKA);
      next.nodes.find((n) => n.id === "shopper")!.props!.ratePerSec = 2000;
      c.commitInputs(null, next);
      expect(c.getState().generation).toBe(generation + 1);
      expect(c.effectiveProps("shopper").ratePerSec).toBe(2000);
    });

    it("diagram prop edits don't override what the running simulation sets", () => {
      const c = running();
      const next = structuredClone(KAFKA);
      next.nodes.find((n) => n.id === "payments")!.props = {
        ...next.nodes.find((n) => n.id === "payments")!.props,
        replicas: 1,
        latencyMs: 90,
      };
      expect(c.updateDiagram(next)).toBe("patched");
      expect(c.effectiveProps("payments")).toMatchObject({ replicas: 6, latencyMs: 90 });
    });
  });
});

describe("automatic dot scale for runs", () => {
  const dense: Simulation = {
    id: "dense",
    title: "dense",
    traffic: [{ id: "t", node: "api", shape: { kind: "constant", ratePerSec: 5000, durationMs: 2000 } }],
  };

  it("a run without a saved scale picks one from its traffic, without writing it into the simulation", () => {
    const c = new LiveController(diagram(), { roleOf });
    c.selectSimulation(dense);
    // 5,000 messages a second at about 60 dots a second at most: the 1/2/5 series gives 100.
    expect(c.getState().scale).toBe(100);
    expect(c.getState().simulation?.scale).toBeUndefined();
    expect(c.getState().running?.scale).toBeUndefined();
  });

  it("a saved scale wins, and gentle traffic stays at one dot per message", () => {
    const c = new LiveController(diagram(), { roleOf });
    c.selectSimulation({ ...dense, scale: 1 });
    expect(c.getState().scale).toBe(1);
    c.selectSimulation(storm);
    expect(c.getState().scale).toBe(1);
  });
});

describe("fourth review controller regressions", () => {
  it("saving free-play capacity preserves effective replicas", () => {
    const d = structuredClone(kafka) as DiagramFile;
    const worker = d.nodes.find((n) => n.id === "payments")!;
    worker.props = { ...worker.props, replicas: 2 };
    const c = new LiveController(d, { replayDelayMs: 0 });
    c.setInputs({ ...emptyInputs(), capacity: 2 });
    c.setPlaying(true);
    c.inject("payments", 5);
    c.step(100);
    const before = c.snapshot();
    const generation = c.getState().generation;
    const patch = freePlaySaveProps(d, c.getState().inputs);
    const next = { ...d, nodes: d.nodes.map((n) => ({ ...n, props: { ...n.props, ...patch[n.id] } })) };
    expect(patch.payments.replicas).toBe(4);
    expect(before.nodes.payments.replicas).toBe(4);
    c.commitInputs(null, next);
    expect(c.effectiveProps("payments").replicas).toBe(4);
    expect(c.snapshot().nodes.payments.replicas).toBe(4);
    expect(c.snapshot().nodes.payments.activeReplicas).toBe(before.nodes.payments.activeReplicas);
    expect(c.snapshot().nodes.payments.processed).toBe(before.nodes.payments.processed);
    expect(c.snapshot().time).toBe(before.time);
    expect(c.getState()).toMatchObject({ generation, playing: true, inputs: emptyInputs() });
    expect(c.updateDiagram(next)).toBe("none");
    c.restart();
    expect(c.snapshot().nodes.payments.replicas).toBe(4);
  });

  it("recalculates derived traffic rates on edits and undo while preserving explicit rates", () => {
    const d = structuredClone(kafka) as DiagramFile;
    const source = d.nodes.find((n) => n.id === "shopper")!;
    source.props = { ...source.props, ratePerSec: 2 };
    const c = new LiveController(d, { replayDelayMs: 0 });
    c.setInputs({ ...emptyInputs(), traffic: 2 });
    const next = structuredClone(d);
    next.nodes.find((n) => n.id === "shopper")!.props!.ratePerSec = 10;
    c.updateDiagram(next);
    expect(c.effectiveProps("shopper").ratePerSec).toBe(20);
    c.updateDiagram(d);
    expect(c.effectiveProps("shopper").ratePerSec).toBe(4);
    c.setInputs({ ...emptyInputs(), traffic: 2, rates: { shopper: 3 } });
    c.updateDiagram(next);
    expect(c.effectiveProps("shopper").ratePerSec).toBe(6);
  });

  it("restart consumes pending input replay", () => {
    vi.useFakeTimers();
    try {
      const c = new LiveController(diagram(), { roleOf });
      c.selectSimulation({ id: "r", title: "r", scale: 1, traffic: [], durationMs: 10000 });
      c.setInputs({ ...emptyInputs(), rates: { api: 10 } });
      c.restart();
      c.inject("db", 7);
      c.step(500);
      const generation = c.getState().generation;
      const before = c.snapshot();
      expect(before.nodes.db.processed).toBe(7);
      vi.advanceTimersByTime(1000);
      expect(c.getState().generation).toBe(generation);
      expect(c.snapshot()).toEqual(before);
      c.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shares manual sampling by effective type in free play and saved runs", () => {
    for (const saved of [false, true]) {
      const d = diagram();
      d.nodes[3].props = { messageType: "Order" };
      const c = new LiveController(d, { roleOf, replayDelayMs: 0 });
      if (saved) c.selectSimulation({ id: "r", title: "r", traffic: [], scale: 50, durationMs: 10000 });
      else c.setInputs({ ...emptyInputs(), scale: 50 });
      c.inject("db", 25);
      c.inject("db", 25, { type: "Order" });
      c.step(100);
      expect(c.snapshot().nodes.db.processed).toBe(1);
      c.restart();
      c.inject("db", 25);
      c.setNodeProps("db", { messageType: "Invoice" });
      c.inject("db", 25);
      c.step(100);
      expect(c.snapshot().nodes.db.processed).toBe(0);
      for (const invalid of [NaN, Infinity, -1]) c.inject("db", invalid);
      c.inject("db", 25);
      c.step(100);
      expect(c.snapshot().nodes.db.processed).toBe(1);
      c.dispose();
    }
  });
});

describe("bounded replay and checkpoint scrubbing", () => {
  const longRun: Simulation = {
    id: "long",
    title: "Long",
    seed: 3,
    scale: 1,
    durationMs: 300000,
    traffic: [
      { id: "t", node: "api", messageType: "Order", shape: { kind: "constant", ratePerSec: 2, durationMs: 300000 } },
    ],
  };

  it("yields automatic replay and cancels obsolete work while retaining its original target", () => {
    vi.useFakeTimers();
    try {
      const c = new LiveController(diagram(), { roleOf, replayDelayMs: 0 });
      c.selectSimulation(longRun);
      c.seek(60000);
      const generation = c.getState().generation;
      c.setInputs({ ...emptyInputs(), rates: { api: 3 } });
      expect(c.snapshot().time).toBeLessThan(60000);
      c.setInputs({ ...emptyInputs(), rates: { api: 4 } });
      expect(c.getState().generation).toBe(generation + 2);
      vi.runAllTimers();
      expect(c.snapshot().time).toBe(60000);
      expect(c.getState().running?.traffic[0].shape).toMatchObject({ ratePerSec: 4 });
      const expected = new LiveController(diagram(), { roleOf });
      expected.selectSimulation({
        ...longRun,
        traffic: [{ ...longRun.traffic[0], shape: { kind: "constant", ratePerSec: 4, durationMs: 300000 } }],
      });
      expected.seek(60000);
      expect(c.snapshot()).toEqual(expected.snapshot());
      c.setInputs({ ...emptyInputs(), rates: { api: 5 } });
      c.restart();
      c.inject("db", 7);
      c.step(500);
      const before = c.snapshot();
      vi.runAllTimers();
      expect(c.snapshot()).toEqual(before);
      c.dispose();
      expected.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("scrubs backwards from checkpoints without rebuilding and matches uninterrupted playback", () => {
    const c = new LiveController(diagram(), { roleOf });
    c.selectSimulation(longRun);
    c.seek(240000); // More than the retention window exercises eviction of old checkpoints.
    const generation = c.getState().generation;
    const uninterrupted = c.snapshot();
    c.seek(222000);
    expect(c.getState().generation).toBe(generation);
    expect(c.snapshot().time).toBe(222000);
    c.seek(240000);
    expect(c.snapshot()).toEqual(uninterrupted);
    c.seek(1000); // Origin survives eviction.
    expect(c.snapshot().time).toBe(1000);
    expect(c.getState().generation).toBe(generation);
    c.seek(240000);
    expect(c.snapshot()).toEqual(uninterrupted);
  });
});

it("a saved scale override cannot enable unsafe continuous sources; automatic sampling accepts the same file rate", () => {
  const d = diagram();
  d.nodes[0].props = { ratePerSec: 10_000_000 };
  d.edges = [d.edges[0]];
  d.nodes[0].stencil = "client.browser";
  d.nodes[1].stencil = "aws.sqs";
  const c = new LiveController(d);
  const sim: Simulation = { id: "empty", title: "Empty", scale: 1, durationMs: 1_000, traffic: [] };
  c.selectSimulation(sim);
  c.setTraffic(true);
  c.step(10);
  expect(c.getState().traffic).toBe(false);
  expect(c.snapshot().nodes.api.processed).toBe(0);
  expect(c.trafficHint()).toContain("higher sampling scale");
  c.selectSimulation({ ...sim, scale: undefined });
  c.setTraffic(true);
  c.step(1_000);
  expect(c.getState().traffic).toBe(true);
  expect(c.getState().snapshot.nodes.api.processed).toBeGreaterThan(1_000_000);
  expect(c.snapshot().nodes.api.processed).toBeLessThanOrEqual(60);
});

describe("A1 round 3 controller boundaries", () => {
  it("refuses a combined over-budget draft before replacing the running simulation", () => {
    const d = autoscalingFixture(),
      worker = d.nodes[1];
    d.edges = [];
    d.nodes = Array.from({ length: 25 }, (_, i) => ({
      ...structuredClone(worker),
      id: `worker-${i}`,
      props: { ...worker.props, replicas: 1000, autoscaling: { mode: "off" } },
    }));
    const c = new LiveController(d);
    const sim: Simulation = { id: "valid", title: "Valid", traffic: [], durationMs: 10_000 };
    expect(c.selectSimulation(sim)).toBe("selected");
    c.step(100);
    const before = c.snapshot();
    expect(
      c.selectSimulation({
        ...sim,
        id: "draft",
        timeline: [{ atMs: 1000, action: { do: "props", node: "worker-0", props: { replicas: 1001 } } }],
      }),
    ).toBe("rejected");
    expect(c.getState().simulation).toEqual(sim);
    expect(c.snapshot()).toEqual(before);
    expect(c.getState().resourceError).toContain("100");
    c.step(100);
    expect(c.snapshot().time).toBeGreaterThan(before.time);
    c.dispose();
  });
  it.each(["advance", "step", "seek"] as const)("recovers from runtime lifecycle refusal during %s", (action) => {
    const c = new LiveController(autoscalingFixture());
    c.selectSimulation({
      id: "draft",
      title: "Draft",
      traffic: [],
      durationMs: 10_000,
      timeline: [{ atMs: 1000, action: { do: "props", node: "worker", props: { replicas: 2 } } }],
    });
    c.step(990);
    c.setPlaying(true);
    const before = c.snapshot();
    const fleet = before.nodes.worker.fleet;
    const budget = vi.spyOn(allocations, "validateAllocationActions").mockImplementation(() => {
      throw new LifecycleBudgetError("Resource lifecycle budget exceeded: 100000");
    });
    try {
      expect(() => c[action](1100)).not.toThrow();
      expect(c.getState().playing).toBe(false);
      expect(c.getState().resourceError).toContain("100");
      expect(c.snapshot().nodes.worker.fleet!.desired).toBe(fleet!.desired);
      expect(c.snapshot()).toEqual(before);
    } finally {
      budget.mockRestore();
    }
    c.step(10);
    expect(c.snapshot().time).toBe(1000);
    expect(c.snapshot().nodes.worker.fleet!.desired).toBe(2);
    c.restart();
    expect(c.getState().resourceError).toBeUndefined();
    c.setPlaying(true);
    c.advance(100);
    expect(c.snapshot().time).toBeGreaterThan(0);
    c.dispose();
  });
  it("Continue handles lifecycle refusal and retries the pending action exactly once", () => {
    const c = new LiveController(autoscalingFixture());
    c.selectSimulation({
      id: "continue",
      title: "Continue",
      scale: 1,
      traffic: [],
      durationMs: 10_000,
      timeline: [
        { atMs: 1000, action: { do: "note", text: "Wait", pause: true } },
        { atMs: 1000, action: { do: "props", node: "worker", props: { replicas: 2 } } },
        { atMs: 1000, action: { do: "inject", node: "source", count: 7 } },
      ],
    });
    c.step(1000);
    const before = c.snapshot(),
      run = c.getState().run;
    const budget = vi.spyOn(allocations, "validateAllocationActions").mockImplementation(() => {
      throw new LifecycleBudgetError("Resource lifecycle budget exceeded: 100000");
    });
    try {
      expect(() => c.resume()).not.toThrow();
      expect(c.getState().playing).toBe(false);
      expect(c.getState().resourceError).toContain("100");
      expect(c.getState().run).toEqual(run);
      expect(c.snapshot()).toEqual(before);
    } finally {
      budget.mockRestore();
    }
    c.resume();
    expect(c.getState().run?.waiting).toBe(false);
    expect(c.snapshot().nodes.worker.fleet!.desired).toBe(2);
    const after = c.snapshot();
    expect(after.inSystem).toBe(before.inSystem + 7);
    c.resume();
    expect(c.snapshot()).toEqual(after);
    c.dispose();
  });
  it("a refused slow-motion forecast stops and restores its sandbox without consuming the action", () => {
    const c = new LiveController(autoscalingFixture());
    c.selectSimulation({
      id: "forecast",
      title: "Forecast",
      traffic: [],
      durationMs: 10_000,
      timeline: [{ atMs: 1000, action: { do: "props", node: "worker", props: { replicas: 2 } } }],
    });
    c.step(990);
    const before = c.snapshot(),
      sandbox = c.lookAhead();
    const budget = vi.spyOn(allocations, "validateAllocationActions").mockImplementation(() => {
      throw new LifecycleBudgetError("Resource lifecycle budget exceeded: 100000");
    });
    try {
      expect(sandbox.step(1100)).toBe(false);
    } finally {
      sandbox.restore();
      budget.mockRestore();
    }
    expect(c.snapshot()).toEqual(before);
    c.step(10);
    expect(c.snapshot().time).toBe(1000);
    expect(c.snapshot().nodes.worker.fleet!.desired).toBe(2);
    c.dispose();
  });
  it("saving Capacity x folds the HPA policy without creating additional replicas", () => {
    const d = autoscalingFixture(),
      c = new LiveController(d, { replayDelayMs: 0 });
    c.setInputs({ ...emptyInputs(), capacity: 2 });
    c.setPlaying(true);
    c.step(1000);
    const before = c.snapshot();
    const patches = freePlaySaveProps(d, c.getState().inputs);
    const saved = { ...d, nodes: d.nodes.map((n) => ({ ...n, props: { ...n.props, ...patches[n.id] } })) };
    c.commitInputs(null, saved);
    expect(c.snapshot().nodes.worker).toEqual(before.nodes.worker);
    expect(c.snapshot().time).toBe(before.time);
    expect(c.getState().inputs).toEqual(emptyInputs());
    c.dispose();
  });
  it("refuses an oversized setInputs atomically before creating startup cohorts", () => {
    const d = autoscalingFixture(),
      worker = d.nodes[1];
    d.nodes = Array.from({ length: 11 }, (_, i) => ({
      ...structuredClone(worker),
      id: `w-${i}`,
      props: {
        ...worker.props,
        autoscaling: { mode: "off" },
        resources: { ...resourceLesson(), startup: { delayMs: 5000, jitterFraction: 0.5 } },
      },
    }));
    d.edges = [];
    const c = new LiveController(d, { replayDelayMs: 0 });
    c.setPlaying(true);
    c.step(100);
    const before = c.snapshot(),
      inputs = c.getState().inputs;
    expect(() =>
      c.setInputs({
        ...emptyInputs(),
        capacity: 2,
        props: Object.fromEntries(d.nodes.map((n) => [n.id, { replicas: 10_000 }])),
      }),
    ).toThrow(/100/);
    expect(c.getState().inputs).toEqual(inputs);
    expect(c.snapshot()).toEqual(before);
    c.dispose();
  });
});

it("scripted sampled CPU budget refusal keeps work queued, announces recovery and survives checkpoints", () => {
  const d = sampledCpuBudgetFixture();
  const c = new LiveController(d);
  c.selectSimulation(d.simulations![0]);
  c.step(6000);
  expect(c.getState().resourceError).toContain("New messages are waiting");
  expect(c.snapshot().inSystem).toBe(200);
  expect(c.snapshot().nodes.worker.backlog).toBeGreaterThan(0);
  const before = c.snapshot();
  const look = c.lookAhead();
  look.step(100);
  look.restore();
  expect(c.snapshot()).toEqual(before);
  c.restart();
  expect(c.getState().resourceError).toBeUndefined();
  c.dispose();
});
