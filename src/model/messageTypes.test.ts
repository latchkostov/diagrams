import { messageTypesFixture } from "../lab/messageTypesFixture";
import { describe, expect, it } from "vitest";
import type { DiagramFile, DiagramNode } from "./types";
import { MESSAGE_TYPE_WORK_LIMIT, messageTypesAt } from "./messageTypes";
import { countingReads, GROWTH_FACTOR, LINEAR_LIMIT } from "../test/complexity";

const node = (id: string, stencil = "generic.service", props?: DiagramNode["props"]): DiagramNode => ({
  id,
  stencil,
  label: id,
  x: 0,
  y: 0,
  props,
});
const typedCallback = messageTypesFixture;

describe("messageTypesAt", () => {
  it("does linear indexed work rather than rescanning the diagram per hop", () => {
    const reads = (count: number) => {
      const nodes = countingReads([
        node("source", "client.browser", { messageType: "T" }),
        ...Array.from({ length: count }, (_, i) => node(String(i))),
      ]);
      const edges = countingReads([
        { id: "in", from: "source", to: "0" },
        ...Array.from({ length: count - 1 }, (_, i) => ({ id: String(i), from: String(i), to: String(i + 1) })),
      ]);
      expect(
        messageTypesAt({ format: "diagrams/v1", title: "Linear", nodes: nodes.items, edges: edges.items }).arriving.get(
          String(count - 1),
        ),
      ).toEqual(new Set(["T"]));
      return nodes.reads() + edges.reads();
    };
    expect(reads(128 * GROWTH_FACTOR) / reads(128)).toBeLessThan(LINEAR_LIMIT);
  });

  it("supports shared static propagation for explicit simulation inputs at a processor", () => {
    const d = typedCallback();
    const result = messageTypesAt(d, [{ node: "api", type: "Injected" }]);
    expect(result.arriving.get("api")).toContain("Injected");
    expect(result.carried.get("send")).toContain("Injected");
    expect(result.carried.get("in")?.size).toBe(0);
  });
  it("propagates source types, emits maps, edge renames and filters in simulation order", () => {
    const d = typedCallback();
    d.nodes[1].props = { emits: { Send: "Dispatch", "*": "Ignored" } };
    d.edges[1].props = { filter: ["Dis*"], emits: "Delivery" };
    d.edges[2].props = { filter: ["Delivery"], emits: "Receipt" };
    const types = messageTypesAt(d);
    expect([...types.arriving.get("api")!]).toEqual(["Send", "Receipt"]);
    expect([...types.upstream.get("send")!]).toEqual(["Dispatch", "Ignored"]);
    expect([...types.carried.get("send")!]).toEqual(["Delivery"]);
    expect(types.loops).toEqual([]);
    expect(types.complete).toBe(true);
  });

  it("reaches a fixed point on a callback loop, including a changed type", () => {
    const result = messageTypesAt(typedCallback());
    expect([...result.carried.get("send")!]).toEqual(["Send", "Callback"]);
    expect(result.loops).toHaveLength(1);
    expect(result.loops[0].type).toBe("Callback");
    expect(result.loops[0].steps.map((s) => s.edge).sort()).toEqual(["callback", "send"]);
  });

  it("does not seed types from unknown filters, emits or unreachable processors", () => {
    const d = typedCallback();
    d.edges[1].props = { filter: ["NeverSent"], emits: "NeverEmitted" };
    const result = messageTypesAt(d);
    expect([...result.carried.get("send")!]).toEqual([]);
    expect([...result.arriving.get("sender")!]).toEqual([]);
    expect(result.known).toEqual(new Set(["Send", "NeverSent", "NeverEmitted", "Callback"]));
    expect(result.loops).toEqual([]);
  });

  it("none selected means all when the filter is absent; an authored empty filter still blocks all", () => {
    const d = typedCallback();
    d.edges[1].props = { filter: [] };
    expect(messageTypesAt(d).carried.get("send")?.size).toBe(0);
    d.edges[1].props = { filter: undefined };
    expect(messageTypesAt(d).carried.get("send")?.size).toBe(2);
  });

  it.each(["generic.queue", "generic.topic", "redis.stream"])("excludes %s redelivery cycles", (stencil) => {
    const d = typedCallback();
    d.nodes[2].stencil = stencil;
    expect(messageTypesAt(d).loops).toEqual([]);
  });

  it("ignores dependencies, denied and zero-share routes and stops at terminal receivers", () => {
    for (const patch of [{ relation: "depends" as const }, { props: { deny: true } }, { props: { share: 0 } }]) {
      const d = typedCallback();
      Object.assign(d.edges[1], patch);
      expect(messageTypesAt(d).carried.get("send")?.size).toBe(0);
    }
    const d = typedCallback();
    d.nodes[2].stencil = "generic.email";
    expect(messageTypesAt(d).carried.get("callback")?.size).toBe(0);
  });

  it("uses label defaults and own-property-safe emits mappings", () => {
    const d = typedCallback();
    d.nodes[0].props = undefined;
    d.nodes[1].props = { emits: { "*": "constructor" } };
    d.edges[2].props = undefined;
    const result = messageTypesAt(d);
    expect(result.known.has("Client")).toBe(true);
    expect([...result.carried.get("send")!]).toEqual(["constructor"]);
  });

  it("visits each edge once per type on a long cycle without a recursive stack", () => {
    const count = 10_000;
    const d: DiagramFile = {
      format: "diagrams/v1",
      title: "Long",
      nodes: [
        node("source", "client.browser", { messageType: "T" }),
        ...Array.from({ length: count }, (_, i) => node(String(i))),
      ],
      edges: [
        { id: "in", from: "source", to: "0" },
        ...Array.from({ length: count }, (_, i) => ({ id: String(i), from: String(i), to: String((i + 1) % count) })),
      ],
    };
    const result = messageTypesAt(d);
    expect(result.complete).toBe(true);
    expect(result.loops).toHaveLength(1);
    expect(result.loops[0].steps).toHaveLength(count);
  });

  it("bounds work on a vocabulary amplified across a dense graph", () => {
    const count = Math.ceil(Math.sqrt(MESSAGE_TYPE_WORK_LIMIT)) + 1;
    const d: DiagramFile = {
      format: "diagrams/v1",
      title: "Bounded",
      nodes: [
        node("hub"),
        ...Array.from({ length: count }, (_, i) => node(String(i), "client.browser", { messageType: String(i) })),
      ],
      edges: Array.from({ length: count }, (_, i) => ({ id: String(i), from: String(i), to: "hub" })),
    };
    d.edges.push(...Array.from({ length: count }, (_, i) => ({ id: `out-${i}`, from: "hub", to: "hub" })));
    expect(messageTypesAt(d).complete).toBe(false);
  });
});
