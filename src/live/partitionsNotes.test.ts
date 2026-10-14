import { describe, expect, it, vi } from "vitest";
import { DIAGRAM_FORMAT, type DiagramFile } from "../model/types";
import { emptyInputs, partitionsNotes } from "./capacityModel";
import { compileTopology } from "../sim/topology";
import * as defaults from "../sim/defaults";

vi.mock("../sim/topology", async (original) => {
  const actual = await original<typeof import("../sim/topology")>();
  return { ...actual, compileTopology: vi.fn(actual.compileTopology) };
});

// The Inputs panel's notes under Partitions: one topology for every row, so "Double partitions" with "Show all" on a
// diagram of hundreds of topics stays linear (it compiled the whole diagram once per row).

function topics(n: number): DiagramFile {
  const d: DiagramFile = { format: DIAGRAM_FORMAT, title: "Many topics", nodes: [], edges: [] };
  for (let i = 0; i < n; i++) {
    d.nodes.push({ id: `t${i}`, stencil: "kafka.topic", label: `Topic ${i}`, x: 0, y: i * 100 });
    if (i % 2) {
      d.nodes.push({ id: `w${i}`, stencil: "service.go", label: `Worker ${i}`, x: 300, y: i * 100 });
      d.edges.push({ id: `e${i}`, from: `t${i}`, to: `w${i}` });
    }
  }
  return d;
}

describe("partitionsNotes", () => {
  it("resolves settings only for partitioned brokers, not services or subscription brokers", () => {
    const d = topics(0);
    d.planning = { revision: "p2" };
    d.nodes = Array.from({ length: 256 }, (_, i) => ({
      id: `n${i}`,
      stencil: i % 2 ? "service.go" : "aws.sns",
      label: "Node",
      x: 0,
      y: 0,
    }));
    const reads = vi.spyOn(defaults, "resolveNodeProps");
    try {
      expect(partitionsNotes(d, null, emptyInputs()).size).toBe(0);
      expect(reads).toHaveBeenCalledTimes(0);
      d.nodes.push({ id: "log", stencil: "kafka.topic", label: "Log", x: 0, y: 0 });
      expect(partitionsNotes(d, null, emptyInputs()).size).toBe(0);
      expect(reads.mock.calls.length).toBeLessThanOrEqual(2);
      expect(reads.mock.calls.every(([, node]) => node.id === "log")).toBe(true);
    } finally {
      reads.mockRestore();
    }
  });

  it("compiles the topology once for every raised topic, and not at all when none is raised", () => {
    const d = topics(200);
    const compile = vi.mocked(compileTopology);
    compile.mockClear();
    expect(partitionsNotes(d, null, emptyInputs()).size).toBe(0);
    expect(compile).not.toHaveBeenCalled();
    const props = Object.fromEntries(d.nodes.filter((n) => n.id.startsWith("t")).map((n) => [n.id, { partitions: 6 }]));
    const notes = partitionsNotes(d, null, { ...emptyInputs(), props });
    expect(compile).toHaveBeenCalledTimes(1);
    expect(notes.get("t0")).toBe("Nobody reads it yet, so more partitions change nothing.");
    expect(notes.get("t1")).toBe("Its consumer group has 1 replica: partitions past 1 add no speed.");
    expect(notes.size).toBe(200);
  });
});
