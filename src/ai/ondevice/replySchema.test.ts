import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../../model/types";
import kafka from "../../examples/kafka-order-pipeline.json";
import { checkJsonSchema } from "../../model/jsonSchema";
import { ENUM_BUDGET, elementNames, KEY_PATTERN, replySchema } from "./replySchema";

const KAFKA = kafka as unknown as DiagramFile;
const EMPTY: DiagramFile = { format: "diagrams/v1", title: "t", nodes: [], edges: [] };
const valid = (schema: object, reply: object) => {
  try {
    checkJsonSchema(reply, schema as Record<string, unknown>);
    return true;
  } catch {
    return false;
  }
};
const reply = (...ops: object[]) => ({ summary: "s", ops });

describe("the reply schema for one request", () => {
  const schema = replySchema(KAFKA, "Rename Payments service to Billing service");

  it("names the diagram's own elements as enums: targets, and the ends of a connection", () => {
    const text = JSON.stringify(schema);
    for (const label of ["Payments service", "Orders database", "Order service -> Orders database"])
      expect(text).toContain(JSON.stringify(label));
    expect(valid(schema, reply({ op: "rename", target: "Payments service", label: "Billing service" }))).toBe(true);
    expect(valid(schema, reply({ op: "remove", target: "Order service -> Orders database" }))).toBe(true);
    expect(valid(schema, reply({ op: "connect", from: "Payments service", to: "new-queue" }))).toBe(true);
  });

  it("a target outside the enum can't validate (run 3's looping target)", () => {
    const looped = "Payments service apart from that connection to Payments service apart from that";
    expect(valid(schema, reply({ op: "rename", target: looped, label: "Billing" }))).toBe(false);
    expect(
      valid(schema, reply({ op: "change_kind", target: "Orders database core pipeline model", kind: "MongoDB" })),
    ).toBe(false);
    expect(valid(schema, reply({ op: "connect", from: "Payments service apart from that", to: "x" }))).toBe(false);
  });

  it("keys follow a short lower-case pattern; at most 6 ops, no repeats", () => {
    expect(new RegExp(KEY_PATTERN).test("billing-dlq")).toBe(true);
    expect(valid(schema, reply({ op: "add", key: "Billing DLQ", kind: "queue", label: "dlq" }))).toBe(false);
    const op = { op: "add", key: "q", kind: "queue", label: "q" };
    expect(valid(schema, reply(op, op))).toBe(false);
    expect(valid(schema, reply(...Array.from({ length: 7 }, (_, i) => ({ ...op, key: `q${i}` }))))).toBe(false);
  });

  it('the selection is "this"; an empty diagram has only keys to name', () => {
    const withThis = replySchema(KAFKA, "Add a retry queue after this", [
      { id: "payments", label: "Payments service", kind: "node" },
    ]);
    expect(valid(withThis, reply({ op: "connect", from: "this", to: "retry" }))).toBe(true);
    const empty = replySchema(EMPTY, "A browser calls a Node.js API");
    expect(valid(empty, reply({ op: "connect", from: "web", to: "api" }))).toBe(true);
    expect(valid(empty, reply({ op: "connect", from: "Web Browser", to: "api" }))).toBe(false);
  });

  it("the enums tier drops anyOf and patterns; the plain tier is bounded strings only", () => {
    const enums = replySchema(KAFKA, "x", [], "enums");
    expect(JSON.stringify(enums)).not.toMatch(/anyOf|pattern|uniqueItems/);
    expect(valid(enums, reply({ op: "rename", target: "nowhere", label: "x" }))).toBe(false);
    const plain = replySchema(KAFKA, "x", [], "plain");
    expect(JSON.stringify(plain)).not.toMatch(/anyOf|pattern|uniqueItems|"enum":\["Storefront/);
    expect(valid(plain, reply({ op: "rename", target: "nowhere", label: "x" }))).toBe(true);
  });

  it("a big diagram keeps the selection, its neighbours and what the request names, within the budget", () => {
    const big: DiagramFile = {
      ...EMPTY,
      nodes: Array.from({ length: 400 }, (_, i) => ({
        id: `n${i}`,
        stencil: "service.go",
        label: `Node ${i}`,
        x: 0,
        y: 0,
      })),
      edges: [{ id: "e", from: "n399", to: "n398" }],
    };
    const { nodes } = elementNames(big, "Rename Node 250 to X", [{ id: "n399", label: "Node 399", kind: "node" }]);
    expect(nodes).toHaveLength(ENUM_BUDGET);
    expect(nodes.slice(0, 3)).toEqual(["Node 399", "Node 398", "Node 250"]);
  });
});
