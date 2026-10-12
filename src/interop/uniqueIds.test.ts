import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { validateDiagram } from "./native";

// Ids are one namespace across nodes, connections, boundaries and notes: edit ops, checks and the canvas look an
// id up across kinds. A file may still repeat one (hand- or agent-written, an old export): it opens with the
// later element renamed and nothing lost.

const node = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  stencil: "service.go",
  label: id.toUpperCase(),
  x: 0,
  y: 0,
  ...extra,
});
const file = (rest: Record<string, unknown>) => ({
  format: "diagrams/v1",
  title: "Ids",
  nodes: [],
  edges: [],
  ...rest,
});

function load(rest: Record<string, unknown>) {
  const r = validateDiagram(file(rest));
  if (!r.ok) throw new Error(r.error);
  return r;
}

const allIds = (d: DiagramFile) => [
  ...d.nodes.map((n) => n.id),
  ...d.edges.map((e) => e.id),
  ...(d.groups ?? []).map((g) => g.id),
  ...(d.annotations ?? []).map((a) => a.id),
];

describe("ids unique across elements on load", () => {
  it("renames a connection that shares a node's id, and keeps the node's id and its connections", () => {
    const { diagram, warnings } = load({
      nodes: [node("api"), node("db"), node("ledger")],
      edges: [
        { id: "ledger", from: "api", to: "db", kind: "sync", label: "writes" },
        { id: "e1", from: "ledger", to: "api" },
      ],
    });
    expect(diagram.nodes.map((n) => n.id)).toEqual(["api", "db", "ledger"]);
    expect(diagram.edges).toEqual([
      { id: "ledger-2", from: "api", to: "db", kind: "sync", label: "writes" },
      { id: "e1", from: "ledger", to: "api" },
    ]);
    expect(warnings).toEqual([`Two elements shared the id "ledger"; one was renamed to "ledger-2".`]);
  });

  it("never renames onto an id another element already has", () => {
    const { diagram } = load({
      nodes: [node("x"), node("x-2"), node("y")],
      edges: [
        { id: "x", from: "y", to: "x" },
        { id: "x-3", from: "x-2", to: "y" },
      ],
    });
    expect(diagram.edges.map((e) => e.id)).toEqual(["x-4", "x-3"]);
    // The connection that was "x-3" still is: nothing it was referred to by moved.
    expect(diagram.edges[1]).toEqual({ id: "x-3", from: "x-2", to: "y" });
  });

  it("renames repeated connection ids", () => {
    const { diagram } = load({
      nodes: [node("a"), node("b")],
      edges: [
        { id: "e", from: "a", to: "b" },
        { id: "e", from: "b", to: "a" },
        { id: "e", from: "a", to: "b", kind: "sync" },
      ],
    });
    expect(diagram.edges.map((e) => [e.id, e.from, e.to])).toEqual([
      ["e", "a", "b"],
      ["e-2", "b", "a"],
      ["e-3", "a", "b"],
    ]);
  });

  it("keeps both of two nodes with one id: references stay with the first, the second is renamed", () => {
    const { diagram, warnings } = load({
      nodes: [node("a", { label: "First" }), node("a", { label: "Second" }), node("b")],
      edges: [{ id: "e1", from: "a", to: "b" }],
      simulations: [{ id: "s", title: "S", traffic: [{ id: "t", node: "a", shape: { kind: "burst", count: 1 } }] }],
    });
    expect(diagram.nodes.map((n) => [n.id, n.label])).toEqual([
      ["a", "First"],
      ["a-2", "Second"],
      ["b", "B"],
    ]);
    expect(diagram.edges[0]).toMatchObject({ from: "a", to: "b" });
    expect(diagram.simulations?.[0].traffic[0].node).toBe("a");
    expect(warnings).toEqual([`Two elements shared the id "a"; one was renamed to "a-2".`]);
  });

  it("renames a boundary that shares an id, and its members follow it", () => {
    const { diagram } = load({
      groups: [
        { id: "orders", label: "Orders team", x: 0, y: 0, width: 400, height: 300 },
        { id: "orders", label: "Second box", x: 600, y: 0, width: 400, height: 300 },
      ],
      nodes: [node("orders", { group: "orders" }), node("db", { group: "orders" })],
      edges: [{ id: "e1", from: "orders", to: "db" }],
    });
    expect(diagram.groups?.map((g) => [g.id, g.label])).toEqual([
      ["orders-2", "Orders team"],
      ["orders-3", "Second box"],
    ]);
    expect(diagram.nodes.map((n) => [n.id, n.group])).toEqual([
      ["orders", "orders-2"],
      ["db", "orders-2"],
    ]);
  });

  it("keeps a note that shares a node's id (it used to be dropped), renamed", () => {
    const { diagram } = load({
      nodes: [node("a"), node("b")],
      edges: [{ id: "e1", from: "a", to: "b" }],
      annotations: [{ id: "a", kind: "note", text: "Remember me", x: 0, y: 300, width: 240, height: 160 }],
      layerOrder: ["a", "b"],
    });
    expect(diagram.annotations).toMatchObject([{ id: "a-2", text: "Remember me" }]);
    expect(diagram.edges[0]).toMatchObject({ from: "a", to: "b" });
    expect(diagram.layerOrder).toEqual(["a", "b"]);
  });

  it("copies an ignored finding to each element that shared its id", () => {
    const { diagram } = load({
      nodes: [node("a"), node("b")],
      edges: [{ id: "a", from: "a", to: "b", kind: "sync" }],
      checks: {
        off: ["capacity"],
        ignore: [
          { rule: "sync-cycle", target: "a", reason: "Known" },
          { rule: "no-reader", target: "b" },
        ],
      },
    });
    expect(diagram.checks).toEqual({
      off: ["capacity"],
      ignore: [
        { rule: "sync-cycle", target: "a", reason: "Known" },
        { rule: "no-reader", target: "b" },
        { rule: "sync-cycle", target: "a-2", reason: "Known" },
      ],
    });
  });

  it("leaves every id unique across kinds, and a second load changes nothing", () => {
    const { diagram } = load({
      groups: [{ id: "x", label: "X", x: 0, y: 0, width: 10, height: 10 }],
      nodes: [node("x", { group: "x" }), node("x"), node("y")],
      annotations: [
        { id: "x", kind: "shape", text: "", x: 0, y: 0, width: 10, height: 10 },
        { id: "y", kind: "text", text: "Y", x: 0, y: 0, width: 10, height: 10 },
      ],
      edges: [
        { id: "x", from: "x", to: "y" },
        { id: "y", from: "y", to: "x" },
        { id: "x", from: "y", to: "x" },
      ],
    });
    const ids = allIds(diagram);
    expect(new Set(ids).size).toBe(ids.length);
    const again = validateDiagram(diagram);
    expect(again.ok && again.warnings).toEqual([]);
    expect(again.ok && again.diagram).toEqual(diagram);
  });

  it("doesn't touch a file whose ids are already unique", () => {
    const input = file({
      nodes: [node("a"), node("b")],
      edges: [{ id: "e1", from: "a", to: "b" }],
      groups: [{ id: "g", label: "G", x: 0, y: 0, width: 10, height: 10 }],
    });
    const r = validateDiagram(input);
    expect(r.ok && r.warnings).toEqual([]);
    expect(r.ok && allIds(r.diagram)).toEqual(["a", "b", "e1", "g"]);
  });

  it("stays linear when a hostile file repeats one id, around suffixes the file uses itself", () => {
    // Every connection is "e", and the nodes hold "e-2" … "e-201": renaming must neither revisit taken suffixes
    // for each repeat (quadratic) nor take a suffix a node has.
    const build = (n: number) =>
      file({
        nodes: [node("a"), ...Array.from({ length: 200 }, (_, i) => node(`e-${i + 2}`))],
        edges: Array.from({ length: n }, () => ({ id: "e", from: "a", to: "a" })),
      });
    const small = build(2_000),
      big = build(16_000);
    const r = validateDiagram(big);
    const ids = r.ok ? allIds(r.diagram) : [];
    expect(new Set(ids).size).toBe(201 + 16_000);
    expect(r.ok && r.diagram.edges[1].id).toBe("e-202");
    const fastest = (input: unknown) => {
      let best = Infinity;
      for (let i = 0; i < 5; i++) {
        const start = performance.now();
        validateDiagram(input);
        best = Math.min(best, performance.now() - start);
      }
      return best;
    };
    fastest(small);
    // 8 times the input: about 8 times the work when linear, 64 times when quadratic.
    expect(fastest(big) / fastest(small)).toBeLessThan(24);
  });
});

describe("imports never give two elements one id", () => {
  it("a compose service named like a connection id (e1) keeps its id and its connection", async () => {
    const { importText } = await import("./formats");
    const compose = [
      "services:",
      "  e1:",
      "    image: postgres:16",
      "  e2:",
      "    image: ghcr.io/acme/orders:1",
      "    depends_on: [e1]",
      "    environment:",
      "      DATABASE_URL: postgres://e1:5432/orders",
      "",
    ].join("\n");
    const outcome = await importText(compose, "docker-compose.yml");
    if (outcome.ok !== true) throw new Error(JSON.stringify(outcome));
    const d = outcome.diagram;
    expect(d.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(["e1", "e2"]));
    expect(d.edges.some((e) => e.from === "e2" && e.to === "e1")).toBe(true);
    const ids = allIds(d);
    expect(new Set(ids).size).toBe(ids.length);
    expect(outcome.warnings.filter((w) => /shared the id/.test(w))).toEqual([]);
  });

  it("a draw.io file that gives a shape and a connection one id", async () => {
    const { importText } = await import("./formats");
    const xml = `<mxfile><diagram name="P"><mxGraphModel><root>
      <mxCell id="0"/><mxCell id="1" parent="0"/>
      <object id="a" label="API" dg_id="api"><mxCell style="rounded=1;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="160" height="60" as="geometry"/></mxCell></object>
      <object id="b" label="DB" dg_id="db"><mxCell style="shape=cylinder;" vertex="1" parent="1"><mxGeometry x="300" y="0" width="160" height="60" as="geometry"/></mxCell></object>
      <object id="c" label="writes" dg_id="api"><mxCell edge="1" source="a" target="b" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell></object>
    </root></mxGraphModel></diagram></mxfile>`;
    const outcome = await importText(xml, "shop.drawio");
    if (outcome.ok !== true) throw new Error(JSON.stringify(outcome));
    const d = outcome.diagram;
    expect(d.nodes.map((n) => n.id)).toEqual(["api", "db"]);
    expect(d.edges).toMatchObject([{ from: "api", to: "db", label: "writes" }]);
    const ids = allIds(d);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
