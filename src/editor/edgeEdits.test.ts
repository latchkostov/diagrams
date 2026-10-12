import { describe, expect, it } from "vitest";
import type { DiagramFlowEdge } from "../canvas/types";
import { reconnectEdge, splitEdge } from "./edgeEdits";

const edge = (id: string, source: string, target: string, data: DiagramFlowEdge["data"] = { kind: "async" }) =>
  ({ id, source, target, type: "flow", data }) as DiagramFlowEdge;

describe("splitEdge", () => {
  const rich = edge("orders-to-topic", "orders", "topic", {
    kind: "sync",
    relation: "config",
    label: "OrderPlaced",
    sourceSide: "right",
    targetSide: "left",
    props: { settings: ["a"], dlq: true },
  });

  it("makes A→N keep the edge's id, label, kind, relationship and settings, and N→B copy the meaning", () => {
    const r = splitEdge([rich], "orders-to-topic", "cache")!;
    expect(r.first).toBe("orders-to-topic");
    expect(r.second).toBe("e-1");
    const [a, b] = r.edges;
    expect(a).toMatchObject({ id: "orders-to-topic", source: "orders", target: "cache" });
    expect(a.data).toEqual({
      kind: "sync",
      relation: "config",
      label: "OrderPlaced",
      sourceSide: "right",
      props: { settings: ["a"], dlq: true },
    });
    expect(b).toMatchObject({ id: "e-1", source: "cache", target: "topic", type: "flow" });
    expect(b.data).toEqual({
      kind: "sync",
      relation: "config",
      targetSide: "left",
      props: { settings: ["a"], dlq: true },
    });
  });

  it("gives each half its own copy of the settings", () => {
    const r = splitEdge([rich], "orders-to-topic", "cache")!;
    expect(r.edges[0].data!.props).not.toBe(r.edges[1].data!.props);
    expect(r.edges[0].data!.props).not.toBe(rich.data!.props);
  });

  it("keeps the order of the other edges, the halves where the edge was", () => {
    const es = [edge("x", "p", "q"), rich, edge("y", "q", "r")];
    expect(splitEdge(es, "orders-to-topic", "cache")!.edges.map((e) => e.id)).toEqual([
      "x",
      "orders-to-topic",
      "e-1",
      "y",
    ]);
  });

  it("picks an id no other edge has", () => {
    const es = [edge("e-1", "p", "q"), edge("e-2", "q", "r"), rich];
    expect(splitEdge(es, "orders-to-topic", "cache")!.second).toBe("e-3");
  });

  it("refuses a missing edge, or a node that's already one of its ends", () => {
    expect(splitEdge([rich], "nope", "cache")).toBeNull();
    expect(splitEdge([rich], "orders-to-topic", "orders")).toBeNull();
    expect(splitEdge([rich], "orders-to-topic", "topic")).toBeNull();
  });

  it("a plain flow stays plain: no empty label or sides appear", () => {
    const r = splitEdge([edge("e", "a", "b")], "e", "n")!;
    expect(r.edges[0].data).toEqual({ kind: "async" });
    expect(r.edges[1].data).toEqual({ kind: "async" });
  });
});

describe("reconnectEdge", () => {
  const e = edge("e", "a", "b", {
    kind: "sync",
    label: "GET",
    relation: "secret",
    sourceSide: "top",
    targetSide: "left",
  });

  it("moves the target end, keeping the id, label, relationship and the source's pinned side", () => {
    const [next] = reconnectEdge([e], "e", "target", "c")!;
    expect(next).toMatchObject({ id: "e", source: "a", target: "c" });
    expect(next.data).toEqual({ kind: "sync", label: "GET", relation: "secret", sourceSide: "top" });
  });

  it("moves the source end and drops the side pinned on the old source", () => {
    const [next] = reconnectEdge([e], "e", "source", "c")!;
    expect(next).toMatchObject({ source: "c", target: "b" });
    expect(next.data).toEqual({ kind: "sync", label: "GET", relation: "secret", targetSide: "left" });
  });

  it("does nothing for the same node, a loop onto the other end, or a missing edge", () => {
    expect(reconnectEdge([e], "e", "target", "b")).toBeNull();
    expect(reconnectEdge([e], "e", "target", "a")).toBeNull();
    expect(reconnectEdge([e], "nope", "target", "c")).toBeNull();
  });
});
