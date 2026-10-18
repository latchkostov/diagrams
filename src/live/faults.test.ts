import { describe, expect, it, vi } from "vitest";
import { faultDrillFixture } from "../lab/faultDrillFixture";
import { faultProblem, faultTarget, type Fault } from "../model/faults";
import { validateDiagram } from "../interop/native";
import { defaultFault, drillFault, faultTargets } from "./faults";
import { liveDiagramReader } from "./diagramReader";
import { LiveController } from "./controller";
import { createSimulationRun } from "../sim/simulation";

it.each(["nginx", "postgres"] as const)(
  "targets a %s dependency before a client when there is no processor",
  (stencil) => {
    const diagram = faultDrillFixture();
    diagram.nodes.find((node) => node.id === "worker")!.stencil = stencil;
    expect.soft(drillFault("slow-dependency", diagram)).toEqual({ kind: "slow", node: "worker", factor: 5 });
    expect(drillFault("error-spike", diagram)).toEqual({ kind: "fail", node: "worker", rate: 0.5 });
  },
);

it.each(["slow", "fail"] as const)("still prefers the processor for a %s fault", (kind) => {
  const diagram = faultDrillFixture();
  diagram.nodes.unshift({ id: "entry", stencil: "nginx", label: "Entry", x: 0, y: 0 });
  expect(defaultFault(kind, diagram)).toMatchObject({ node: "worker" });
});

describe("fault targets", () => {
  it("keeps Live usable when a topology edit removes a running fault's eligible target", () => {
    const d = faultDrillFixture();
    const c = new LiveController(d);
    const sim = {
      ...d.simulations![0],
      timeline: [
        { atMs: 100, action: { do: "fault" as const, fault: { kind: "link" as const, edge: "request", cut: true } } },
      ],
    };
    expect(c.selectSimulation(sim)).toBe(true);
    const next = structuredClone(d);
    next.nodes.forEach((n) => {
      n.group = "zone-a";
    });
    expect(c.updateDiagram(next)).toBe("reloaded");
    expect(c.getState().resourceError).toContain("available fault target");
    c.setPlaying(true);
    c.advance(1000);
    expect(c.snapshot().time).toBeGreaterThan(0);
    c.dispose();
  });
  it("indexes links linearly and reuses target lists across live updates and draft keystrokes", () => {
    const d = faultDrillFixture();
    let reads = 0;
    d.nodes = Array.from({ length: 1000 }, (_, i) => ({
      ...d.nodes[0],
      id: `n${i}`,
      label: `Node ${i}`,
      group: i % 2 ? "zone-a" : "zone-b",
    }));
    d.edges = Array.from({ length: 4000 }, (_, i) => ({
      get id() {
        reads++;
        return `e${i}`;
      },
      from: `n${i % 1000}`,
      to: `n${(i + 1) % 1000}`,
    }));
    const targets = faultTargets(d, "link");
    expect(targets).toHaveLength(4000);
    expect(targets[0].label).toBe("Node 0 → Node 1");
    expect(reads).toBeLessThanOrEqual(d.edges.length * 3);
    const first = reads;
    for (let i = 0; i < 50; i++) expect(faultTargets(d, "link")).toBe(targets);
    expect(reads).toBe(first);
    const changed = { ...d, nodes: d.nodes.map((n) => ({ ...n, group: "zone-a" })) };
    expect(faultTargets(changed, "link")).toEqual([]);
  });

  it("keeps a stable diagram until the editor's document version changes", () => {
    let version = { identity: {}, revision: 0 };
    const getDiagram = vi.fn(faultDrillFixture);
    const read = liveDiagramReader({ getDiagram, getDocumentVersion: () => version });
    const first = read();
    for (let i = 0; i < 50; i++) expect(read()).toBe(first);
    expect(getDiagram).toHaveBeenCalledTimes(1);
    version = { ...version, revision: 1 };
    expect(read()).not.toBe(first);
    expect(getDiagram).toHaveBeenCalledTimes(2);
  });

  it.each(["unrelated", { unexpected: true }])("uses the kind with extra imported target fields (%j)", (boundary) => {
    const fault = { kind: "slow", node: "worker", factor: 5, boundary } as Fault;
    expect(faultTarget(fault)).toBe("worker");
    expect(faultProblem(fault)).toBe("unexpected fault property");
    const d = faultDrillFixture();
    d.simulations![0].timeline = [{ atMs: 0, action: { do: "fault", fault } }];
    const result = validateDiagram(d);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.diagram.simulations).toBeUndefined();
      expect(result.warnings.join(" ")).toContain("unexpected fault property");
    }
  });

  it.each([undefined, "p1", "p2", "p3", "p3-a1"] as const)(
    "refuses invalid immediate and scheduled faults on %s without disturbing playback",
    (revision) => {
      const d = faultDrillFixture();
      if (revision) {
        d.format = "diagrams/v2";
        d.planning = { revision };
      }
      const c = new LiveController(d);
      c.setPlaying(true);
      for (const atMs of [0, 500]) {
        const sim = {
          ...d.simulations![0],
          timeline: [
            { atMs, action: { do: "fault" as const, fault: { kind: "boundary" as const, boundary: "", down: true } } },
          ],
        };
        expect(c.selectSimulation(sim)).toBe(false);
        expect(c.getState().resourceError).toContain("target id");
        expect(() => createSimulationRun(d, sim)).toThrow("target id");
        const before = c.snapshot().time;
        c.advance(100);
        expect(c.snapshot().time).toBeGreaterThan(before);
      }
      c.dispose();
    },
  );
});
