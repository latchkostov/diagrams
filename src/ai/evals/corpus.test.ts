import { describe, expect, it } from "vitest";
import { applyOps } from "../index";
import { validateDiagram } from "../../interop/native";
import type { DiagramFile } from "../../model/types";
import { diagramEvals } from "./corpus";
import { checkGraph } from "./graphCheck";

describe("semantic graph eval corpus", () => {
  it.each(diagramEvals)("$description", ({ turns }) => {
    let diagram: DiagramFile = { format: "diagrams/v1", title: "Eval", nodes: [], edges: [] };
    for (const turn of turns) {
      const result = applyOps(diagram, turn.ops);
      expect(result.errors).toEqual([]);
      expect(result.ok).toBe(true);
      diagram = result.diagram;
      expect(diagram.nodes.map(({ label, stencil }) => ({ label, stencil }))).toEqual(turn.expected.nodes);
      const labels = new Map(diagram.nodes.map((n) => [n.id, n.label]));
      expect(diagram.edges.map((e) => [labels.get(e.from), labels.get(e.to)])).toEqual(turn.expected.edges);
      // The same semantic check the on-device evals use, with exact labels.
      expect(checkGraph(diagram, turn.expected, { labels: "exact" })).toBeNull();
      expect(validateDiagram(diagram).ok).toBe(true);
    }
  });
});
