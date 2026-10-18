import { describe, expect, it } from "vitest";
import type { DiagramFile, SimRole, Simulation } from "../model/types";
import type { Fault } from "../model/faults";
import { createEngine } from "./engine";
import { createSimulationRun } from "./simulation";
import { LiveController } from "../live/controller";
import { canCutLink, faultTimelineProblem, MAX_FAULT_WORK } from "../model/faults";
import { resourceLesson } from "../model/autoscaling";

export const diagram: DiagramFile = {
  format: "diagrams/v1",
  title: "Fault test",
  groups: [
    { id: "region", label: "Region", x: 0, y: 0, width: 900, height: 400 },
    { id: "a", label: "Zone a", group: "region", x: 0, y: 0, width: 300, height: 300 },
    { id: "b", label: "Zone b", group: "region", x: 500, y: 0, width: 300, height: 300 },
  ],
  nodes: [
    { id: "source", label: "Source", stencil: "source", x: 0, y: 0, group: "a" },
    {
      id: "worker",
      label: "Worker",
      stencil: "processor",
      x: 550,
      y: 40,
      group: "b",
      props: { latencyMs: 100, jitter: 0, failureRate: 0, concurrency: 100 },
    },
  ],
  edges: [{ id: "ab", from: "source", to: "worker", props: { travelMs: 10 } }],
};
const roleOf = (id: string) => id as SimRole;
const make = (d = diagram) => {
  const engine = createEngine({ seed: 7, roleOf, traceHistory: 20 });
  engine.load(d);
  return engine;
};

describe("fault overlays", () => {
  it("reports the actual connection and resolved fault cause for each loss", () => {
    const losses: import("./types").LossProvenance[] = [];
    const d = structuredClone(diagram);
    d.nodes.push({ ...d.nodes[0], id: "healthy" });
    d.edges.push({ ...d.edges[0], id: "healthy-input", from: "healthy" });
    d.nodes[1].props!.failureRate = 1;
    const e = createEngine({ seed: 7, roleOf, onLoss: (loss) => losses.push(loss) });
    e.load(d);
    e.setFault({ kind: "link", edge: "ab", cut: true });
    e.inject("source", 1);
    e.inject("healthy", 1);
    e.step(1000);
    expect(losses).toEqual([
      expect.objectContaining({
        node: "worker",
        connection: "ab",
        intentional: "down",
        fault: { kind: "link", edge: "ab", cut: true },
      }),
      expect.objectContaining({
        node: "worker",
        connection: "healthy-input",
        intentional: undefined,
        fault: undefined,
      }),
    ]);
  });
  it("bounds unchanged restoration work on a large, deeply nested adversarial diagram", () => {
    const d: DiagramFile = {
      ...diagram,
      groups: Array.from({ length: 1000 }, (_, i) => ({
        id: `g${i}`,
        label: "Zone",
        group: i ? `g${i - 1}` : undefined,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      })),
      nodes: Array.from({ length: 5000 }, (_, i) => ({
        id: `n${i}`,
        stencil: "processor",
        label: "Worker",
        group: "g999",
        x: 0,
        y: 0,
      })),
      edges: [],
    };
    const e = make(d);
    const stringify = JSON.stringify;
    let operations = 0;
    JSON.stringify = ((...args: Parameters<typeof stringify>) => {
      operations++;
      return stringify(...args);
    }) as typeof stringify;
    try {
      for (let i = 0; i < 10_000; i++) {
        const before = operations;
        e.setFault({ kind: "boundary", boundary: "g0", down: false });
        // Check each step so the old interpreter fails before replaying the hostile timeline.
        expect(operations - before).toBeLessThanOrEqual(2);
      }
      e.setFault({ kind: "boundary", boundary: "g999", down: true });
      const before = operations;
      e.setFault({ kind: "boundary", boundary: "g999", down: true });
      expect(operations - before).toBeLessThanOrEqual(3);
    } finally {
      JSON.stringify = stringify;
    }
    expect(e.snapshot().nodes.n0.status).toBe("down");
    const timeline: NonNullable<Simulation["timeline"]> = Array.from({ length: 10_000 }, () => ({
      atMs: 0,
      action: { do: "fault", fault: { kind: "boundary", boundary: "g0", down: false } },
    }));
    expect(faultTimelineProblem(d, { id: "s", title: "Restores", traffic: [], timeline })).toBeUndefined();
    for (let i = 0; i <= MAX_FAULT_WORK / d.nodes.length; i++)
      timeline[i].action = { do: "fault", fault: { kind: "boundary", boundary: "g0", down: i % 2 === 0 } };
    const sim = { id: "s", title: "Repeated outage", traffic: [], timeline };
    expect(faultTimelineProblem(d, sim)).toMatch(/too many nodes/);
    expect(() => createSimulationRun(d, sim)).toThrow(/too many nodes/);
  });
  it("indexes boundary parents once per load rather than scanning all boundaries for every node", () => {
    let reads = 0;
    const groups = Array.from({ length: 500 }, (_, i) => ({
      id: `zone-${i}`,
      label: `Zone ${i}`,
      x: 0,
      y: 0,
      width: 300,
      height: 300,
      get group(): string | undefined {
        reads++;
        return undefined;
      },
    }));
    make({
      ...diagram,
      groups,
      nodes: groups.map((g) => ({
        id: `node-${g.id}`,
        group: g.id,
        stencil: "processor",
        label: "Worker",
        x: 0,
        y: 0,
      })),
      edges: [],
    });
    expect(reads).toBe(groups.length);
  });
  it("downs nested members, composes overlapping outages and restores each node's current underlying status", () => {
    const e = make();
    e.setNodeStatus("worker", "paused");
    e.setFault({ kind: "boundary", boundary: "region", down: true });
    expect(Object.values(e.snapshot().nodes).map((n) => n.status)).toEqual(["down", "down"]);
    e.setFault({ kind: "boundary", boundary: "region", down: false });
    expect(e.snapshot().nodes.worker.status).toBe("paused");
    e.setFault({ kind: "boundary", boundary: "region", down: true });
    e.setFault({ kind: "boundary", boundary: "b", down: true });
    e.setFault({ kind: "boundary", boundary: "region", down: false });
    expect(e.snapshot().nodes.source.status).toBe("up");
    expect(e.snapshot().nodes.worker.status).toBe("down");
    e.setNodeStatus("worker", "up");
    expect(e.snapshot().nodes.worker.status).toBe("down");
    e.setFault({ kind: "boundary", boundary: "b", down: false });
    expect(e.snapshot().nodes.worker.status).toBe("up");
  });

  it.each(["managed", "resources"] as const)(
    "slows %s service work, including latency selected by admission",
    (mode) => {
      const d: DiagramFile = {
        format: "diagrams/v2",
        planning: { revision: "p3-a1" },
        title: "Slow dependency",
        nodes: [
          {
            id: "worker",
            stencil: mode === "managed" ? "generic.external-api" : "service.dotnet",
            label: "Dependency",
            x: 0,
            y: 0,
            props: {
              latencyMs: 0,
              jitter: 0,
              failureRate: 0,
              concurrency: 1,
              replicas: 1,
              ...(mode === "managed"
                ? { api: { latencyMs: 100, errorRate: 0 } }
                : { resources: resourceLesson("cpu-worker") }),
            },
          },
        ],
        edges: [],
      };
      const e = createEngine({ seed: 7 });
      e.load(d);
      e.setFault({ kind: "slow", node: "worker", factor: 5 });
      e.inject("worker", 1);
      e.step(450);
      expect(e.snapshot().nodes.worker.processed).toBe(0);
      e.step(700);
      expect(e.snapshot().nodes.worker.processed).toBe(1);
    },
  );

  it.each([2, 5, 10] as const)(
    "multiplies service time by %s without compounding or overwriting edited props",
    (factor) => {
      const e = make();
      e.setFault({ kind: "slow", node: "worker", factor });
      e.setFault({ kind: "slow", node: "worker", factor });
      e.inject("worker", 1);
      e.step(100 * (factor - 1));
      expect(e.snapshot().nodes.worker.processed).toBe(0);
      e.step(120);
      expect(e.snapshot().nodes.worker.processed).toBe(1);
      e.setNodeProps("worker", { latencyMs: 200 });
      e.setFault({ kind: "slow", node: "worker", factor: 1 });
      e.inject("worker", 1);
      e.step(120);
      expect(e.snapshot().nodes.worker.processed).toBe(1);
      e.step(100);
      expect(e.snapshot().nodes.worker.processed).toBe(2);
      expect(e.effectiveProps("worker").latencyMs).toBe(200);
    },
  );

  it.each([0.1, 0.5] as const)("injects seeded %s failures and reveals the base rate when cleared", (rate) => {
    const play = () => {
      const e = make();
      e.setFault({ kind: "fail", node: "worker", rate });
      e.inject("worker", 1000);
      e.step(3000);
      const before = e.snapshot();
      expect(before.nodes.worker.failed).toBeGreaterThan((1000 * rate) / 2);
      expect(before.nodes.worker.failed).toBeLessThan(1000 * rate * 1.5);
      e.setFault({ kind: "fail", node: "worker", rate: 0 });
      e.inject("worker", 100);
      e.step(1000);
      expect(e.snapshot().nodes.worker.failed).toBe(before.nodes.worker.failed);
      return before;
    };
    expect(play()).toEqual(play());
  });

  it.each(["async", "sync"] as const)(
    "fails a pushed %s over a cut link, including trips already travelling",
    (kind) => {
      const e = make({ ...diagram, edges: [{ ...diagram.edges[0], kind, props: { travelMs: 100 } }] });
      e.inject("source", 2);
      e.setFault({ kind: "link", edge: "ab", cut: true });
      e.step(1000);
      expect(e.snapshot().nodes.worker).toMatchObject({ failed: 2, dropped: 2, processed: 0 });
      e.inject("source", 2);
      e.step(1000);
      expect(e.snapshot().nodes.worker.dropped).toBe(4);
      expect(e.snapshot().inSystem).toBe(0);
      e.setFault({ kind: "link", edge: "ab", cut: false });
      e.inject("source", 1);
      e.step(1000);
      expect(e.snapshot().nodes.worker.processed).toBe(1);
    },
  );

  it.each(["processor", "gateway", "store", "sink"] as const)(
    "a cut pushed request has the same loss/failure accounting as a down %s",
    (role) => {
      const d = structuredClone(diagram);
      d.format = "diagrams/v2";
      d.planning = { revision: "p3" };
      d.nodes[1].stencil = role;
      d.nodes[1].props = { api: { latencyMs: 100, errorRate: 0 } };
      d.edges[0].kind = "sync";
      const play = (cut: boolean) => {
        const e = make(d);
        if (cut) e.setFault({ kind: "link", edge: "ab", cut: true });
        else e.setNodeStatus("worker", "down");
        e.inject("source", 5);
        e.step(1000);
        const n = e.snapshot().nodes.worker;
        return { failed: n.failed, dropped: n.dropped, processed: n.processed };
      };
      expect(play(true)).toEqual(play(false));
    },
  );

  it("keeps broker messages across a cut, including in-flight deliveries, and drains after restoring", () => {
    const d = structuredClone(diagram);
    d.nodes[0].stencil = "queue";
    d.edges[0].props = { travelMs: 100 };
    const e = make(d);
    e.inject("source", 5);
    e.step(10);
    e.setFault({ kind: "link", edge: "ab", cut: true });
    e.step(1000);
    e.inject("source", 5);
    e.step(1000);
    expect(e.snapshot().nodes.source.backlog).toBe(10);
    expect(e.snapshot().nodes.worker).toMatchObject({ processed: 0, dropped: 0, failed: 0 });
    e.setFault({ kind: "link", edge: "ab", cut: false });
    e.step(2000);
    expect(e.snapshot().nodes.worker.processed).toBe(10);
    expect(e.snapshot().inSystem).toBe(0);
  });

  it("offers partitions only on flows crossing distinct boundaries", () => {
    expect(canCutLink(diagram, "ab")).toBe(true);
    expect(canCutLink({ ...diagram, edges: [{ ...diagram.edges[0], relation: "depends" }] }, "ab")).toBe(false);
    const d = structuredClone(diagram);
    d.nodes[1].group = "a";
    expect(canCutLink(d, "ab")).toBe(false);
  });

  it.each<Fault>([
    { kind: "boundary", boundary: "b", down: true },
    { kind: "slow", node: "worker", factor: 5 },
    { kind: "fail", node: "worker", rate: 0.5 },
    { kind: "link", edge: "ab", cut: true },
  ])("checkpoints and restores $kind faults, detached from returned snapshots", (fault) => {
    const e = make();
    e.setFault(fault);
    e.inject("source", 20, { spreadMs: 1000 });
    e.step(150);
    const before = e.snapshot(),
      cp = e.checkpoint();
    const resume = () => {
      e.step(2000);
      return e.snapshot();
    };
    const expected = resume();
    for (let i = 0; i < 2; i++) {
      e.restore(cp);
      expect(e.snapshot()).toEqual(before);
      e.snapshot().faults?.splice(0);
      expect(resume()).toEqual(expected);
    }
  });

  it("replays timeline faults identically through runner checkpoints, restart and backward/forward seeking", () => {
    const simulation: Simulation = {
      id: "drill",
      title: "Drill",
      seed: 7,
      durationMs: 10000,
      traffic: [{ id: "load", node: "source", shape: { kind: "constant", ratePerSec: 20, durationMs: 8000 } }],
      timeline: [
        {
          atMs: 1000,
          action: { do: "fault", fault: { kind: "slow", node: "worker", factor: 5 }, drill: "slow-dependency" },
        },
        {
          atMs: 2000,
          action: { do: "fault", fault: { kind: "fail", node: "worker", rate: 0.5 }, drill: "error-spike" },
        },
        {
          atMs: 3000,
          action: { do: "fault", fault: { kind: "boundary", boundary: "b", down: true }, drill: "zone-outage" },
        },
        {
          atMs: 4000,
          action: { do: "fault", fault: { kind: "link", edge: "ab", cut: true }, drill: "region-connectivity" },
        },
        { atMs: 6000, action: { do: "fault", fault: { kind: "boundary", boundary: "b", down: false } } },
        { atMs: 7000, action: { do: "fault", fault: { kind: "link", edge: "ab", cut: false } } },
      ],
    };
    const r = createSimulationRun(diagram, simulation, { roleOf });
    r.step(4500);
    const cp = r.checkpoint();
    r.step(4500);
    const expected = r.engine.snapshot();
    r.restore(cp);
    r.step(4500);
    expect(r.engine.snapshot()).toEqual(expected);
    r.restart();
    r.step(9000);
    expect(r.engine.snapshot()).toEqual(expected);
    const c = new LiveController(diagram, { roleOf });
    c.selectSimulation(simulation);
    c.seek(9000);
    const sought = c.snapshot();
    c.seek(1000);
    c.seek(9000);
    expect(c.snapshot()).toEqual(sought);
    expect(sought).toEqual(expected);
    c.dispose();
  });

  it("invalidates playback checkpoints when boundary membership changes while positions alone preserve the run", () => {
    const c = new LiveController(diagram, { roleOf });
    c.setFault({ kind: "boundary", boundary: "b", down: true });
    const moved = structuredClone(diagram);
    moved.nodes[1].x++;
    expect(c.updateDiagram(moved)).toBe("none");
    expect(c.snapshot().nodes.worker.status).toBe("down");
    moved.nodes[1].group = "a";
    expect(c.updateDiagram(moved)).toBe("reloaded");
    expect(c.snapshot().nodes.worker.status).toBe("up");
    c.dispose();
  });
});
