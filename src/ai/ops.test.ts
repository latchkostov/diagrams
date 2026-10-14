import { describe, expect, it } from "vitest";
import { applyOps, MAX_RELATIONS_PER_BATCH, MAX_RELATIONS_PER_OP } from "./ops";
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
  it("connects with a dependency when asked: dotted, no traffic; a flow otherwise; nothing else is a relation", () => {
    const result = run(graph(), [
      { op: "add_node", kind: "azure.key-vault", label: "Vault", key: "kv" },
      { op: "connect", from: "API", to: "kv", relation: "secret", key: "reads" },
      { op: "connect", from: "API", to: "kv" },
    ]);
    const [secret, plain] = result.diagram.edges.slice(-2);
    expect(secret).toMatchObject({ from: result.results[1].from, relation: "secret" });
    expect(plain.relation).toBeUndefined();
    for (const relation of ["flow", "secrets"])
      expect(
        applyOps(graph(), [{ op: "connect", from: "API", to: "DB", relation } as unknown as DiagramOp]).ok,
        relation,
      ).toBe(false);
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
  it("a node's new stencil re-infers its connections, as on the canvas, and the result says so", () => {
    // The owner's diagram: a .NET service's plain flow into a generic node that becomes App Configuration.
    const d = run(empty(), [
      { op: "add_node", kind: "generic.service", label: "Settings", key: "cfg" },
      { op: "add_node", kind: "service.dotnet", label: "API", key: "api" },
      { op: "connect", from: "api", to: "cfg", kind: "sync" },
    ]).diagram;
    const made = run(d, [{ op: "update", target: "Settings", kind: "azure.app-config" }]);
    expect(made.diagram.edges[0]).toMatchObject({ relation: "config", relationOrigin: "inferred", kind: "sync" });
    expect(made.results[0]).toMatchObject({
      relations: [{ id: d.edges[0].id, from: "flow", to: "config" }],
      note: "1 connection is now Config: no messages flow over it",
    });
    // Back to a service: the inferred Config is a flow again.
    const back = run(made.diagram, [{ op: "update", target: "Settings", kind: "service.java" }]);
    expect(back.diagram.edges[0].relation).toBeUndefined();
    expect(back.diagram.edges[0].relationOrigin).toBeUndefined();
    expect(back.results[0].note).toBe("1 connection is a flow again: messages flow over it in Live");
    // A connection chosen on purpose never follows.
    const pinned = structuredClone(d);
    pinned.edges[0].relationOrigin = "explicit";
    const kept = run(pinned, [{ op: "update", target: "Settings", kind: "azure.app-config" }]);
    expect(kept.diagram.edges[0].relation).toBeUndefined();
    expect(kept.results[0].relations).toBeUndefined();
  });
  it("bounds the re-inferred connections it lists, per op and per batch, and still counts them all", () => {
    // 12 config-store candidates, each fed by 60 services: every stencil change re-infers 60 connections.
    const d: DiagramFile = { ...empty(), nodes: [], edges: [] };
    for (let s = 0; s < 12; s++) {
      d.nodes.push({ id: `store${s}`, stencil: "generic.service", label: `Store ${s}`, x: 0, y: s * 100 });
      for (let i = 0; i < 60; i++) {
        d.nodes.push({ id: `svc${s}-${i}`, stencil: "service.go", label: `Svc ${s}-${i}`, x: 400, y: 0 });
        d.edges.push({ id: `e${s}-${i}`, from: `svc${s}-${i}`, to: `store${s}` });
      }
    }
    const made = run(
      d,
      Array.from({ length: 12 }, (_, s): DiagramOp => ({
        op: "update",
        target: `store${s}`,
        kind: "azure.app-config",
      })),
    );
    expect(made.diagram.edges.every((e) => e.relation === "config")).toBe(true);
    const listed = made.results.map((r) => r.relations?.length ?? 0);
    expect(Math.max(...listed)).toBe(MAX_RELATIONS_PER_OP);
    expect(listed.reduce((a, b) => a + b, 0)).toBe(MAX_RELATIONS_PER_BATCH);
    for (const r of made.results) {
      expect((r.relations?.length ?? 0) + (r.relationsOmitted ?? 0)).toBe(60);
      expect(r.note).toBe("60 connections are now Config: no messages flow over them");
    }
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

describe("applyOps: ids and kinds", () => {
  const n = (id: string, label = id.toUpperCase(), stencil = "service.go") => ({ id, stencil, label, x: 0, y: 0 });
  /** A file that gives a node and a connection one id ("ledger"), as some hand- and agent-written files do. */
  const shared = (): DiagramFile => ({
    format: "diagrams/v1",
    title: "Shared",
    nodes: [n("api"), n("db", "DB", "postgres"), n("ledger", "Ledger")],
    edges: [
      { id: "ledger", from: "api", to: "db", kind: "sync" },
      { id: "e1", from: "ledger", to: "api", kind: "sync" },
    ],
  });
  const opened = () => {
    const r = validateDiagram(shared());
    if (!r.ok) throw new Error(r.error);
    return r.diagram;
  };

  it("removes a connection that once shared a node's id without touching the node", () => {
    const d = opened();
    expect(d.edges[0].id).toBe("ledger-2");
    const { diagram } = run(d, [{ op: "remove", targets: ["ledger-2"] }]);
    expect(diagram.nodes.map((x) => x.id)).toEqual(["api", "db", "ledger"]);
    expect(diagram.edges.map((x) => x.id)).toEqual(["e1"]);
  });

  it("updates that connection, not the node", () => {
    const d = opened();
    const { diagram } = run(d, [{ op: "update", target: "ledger-2", kind: "async", label: "writes" }]);
    expect(diagram.edges[0]).toMatchObject({ id: "ledger-2", kind: "async", label: "writes" });
    expect(diagram.nodes).toEqual(d.nodes);
  });

  it("refuses a diagram whose ids collide instead of guessing which element is meant", () => {
    const d = shared(),
      saved = structuredClone(d);
    for (const ops of [
      [{ op: "remove", targets: ["ledger"] }],
      [{ op: "update", target: "ledger", kind: "async" }],
    ] as DiagramOp[][]) {
      const result = applyOps(d, ops);
      expect(result.ok).toBe(false);
      expect(result.errors[0].error).toMatch(/shared the id "ledger"/);
      expect(result.diagram).toBe(d);
    }
    expect(d).toEqual(saved);
  });

  it("acts on the kind its target is: removing a connection never removes a node", () => {
    const d = graph();
    const write = d.edges[0].id;
    const { diagram, results } = run(d, [{ op: "remove", targets: [write] }]);
    expect(diagram.nodes).toHaveLength(2);
    expect(diagram.edges).toEqual([]);
    expect(results[0].ids).toEqual([write]);
  });

  it("resolves a name only to the kinds an op takes", () => {
    // A node and a connection both named "Orders": node ops find the node, where both used to be a tie.
    const d: DiagramFile = {
      format: "diagrams/v1",
      title: "Names",
      nodes: [n("orders", "Orders"), n("api", "API")],
      edges: [{ id: "e1", from: "api", to: "orders", label: "Orders" }],
    };
    const { diagram, results } = run(d, [
      { op: "add_node", kind: "pg", label: "DB", key: "db" },
      { op: "connect", from: "Orders", to: "db" },
      { op: "add_boundary", label: "Shop", members: ["Orders"] },
      { op: "update", target: "Shop", label: "Store" },
    ]);
    expect(results[1]).toMatchObject({ from: "orders" });
    expect(diagram.nodes.find((x) => x.id === "orders")?.group).toBe(results[2].id);
    expect(diagram.groups?.[0].label).toBe("Store");
    // Ops that take any kind still refuse a tie.
    expect(applyOps(d, [{ op: "remove", targets: ["Orders"] }]).errors[0].error).toMatch(/matches 2 elements/);
    // An exact id of the wrong kind is an error, never a different element.
    expect(applyOps(d, [{ op: "add_boundary", label: "B", members: ["e1"] }]).errors[0].error).toMatch(
      /must refer to a node/,
    );
  });

  it("never mints an id another node, connection, boundary or note has", () => {
    // Every id the ops would mint on an empty diagram is already taken here, by an element of another kind.
    const fresh = run(empty(), [
      { op: "add_node", kind: ".NET", label: "A", key: "a" },
      { op: "add_node", kind: ".NET", label: "B", key: "b" },
      { op: "connect", from: "a", to: "b" },
      { op: "add_boundary", label: "G", members: ["a"] },
      { op: "add_note", text: "N" },
    ]).results.map((r) => r.id!);
    expect(fresh).toEqual(["dotnet-1", "dotnet-2", "e-1", "boundary-1", "note-1"]);
    const d: DiagramFile = {
      format: "diagrams/v1",
      title: "Taken",
      nodes: [n("e-1"), n("boundary-1"), n("e-2"), n("e-3")],
      edges: [
        { id: "dotnet-1", from: "e-1", to: "boundary-1" },
        { id: "note-1", from: "boundary-1", to: "e-1" },
      ],
      groups: [{ id: "dotnet-2", label: "Taken", x: 0, y: 0, width: 400, height: 300 }],
      annotations: [{ id: "boundary-2", kind: "note", text: "x", x: 0, y: 600, width: 240, height: 160 }],
    };
    const before = new Set([...d.nodes, ...d.edges, ...d.groups!, ...d.annotations!].map((x) => x.id));
    const { diagram, results } = run(d, [
      { op: "add_node", kind: ".NET", label: "A", key: "a" },
      { op: "add_node", kind: ".NET", label: "B", key: "b" },
      { op: "connect", from: "a", to: "b" },
      { op: "add_boundary", label: "G", members: ["a"] },
      { op: "add_note", text: "N" },
      { op: "insert_between", from: "a", to: "b", kind: "Redis cache", label: "C" },
    ]);
    for (const r of results) expect(before.has(r.id!)).toBe(false);
    const ids = [diagram.nodes, diagram.edges, diagram.groups ?? [], diagram.annotations ?? []].flat().map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    const again = validateDiagram(diagram);
    expect(again.ok && again.warnings).toEqual([]);
  });
});
