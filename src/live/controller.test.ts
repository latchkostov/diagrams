import { describe, expect, it } from "vitest";
import { DIAGRAM_FORMAT, type DiagramFile, type Simulation } from "../model/types";
import type { SimRole } from "../model/types";
import { LiveController, structuralKey } from "./controller";

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
});
