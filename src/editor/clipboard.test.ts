import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { CLIP_FORMAT, makePayload, parsePayload, payloadOrigin, remapPayload } from "./clipboard";
import { uniqueId } from "./ids";

const diagram: DiagramFile = {
  format: "diagrams/v1",
  title: "t",
  groups: [{ id: "g", label: "G", x: 0, y: 0, width: 600, height: 300 }],
  nodes: [
    { id: "a", stencil: "kafka.topic", label: "A", x: 40, y: 40, group: "g" },
    { id: "b", stencil: "service.go", label: "B", x: 400, y: 40, group: "g" },
    { id: "c", stencil: "postgres", label: "C", x: 800, y: 40, props: { partitions: 3 } },
  ],
  edges: [
    { id: "e1", from: "a", to: "b", kind: "async" },
    { id: "e2", from: "b", to: "c", kind: "sync" },
  ],
};

describe("clipboard", () => {
  it("keeps only edges between copied nodes", () => {
    const p = makePayload(diagram, ["b", "c"])!;
    expect(p.nodes.map((n) => n.id)).toEqual(["b", "c"]);
    expect(p.edges.map((e) => e.id)).toEqual(["e2"]);
    expect(p.groups).toEqual([]);
  });

  it("copying a group copies its contents", () => {
    const p = makePayload(diagram, [], ["g"])!;
    expect(p.groups.map((g) => g.id)).toEqual(["g"]);
    expect(p.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(p.edges.map((e) => e.id)).toEqual(["e1"]);
  });

  it("returns null for an empty selection", () => {
    expect(makePayload(diagram, [])).toBeNull();
  });

  it("remaps ids, rewires edges and offsets positions", () => {
    const p = makePayload(diagram, ["a", "b"], ["g"])!;
    const r = remapPayload(p, { nodes: new Set(["a", "b", "c"]), edges: new Set(["e1", "e2"]), groups: new Set(["g"]) }, { x: 30, y: 20 });
    expect(r.nodes.map((n) => n.id)).toEqual(["a-1", "b-1"]);
    expect(r.groups[0]).toMatchObject({ id: "g-1", x: 30, y: 20 });
    expect(r.nodes[0]).toMatchObject({ x: 70, y: 60, group: "g-1" });
    expect(r.edges).toEqual([{ id: "e1-1", from: "a-1", to: "b-1", kind: "async" }]);
  });

  it("keeps references to groups outside the payload", () => {
    const p = makePayload(diagram, ["a"])!;
    const r = remapPayload(p, { nodes: new Set(["a"]), edges: new Set(), groups: new Set(["g"]) }, { x: 0, y: 0 });
    expect(r.nodes[0].group).toBe("g");
  });

  it("deep-copies props so pastes don't share objects", () => {
    const p = makePayload(diagram, ["c"])!;
    const r = remapPayload(p, { nodes: new Set(["c"]), edges: new Set(), groups: new Set() }, { x: 0, y: 0 });
    (r.nodes[0].props as Record<string, unknown>).partitions = 99;
    expect(diagram.nodes[2].props).toEqual({ partitions: 3 });
  });

  it("parses its own JSON and whole diagram files, rejects junk", () => {
    const p = makePayload(diagram, ["a", "b"])!;
    expect(parsePayload(JSON.stringify(p))).toEqual(p);
    const file = parsePayload(JSON.stringify(diagram))!;
    expect(file.format).toBe(CLIP_FORMAT);
    expect(file.nodes).toHaveLength(3);
    expect(parsePayload("hello")).toBeNull();
    expect(parsePayload(JSON.stringify({ format: "other", nodes: [] }))).toBeNull();
    // Dangling edges are dropped rather than pasted.
    const dangling = parsePayload(JSON.stringify({ ...p, edges: [{ id: "x", from: "a", to: "ghost" }] }))!;
    expect(dangling.edges).toEqual([]);
  });

  it("finds the payload origin", () => {
    expect(payloadOrigin(makePayload(diagram, ["b", "c"])!)).toEqual({ x: 400, y: 40 });
  });

  it("uniqueId strips numeric suffixes", () => {
    expect(uniqueId("orders-2", new Set(["orders-1"]))).toBe("orders-2");
    expect(uniqueId("orders", new Set(["orders-1", "orders-2"]))).toBe("orders-3");
  });
});
