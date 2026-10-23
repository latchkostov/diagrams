import { describe, expect, it } from "vitest";
import { applyOps } from "../ai/ops";
import { toFlow, edgeFromFlow } from "../canvas/convert";
import { splitFlowEdge } from "../editor/edgeEdits";
import { splitEdge } from "./edgeSplit";
import type { DiagramEdge, DiagramFile } from "./types";

// One split rule (A→B becomes A→N, N→B) for the AI's insert_between and the canvas's insert (a node or stencil
// dropped on an edge, Insert node on its menu). The two lanes may only differ in the ids they pick.

const OLD: DiagramEdge = {
  id: "api-db",
  from: "api",
  to: "db",
  kind: "sync",
  relation: "config",
  label: "reads settings",
  sourceSide: "right",
  targetSide: "left",
  props: { settings: [{ key: "Db:Timeout" }] },
};

const diagram: DiagramFile = {
  format: "diagrams/v1",
  title: "t",
  nodes: [
    { id: "api", stencil: "service.node", label: "API", x: 0, y: 0 },
    { id: "db", stencil: "postgres", label: "DB", x: 400, y: 0 },
  ],
  edges: [OLD],
};

/** An edge without its id (the only thing the lanes pick differently), undefined fields dropped. */
const meaning = (e: DiagramEdge) =>
  Object.fromEntries(
    Object.entries(e).filter(([k, v]) => k !== "id" && v !== undefined && !(k === "relation" && v === "flow")),
  );

describe("splitEdge", () => {
  it("puts the label and the source's side on the first half, the target's side on the second, the meaning on both", () => {
    const [a, b] = splitEdge(OLD, "n", { first: "x", second: "y" });
    expect(a).toEqual({
      id: "x",
      from: "api",
      to: "n",
      kind: "sync",
      relation: "config",
      label: "reads settings",
      sourceSide: "right",
      props: OLD.props,
    });
    expect(b).toEqual({
      id: "y",
      from: "n",
      to: "db",
      kind: "sync",
      relation: "config",
      targetSide: "left",
      props: OLD.props,
    });
    expect(a.props).not.toBe(OLD.props);
    expect(b.props).not.toBe(a.props);
  });

  it("the AI's insert_between and the canvas split give the same two edges", () => {
    const ai = applyOps(diagram, [
      { op: "insert_between", from: "API", to: "DB", kind: "Redis cache", label: "Cache" },
    ]);
    if (!ai.ok) throw new Error(JSON.stringify(ai.errors));
    const id = ai.diagram.nodes.find((n) => n.label === "Cache")?.id ?? "";
    const canvas = splitFlowEdge(toFlow(diagram).edges, "api-db", id);
    if (!canvas) throw new Error("no split");
    expect(canvas.edges.map((e) => meaning(edgeFromFlow(e)))).toEqual(ai.diagram.edges.map(meaning));
    // The canvas keeps the old id on the first half; the AI picks fresh ones.
    expect(canvas.first).toBe("api-db");
  });
});

it("drops hand-shaped bends from both split halves", () => {
  const old = {
    ...OLD,
    waypoints: [
      { x: 300, y: 100 },
      { x: 500, y: 100 },
    ],
  };
  for (const edge of splitEdge(old, "middle", { first: "a", second: "b" })) expect(edge.waypoints).toBeUndefined();
  const f = toFlow({ ...diagram, edges: [old] });
  for (const edge of splitFlowEdge(f.edges, "api-db", "middle")!.edges) expect(edge.data?.waypoints).toBeUndefined();
});
