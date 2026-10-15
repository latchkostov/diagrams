import { describe, expect, it } from "vitest";
import {
  backEdgeDiagram,
  cycleDiagram,
  diagramProblems,
  edgeKindsDiagram,
  edgeSidesDiagram,
  fanEdgesDiagram,
  fanOutDiagram,
  groupsDiagram,
  oddNodesDiagram,
  prng,
  stressDiagram,
} from "./generators";
import { parseDiagram } from "../lib/diagramIO";
import { getStencil, FALLBACK_STENCIL } from "../stencils/registry";
import type { DiagramFile } from "../model/types";

function expectValid(d: DiagramFile) {
  expect(diagramProblems(d)).toEqual([]);
  // The app's own import validator accepts it too (round-trip through JSON).
  const parsed = parseDiagram(JSON.stringify(d));
  expect(parsed.ok, parsed.ok ? "" : parsed.error).toBe(true);
}

describe("stressDiagram", () => {
  for (const n of [1, 10, 50, 150, 300]) {
    it(`generates exactly ${n} nodes with valid, unique ids`, () => {
      const d = stressDiagram({ nodes: n });
      expect(d.nodes).toHaveLength(n);
      expectValid(d);
      for (const node of d.nodes) expect(getStencil(node.stencil)).not.toBe(FALLBACK_STENCIL);
    });
  }

  it("connects every node after the first column", () => {
    const d = stressDiagram({ nodes: 150 });
    const targets = new Set(d.edges.map((e) => e.to));
    const firstColX = Math.min(...d.nodes.map((n) => n.x));
    for (const n of d.nodes) if (n.x !== firstColX) expect(targets.has(n.id), n.id).toBe(true);
  });

  it("is deterministic per seed and varies across seeds", () => {
    expect(stressDiagram({ nodes: 50, seed: 3 })).toEqual(stressDiagram({ nodes: 50, seed: 3 }));
    expect(stressDiagram({ nodes: 50, seed: 3 })).not.toEqual(stressDiagram({ nodes: 50, seed: 4 }));
  });

  it("wraps columns in groups that contain their nodes", () => {
    const d = stressDiagram({ nodes: 40, groups: true });
    expectValid(d);
    expect(d.groups?.length).toBeGreaterThan(1);
    for (const n of d.nodes) {
      const g = d.groups!.find((g) => g.id === n.group)!;
      expect(n.x).toBeGreaterThanOrEqual(g.x);
      expect(n.y).toBeGreaterThanOrEqual(g.y);
      expect(n.x + 220).toBeLessThanOrEqual(g.x + g.width);
      expect(n.y + 72).toBeLessThanOrEqual(g.y + g.height);
    }
  });

  it("supports top-to-bottom layout", () => {
    const d = stressDiagram({ nodes: 20, direction: "TB" });
    expect(d.direction).toBe("TB");
    expectValid(d);
  });
});

describe("other generators", () => {
  it("fanOutDiagram builds a tree (n - 1 edges) and respects the cap", () => {
    const d = fanOutDiagram(3, 3);
    expectValid(d);
    expect(d.edges).toHaveLength(d.nodes.length - 1);
    expect(d.nodes).toHaveLength(53);
    expect(fanOutDiagram(6, 6, 120).nodes.length).toBeLessThanOrEqual(120);
  });

  it("cycleDiagram closes the loop", () => {
    const d = cycleDiagram(7);
    expectValid(d);
    expect(d.edges).toHaveLength(7);
    expect(d.edges.at(-1)).toMatchObject({ from: "c7", to: "c1" });
  });

  it("edgeSidesDiagram covers all 16 side combinations", () => {
    const d = edgeSidesDiagram();
    expectValid(d);
    const combos = new Set(d.edges.map((e) => `${e.sourceSide}-${e.targetSide}`));
    expect(combos.size).toBe(16);
  });

  it("edge, node and group showcases are valid", () => {
    for (const d of [
      edgeKindsDiagram(),
      backEdgeDiagram(),
      backEdgeDiagram(false),
      fanEdgesDiagram(5),
      oddNodesDiagram(),
      groupsDiagram(),
    ])
      expectValid(d);
    expect(edgeKindsDiagram().edges.map((e) => e.kind ?? "async")).toContain("sync");
    expect(backEdgeDiagram().edges.some((e) => e.from === e.to)).toBe(true);
    expect(oddNodesDiagram().nodes.some((n) => getStencil(n.stencil) === FALLBACK_STENCIL)).toBe(true);
  });

  it("prng is deterministic and in [0, 1)", () => {
    const a = prng(9);
    const b = prng(9);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("diagramProblems", () => {
  it("accepts the current planning file format", () => {
    expect(
      diagramProblems({ format: "diagrams/v2", planning: { revision: "p3" }, title: "Planning", nodes: [], edges: [] }),
    ).toEqual([]);
  });
  it("reports duplicates and dangling references", () => {
    const d: DiagramFile = {
      format: "diagrams/v1",
      title: "bad",
      nodes: [
        { id: "a", stencil: "x", label: "", x: 0, y: 0, group: "nope" },
        { id: "a", stencil: "x", label: "", x: 0, y: 0 },
      ],
      edges: [
        { id: "e", from: "a", to: "ghost" },
        { id: "e", from: "ghost", to: "a" },
      ],
    };
    const p = diagramProblems(d);
    expect(p).toContain("duplicate node id a");
    expect(p).toContain("duplicate edge id e");
    expect(p).toContain("edge e ends at missing node ghost");
    expect(p).toContain("node a is in missing group nope");
  });
});
