import { expect, it, vi } from "vitest";
import { messageTypesFixture } from "../../lab/messageTypesFixture";
import type { DiagramFlowNode } from "../types";
import { toFlow } from "../convert";
import { carriedTypes } from "./carriedTypes";
import { cachedMessageTypesAt, routingContentKey } from "../../model/messageTypeCache";
import * as propagation from "../../model/messageTypes";

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

it("bounds long type strings in routing keys without colliding when a name changes", () => {
  const d = messageTypesFixture();
  const prefix = "A".repeat(20_000);
  d.nodes[0].props = { messageType: prefix + "1", emits: { [prefix]: prefix } };
  const first = routingContentKey(d);
  expect(first.length).toBeLessThan(prefix.length / 8);
  d.nodes[0].props.messageType = prefix + "2";
  expect(routingContentKey(d)).not.toBe(first);
});
