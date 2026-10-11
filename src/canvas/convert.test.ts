import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { fromFlow, toFlow } from "./convert";

describe("convert", () => {
  it("round-trips edge sides and saved simulations untouched", () => {
    const simulations = [{ id: "s1", title: "Black Friday" }] as unknown as NonNullable<DiagramFile["simulations"]>;
    const d: DiagramFile = {
      format: "diagrams/v1",
      title: "t",
      direction: "LR",
      nodes: [
        { id: "a", stencil: "kafka.topic", label: "A", x: 0, y: 0 },
        { id: "b", stencil: "service.go", label: "B", x: 360, y: 0 },
      ],
      edges: [{ id: "e", from: "a", to: "b", kind: "async", sourceSide: "bottom", targetSide: "left" }],
      simulations,
    };
    const f = toFlow(d);
    const out = fromFlow(f.meta, f.nodes, f.edges);
    expect(out.edges[0]).toMatchObject({ sourceSide: "bottom", targetSide: "left" });
    expect(out.simulations).toBe(simulations);
    expect(JSON.parse(JSON.stringify(out))).toEqual(JSON.parse(JSON.stringify(d)));
  });

  it("omits simulations when the file has none", () => {
    const f = toFlow({ format: "diagrams/v1", title: "t", nodes: [], edges: [] });
    expect("simulations" in fromFlow(f.meta, f.nodes, f.edges)).toBe(false);
  });
});
