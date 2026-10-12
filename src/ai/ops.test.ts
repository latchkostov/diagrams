import { describe, expect, it } from "vitest";
import { applyOps } from "./ops";
import type { DiagramFile } from "../model/types";
import type { DiagramOp } from "./index";
import { LIMITS, validateDiagram } from "../interop/native";
import { overlaps } from "../canvas/placement";
import { estimateCardSize } from "../canvas/nodes/size";

const empty = (): DiagramFile => ({ format: "diagrams/v1", title: "Test", nodes: [], edges: [] });
const graph = () =>
  applyOps(empty(), [
    { op: "add_node", kind: ".NET", label: "API", key: "api" },
    { op: "add_node", kind: "pg", label: "DB", key: "db" },
    { op: "connect", from: "api", to: "db", key: "write", kind: "sync" },
  ]).diagram;
const run = (d: DiagramFile, ops: DiagramOp[]) => {
  const result = applyOps(d, ops);
  expect(result.errors).toEqual([]);
  expect(result.ok).toBe(true);
  expect(validateDiagram(result.diagram).ok).toBe(true);
  return result;
};

describe("applyOps", () => {
  it("is atomic on a later error, reports its index and preserves input identity", () => {
    const d = graph(),
      saved = structuredClone(d);
    const result = applyOps(d, [
      { op: "update", target: "API", label: "New" },
      { op: "connect", from: "New", to: "nonexistent zzzzz" },
    ]);
    expect(result.ok).toBe(false);
    expect(result.diagram).toBe(d);
    expect(d).toEqual(saved);
    expect(result.results).toEqual([]);
    expect(result.errors[0]).toMatchObject({ i: 1, hint: expect.any(String), candidates: expect.any(Array) });
  });
  it("dry-runs the same proposed result without mutating input", () => {
    const d = empty(),
      ops: DiagramOp[] = [{ op: "add_node", kind: "Kafka topic", label: "Orders" }];
    expect(applyOps(d, ops, { dryRun: true }).diagram).toEqual(applyOps(d, ops).diagram);
    expect(d.nodes).toEqual([]);
  });
  it("returns real ids and resolution for keys across a whole batch", () => {
    const result = run(empty(), [
      { op: "add_node", kind: ".NET consumer", label: "Worker", key: "w" },
      { op: "add_node", kind: "pg", label: "DB", key: "d" },
      { op: "connect", from: "w", to: "d" },
    ]);
    expect(result.results[0].stencil?.id).toBe("service.dotnet");
    expect(result.results[2].from).toBe(result.results[0].id);
    expect(result.summary).toContain("+2 nodes");
  });
  it("updates stencils, labels, sublabels and merges/deletes properties", () => {
    const d = graph();
    d.nodes[0].props = { replicas: 2, custom: "kept", latencyMs: 200 };
    const changed = run(d, [
      {
        op: "update",
        target: "API",
        label: "Writer",
        sublabel: "v2",
        kind: "Python",
        props: { replicas: null, latencyMs: 50, added: true },
      },
    ]).diagram.nodes[0];
    expect(changed).toMatchObject({
      stencil: "service.python",
      label: "Writer",
      sublabel: "v2",
      props: { custom: "kept", latencyMs: 50, added: true },
    });
    expect(changed.props).not.toHaveProperty("replicas");
    expect(
      run({ ...d, nodes: [changed, d.nodes[1]] }, [{ op: "update", target: "Writer", sublabel: null }]).diagram
        .nodes[0],
    ).not.toHaveProperty("sublabel");
  });
  it("changes an edge's kind, label and props by endpoint reference", () => {
    const changed = run(graph(), [
      { op: "update", target: "API -> DB", kind: "async", label: "write", props: { custom: 1 } },
    ]).diagram.edges[0];
    expect(changed).toMatchObject({ kind: "async", label: "write", props: { custom: 1 } });
  });
  it("removes incident edges and layer entries", () => {
    const d = graph();
    d.layerOrder = d.nodes.map((n) => n.id);
    const result = run(d, [{ op: "remove", targets: ["API"] }]);
    expect(result.diagram.nodes).toHaveLength(1);
    expect(result.diagram.edges).toEqual([]);
    expect(result.results[0].ids).toHaveLength(2);
    expect(result.diagram.layerOrder).toEqual([d.nodes[1].id]);
  });
  it("creates boundaries, replaces membership, moves nodes in/out, and keeps contents on removal", () => {
    let d = run(graph(), [
      { op: "add_boundary", label: "Azure", members: ["API"], tone: "azure", key: "cloud" },
      { op: "add_node", kind: "Kafka topic", label: "Orders", in: "cloud" },
    ]).diagram;
    expect(d.groups?.[0].width).toBeGreaterThan(220);
    d = run(d, [{ op: "update", target: "Azure", members: ["DB"], label: "Data", tone: "neutral" }]).diagram;
    expect(d.nodes.filter((n) => n.group).map((n) => n.label)).toEqual(["DB"]);
    d = run(d, [
      { op: "update", target: "API", in: "Data" },
      { op: "update", target: "DB", in: null },
    ]).diagram;
    expect(d.nodes.filter((n) => n.group).map((n) => n.label)).toEqual(["API"]);
    const result = run(d, [{ op: "remove", targets: ["Data"] }]);
    expect(result.diagram.nodes).toHaveLength(3);
    expect(result.diagram.nodes.every((n) => !n.group)).toBe(true);
  });
  it("adds text and notes, then edits/removes them by key", () => {
    const result = run(graph(), [
      { op: "add_note", text: "Callout", near: "API", key: "note" },
      { op: "update", target: "note", label: "Changed" },
      { op: "add_note", text: "Title", style: "text", key: "heading" },
      { op: "remove", targets: ["heading"] },
    ]);
    expect(result.diagram.annotations).toHaveLength(1);
    expect(result.diagram.annotations?.[0]).toMatchObject({ kind: "note", text: "Changed" });
  });
  it("sets metadata and direction", () =>
    expect(
      run(empty(), [{ op: "set_meta", title: "Orders", description: "Details", direction: "TB" }]).diagram,
    ).toMatchObject({ title: "Orders", description: "Details", direction: "TB" }));
  it("reports generic fallback warnings", () =>
    expect(
      run(empty(), [{ op: "add_node", kind: "unrecognized frobnicator", label: "Component" }]).warnings,
    ).toHaveLength(1));
  it.each(
    [
      [{ op: "add_node", kind: "pg" }],
      [{ op: "set_meta", direction: "RL" }],
      [{ op: "add_node", kind: "pg", label: "x".repeat(201) }],
      [{ op: "add_node", kind: "pg", label: "DB", x: 100 }],
      [{ op: "add_node", kind: "pg", label: "DB", props: { replicas: 0 } }],
      [
        { op: "add_node", kind: "pg", label: "DB", key: "x" },
        { op: "add_node", kind: "pg", label: "DB2", key: "x" },
      ],
      [
        { op: "add_note", text: "x", key: "n" },
        { op: "connect", from: "n", to: "n" },
      ],
    ].map((ops) => ({ ops })),
  )("rejects malformed or unsupported operations atomically: $ops", ({ ops }) =>
    expect(applyOps(empty(), ops as DiagramOp[]).ok).toBe(false),
  );
  it("places new notes clear of cards after the batch's full vertical layout", () => {
    const result = run(empty(), [
      { op: "set_meta", direction: "TB" },
      { op: "add_node", kind: ".NET", label: "API", key: "a" },
      { op: "add_node", kind: "pg", label: "DB", key: "b" },
      { op: "connect", from: "a", to: "b" },
      { op: "add_note", text: "A note", near: "a" },
    ]);
    const note = result.diagram.annotations![0];
    expect(result.diagram.nodes.every((n) => !overlaps(note, { ...n, ...estimateCardSize(n.label, n.sublabel) }))).toBe(
      true,
    );
  });
  it("retains repairable simulations and reports missing-node warnings on removal", () => {
    const d = graph();
    d.simulations = [
      { id: "s", title: "Traffic", traffic: [{ id: "t", node: d.nodes[0].id, shape: { kind: "burst", count: 1 } }] },
    ];
    const result = run(d, [{ op: "remove", targets: ["API"] }]);
    expect(result.diagram.simulations).toEqual(d.simulations);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("missing node");
  });
  it("allows notes near boundaries, other notes and connections", () => {
    const result = run(graph(), [
      { op: "add_boundary", label: "Data", members: ["DB"], key: "g" },
      { op: "add_note", text: "Boundary note", near: "g", key: "n" },
      { op: "add_note", text: "Another note", near: "n" },
      { op: "add_note", text: "Connection note", near: "API -> DB" },
    ]);
    expect(result.diagram.annotations).toHaveLength(3);
    const notes = result.diagram.annotations!;
    expect(notes.every((n, i) => notes.every((other, j) => i === j || !overlaps(n, other)))).toBe(true);
  });
  it("rejects empty/oversized batches and invalid options", () => {
    expect(applyOps(empty(), []).ok).toBe(false);
    expect(
      applyOps(
        empty(),
        Array.from({ length: 101 }, () => ({ op: "set_meta", title: "x" })),
      ).ok,
    ).toBe(false);
    expect(applyOps(empty(), [{ op: "set_meta" }], { layout: "bad" as "auto" }).ok).toBe(false);
  });
  it("enforces the native node budget", () => {
    const d = empty();
    d.nodes = Array.from({ length: LIMITS.maxNodes }, (_, i) => ({
      id: `n${i}`,
      stencil: "generic.service",
      label: `N${i}`,
      x: 0,
      y: 0,
    }));
    expect(applyOps(d, [{ op: "add_node", kind: "pg", label: "New" }], { layout: "none" }).errors[0].error).toContain(
      "limit",
    );
  });
  it("rejects deeply nested props and non-finite values", () => {
    const nested: Record<string, unknown> = {};
    let cursor = nested;
    for (let i = 0; i < LIMITS.maxDepth; i++) {
      const child = {};
      cursor.child = child;
      cursor = child;
    }
    expect(applyOps(empty(), [{ op: "add_node", kind: "pg", label: "DB", props: nested }]).ok).toBe(false);
    expect(applyOps(empty(), [{ op: "add_node", kind: "pg", label: "DB", props: { ratePerSec: Infinity } }]).ok).toBe(
      false,
    );
  });
  it("does not silently ignore invalid edge/boundary updates", () => {
    expect(applyOps(graph(), [{ op: "update", target: "API -> DB", kind: "Kafka" }]).ok).toBe(false);
    expect(applyOps(graph(), [{ op: "update", target: "API", members: ["DB"] }]).ok).toBe(false);
  });

  describe("insert_between", () => {
    /** API -> DB as a rich connection: label, relation, sides and routing props. */
    const rich = (): DiagramFile => {
      const d = graph();
      d.edges[0] = {
        ...d.edges[0],
        kind: "async",
        label: "orders",
        sourceSide: "right",
        targetSide: "left",
        props: { filter: ["OrderPlaced"], group: "billing", travelMs: 300 },
      };
      return d;
    };
    const ends = (d: DiagramFile, id: string) => ({
      into: d.edges.find((e) => e.to === id)!,
      out: d.edges.find((e) => e.from === id)!,
    });

    it("puts the node on the connection, which keeps its kind, label, props and sides", () => {
      const { diagram: d, results } = run(rich(), [
        { op: "insert_between", from: "API", to: "DB", kind: "Kafka topic", label: "Bus", key: "bus" },
        { op: "update", target: "bus", sublabel: "orders" },
      ]);
      const id = results[0].id!;
      expect(d.edges.some((e) => e.from === "api-1" && e.to === "db-1")).toBe(false);
      expect(d.edges).toHaveLength(2);
      const { into, out } = ends(d, id);
      expect(into).toMatchObject({ kind: "async", label: "orders", sourceSide: "right" });
      expect(into.targetSide).toBeUndefined();
      expect(out).toMatchObject({ kind: "async", targetSide: "left" });
      expect(out.label).toBeUndefined();
      for (const e of [into, out])
        expect(e.props).toEqual({ filter: ["OrderPlaced"], group: "billing", travelMs: 300 });
      expect(d.nodes.find((n) => n.id === id)).toMatchObject({ stencil: "kafka.topic", sublabel: "orders" });
    });

    it("keeps a dependency a dependency on both sides", () => {
      const d = graph();
      d.edges[0] = { ...d.edges[0], relation: "config", props: { settings: [{ key: "Orders:Db" }] } };
      const { diagram: out, results } = run(d, [
        { op: "insert_between", from: "API", to: "DB", kind: "cache", label: "C" },
      ]);
      const { into, out: next } = ends(out, results[0].id!);
      expect(into).toMatchObject({ relation: "config", props: { settings: [{ key: "Orders:Db" }] } });
      expect(next).toMatchObject({ relation: "config" });
    });

    it("works on the batch so far: a renamed end, named the other way round", () => {
      const { diagram: d, results } = run(graph(), [
        { op: "update", target: "API", label: "Renamed API" },
        { op: "insert_between", from: "DB", to: "Renamed API", kind: "Redis cache", label: "Cache" },
      ]);
      const { into, out } = ends(d, results[1].id!);
      expect(into.from).toBe(d.nodes.find((n) => n.label === "Renamed API")!.id);
      expect(out.to).toBe(d.nodes.find((n) => n.label === "DB")!.id);
      expect([into.kind, out.kind]).toEqual(["sync", "sync"]);
      expect(d.edges).toHaveLength(2);
    });

    it("an insert into a connection made earlier in the batch", () => {
      const { diagram: d } = run(empty(), [
        { op: "add_node", kind: "Go service", label: "A", key: "a" },
        { op: "add_node", kind: "pg", label: "B", key: "b" },
        { op: "connect", from: "a", to: "b", kind: "sync", label: "write" },
        { op: "insert_between", from: "a", to: "b", kind: "Redis cache", label: "C" },
      ]);
      const label = new Map(d.nodes.map((n) => [n.id, n.label]));
      expect(d.edges.map((e) => `${label.get(e.from)} -> ${label.get(e.to)}`)).toEqual(["A -> C", "C -> B"]);
    });

    it("joins the boundary both ends share", () => {
      const { diagram: d, results } = run(graph(), [
        { op: "add_boundary", label: "Cloud", members: ["API", "DB"] },
        { op: "insert_between", from: "API", to: "DB", kind: "Redis cache", label: "Cache" },
      ]);
      expect(d.nodes.find((n) => n.id === results[1].id)?.group).toBe(results[0].id);
    });

    it("fails, applying nothing, without exactly one connection to replace", () => {
      const none = applyOps(graph(), [{ op: "insert_between", from: "API", to: "API", kind: "cache", label: "C" }]);
      expect(none.ok).toBe(false);
      const d = graph();
      d.edges.push({ ...d.edges[0], id: "again" });
      const two = applyOps(d, [{ op: "insert_between", from: "API", to: "DB", kind: "cache", label: "C" }]);
      expect(two.errors[0].error).toMatch(/2 connections join/);
      const unconnected = applyOps(run(graph(), [{ op: "add_node", kind: "queue", label: "Q" }]).diagram, [
        { op: "insert_between", from: "API", to: "Q", kind: "cache", label: "C" },
      ]);
      expect(unconnected.errors[0].error).toMatch(/No connection from "API" to "Q"/);
    });
  });
});
