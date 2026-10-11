import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { edgeAriaLabel, fromFlow, nodeAriaLabel, toFlow, withEdgeAria, withNodeAria } from "./convert";
import type { FlowNode } from "./types";

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

describe("accessible names", () => {
  const d: DiagramFile = {
    format: "diagrams/v1",
    title: "t",
    groups: [{ id: "g", label: "AKS", x: 0, y: 0, width: 400, height: 200 }],
    nodes: [
      { id: "a", stencil: "kafka.topic", label: "orders", x: 0, y: 0 },
      { id: "b", stencil: "nope.unknown", label: "Worker", x: 360, y: 0 },
    ],
    edges: [{ id: "e", from: "a", to: "b", kind: "async", label: "OrderPlaced" }],
  };

  it("names nodes, boundaries and edges from what's drawn", () => {
    const f = toFlow(d);
    const byId = new Map(f.nodes.map((n) => [n.id, n]));
    expect(byId.get("a")!.ariaLabel).toMatch(/^orders, Kafka Topic, topic$/);
    expect(byId.get("group:g")!.ariaLabel).toBe("AKS, boundary");
    expect(f.edges[0].ariaLabel).toBe("orders to Worker, message: OrderPlaced");
    expect(nodeAriaLabel({ stencil: "kafka.topic", label: "" })).toMatch(/^Kafka Topic/);
    expect(edgeAriaLabel("A", "B", "sync")).toBe("A to B, request");
  });

  it("keeps names in sync after a rename, with stable identities", () => {
    const f = toFlow(d);
    expect(withNodeAria(f.nodes)).toBe(f.nodes); // nothing to refresh
    const renamed = f.nodes.map((n) =>
      n.id === "a" ? ({ ...n, data: { ...n.data, label: "payments" } } as FlowNode) : n,
    );
    const once = withNodeAria(renamed);
    expect(once.find((n) => n.id === "a")!.ariaLabel).toMatch(/^payments,/);
    expect(withNodeAria(renamed).find((n) => n.id === "a")).toBe(once.find((n) => n.id === "a"));
    const labels = new Map([
      ["a", "payments"],
      ["b", "Worker"],
    ]);
    expect(withEdgeAria(f.edges, (id) => labels.get(id)!)[0].ariaLabel).toBe(
      "payments to Worker, message: OrderPlaced",
    );
  });
});
