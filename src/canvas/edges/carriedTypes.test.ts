import { expect, it, vi } from "vitest";
import { messageTypesFixture } from "../../lab/messageTypesFixture";
import type { DiagramFlowNode } from "../types";
import { fromFlow, toFlow } from "../convert";
import { TIP_CHARS, carriedText, carriedTypes, messageTip } from "./carriedTypes";
import { cachedMessageTypesAt } from "../../model/messageTypeCache";
import * as propagation from "../../model/messageTypes";
import { messageTypesAt } from "../../model/messageTypes";
import type { DiagramFile } from "../../model/types";
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
    expect(carriedTypes(moved, edited).carried.get("send")).toEqual(new Set(["CacheTest"]));
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

it("formats only the requested edge's types, within a display budget", () => {
  const long = (c: string) => c.repeat(100_000);
  const d = messageTypesFixture();
  d.nodes[0].props = { messageType: long("A") };
  d.nodes.push({ ...d.nodes[0], id: "second", props: { messageType: long("B") } });
  d.edges.push({ id: "second-in", from: "second", to: "api" });
  for (let i = 0; i < 1_000; i++) {
    d.nodes.push({ id: `n${i}`, stencil: "service.go", label: `N${i}`, x: 0, y: 0 });
    d.edges.push({ id: `e${i}`, from: "sender", to: `n${i}` });
  }
  const flow = toFlow(d);
  const types = carriedTypes(flow.nodes, flow.edges);
  expect(types.carried.get("e999")).toEqual(new Set([long("A"), long("B"), "Callback"]));
  // Full names stay in the analysis; one tooltip shows at most TIP_CHARS of them and counts the rest.
  const join = vi.spyOn(Array.prototype, "join");
  let text: string;
  try {
    text = messageTip(flow.nodes, flow.edges, undefined, "e999");
  } finally {
    join.mockRestore();
  }
  expect(text.length).toBeLessThan(TIP_CHARS + 60);
  expect(text).toContain("…");
  expect(text).toContain("+2 more");
  // Only this edge was formatted: every join stayed within the display budget.
  for (const result of join.mock.results) expect(String(result.value).length).toBeLessThan(TIP_CHARS * 2);
  expect(carriedText(types, "send")).toBe(carriedText(types, "send"));
  expect(carriedText(types, "in")).toBe(`${long("A").slice(0, TIP_CHARS - 1)}…`);
});

it("recomputes after a subtitle edit that changes the effective dead-letter route", () => {
  const d: DiagramFile = {
    format: "diagrams/v1",
    title: "Dead letters",
    nodes: [
      { id: "client", stencil: "client.browser", label: "Client", x: 0, y: 0, props: { messageType: "Order" } },
      { id: "queue", stencil: "generic.queue", label: "Orders", x: 0, y: 0 },
      { id: "first", stencil: "generic.queue", label: "First", x: 0, y: 0 },
      { id: "second", stencil: "generic.queue", label: "Second", x: 0, y: 0 },
    ],
    edges: [
      { id: "in", from: "client", to: "queue" },
      { id: "to-first", from: "queue", to: "first" },
      { id: "to-second", from: "queue", to: "second" },
    ],
  };
  const fresh = (diagram: DiagramFile) => messageTypesAt(diagram).carried.get("to-second");
  const flow = toFlow(d);
  expect(carriedTypes(flow.nodes, flow.edges).carried.get("to-second")).toEqual(fresh(d));
  expect(cachedMessageTypesAt(d).carried.get("to-second")).toEqual(fresh(d));
  // Both targets become dead-letter queues by subtitle; only the first is the queue's effective route.
  const edited: DiagramFile = {
    ...d,
    nodes: d.nodes.map((n) => (n.id === "first" || n.id === "second" ? { ...n, sublabel: "dead letter" } : n)),
  };
  const editedFlow = toFlow(edited);
  expect(fresh(edited)).not.toEqual(fresh(d));
  expect(carriedTypes(editedFlow.nodes, editedFlow.edges).carried.get("to-second")).toEqual(fresh(edited));
  expect(cachedMessageTypesAt(edited).carried.get("to-second")).toEqual(fresh(edited));
});
