import { expect, it, vi } from "vitest";
import { messageTypesFixture } from "../../lab/messageTypesFixture";
import type { DiagramFlowNode } from "../types";
import { fromFlow, toFlow } from "../convert";
import { carriedTypes } from "./carriedTypes";
import { cachedMessageTypesAt } from "../../model/messageTypeCache";
import * as propagation from "../../model/messageTypes";
import { countingReads } from "../../test/complexity";

it("does not recompute propagation on position, selection or measurement updates", () => {
  const d = messageTypesFixture();
  d.nodes[0].props = { messageType: "CacheTest" };
  const flow = toFlow(d);
  const nodes = flow.nodes.filter((node): node is DiagramFlowNode => node.type === "diagram");
  const spy = vi.spyOn(propagation, "messageTypesAt");
  try {
    const first = carriedTypes(nodes, flow.edges);
    const moved = nodes.map((node) => ({
      ...node,
      position: { x: 123, y: 456 },
      selected: true,
      measured: { width: 150, height: 80 },
    }));
    expect(
      carriedTypes(
        moved,
        flow.edges.map((edge) => ({ ...edge, selected: true })),
      ),
    ).toBe(first);
    expect(
      cachedMessageTypesAt({ ...d, nodes: d.nodes.map((node) => ({ ...node, x: 123, y: 456 })) }).carried.get("send"),
    ).toContain("CacheTest");
    expect(spy).toHaveBeenCalledTimes(1);
    const edited = flow.edges.map((edge) =>
      edge.id === "send" ? { ...edge, data: { ...edge.data!, props: { filter: ["CacheTest"] } } } : edge,
    );
    expect(carriedTypes(moved, edited).get("send")).toBe("CacheTest");
    expect(spy).toHaveBeenCalledTimes(2);
  } finally {
    spy.mockRestore();
  }
});

it("answers pan, zoom and drag store updates without serializing or re-reading the graph", () => {
  const d = messageTypesFixture();
  for (let i = 0; i < 2_000; i++) {
    d.nodes.push({ id: `n${i}`, stencil: "service.go", label: `N${i}`, x: i, y: 0, props: { emits: "X".repeat(300) } });
    d.edges.push({ id: `e${i}`, from: i ? `n${i - 1}` : "sender", to: `n${i}`, props: { filter: ["*"] } });
  }
  d.simulations = [{ id: "s", title: "S", traffic: [{ id: "t", node: "client", shape: { kind: "burst", count: 1 } }] }];
  const flow = toFlow(d);
  const nodes = countingReads(flow.nodes);
  const edges = countingReads(flow.edges);
  const metadata = () => ({ simulations: flow.meta.simulations, planning: flow.meta.planning });
  const first = carriedTypes(nodes.items, edges.items, metadata());
  const stringify = vi.spyOn(JSON, "stringify");
  const analysis = vi.spyOn(propagation, "messageTypesAt");
  try {
    const read = nodes.reads() + edges.reads();
    // A transform-only update hands every edge the same arrays (and a fresh context object).
    for (let i = 0; i < 1_000; i++) expect(carriedTypes(nodes.items, edges.items, metadata())).toBe(first);
    expect(nodes.reads() + edges.reads()).toBe(read);
    // A drag replaces node objects, never their data; the edge array is untouched.
    const edgeReads = edges.reads();
    const dragged = flow.nodes.map((node) => ({ ...node, position: { x: node.position.x + 5, y: 9 }, dragging: true }));
    expect(carriedTypes(dragged, edges.items, metadata())).toBe(first);
    expect(edges.reads()).toBe(edgeReads);
    // The inspector reads the dragged canvas through fromFlow: same propagation, nothing serialized.
    expect(cachedMessageTypesAt(fromFlow(flow.meta, dragged, flow.edges)).carried.get("send")).toEqual(
      new Set(["Send", "Callback"]),
    );
    expect(stringify).not.toHaveBeenCalled();
    expect(analysis).not.toHaveBeenCalled();
  } finally {
    stringify.mockRestore();
    analysis.mockRestore();
  }
});
