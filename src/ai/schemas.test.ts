import { describe, expect, it } from "vitest";
import { toolSchemas, toolDescriptions, edit_diagramSchema, flatOpsSchema } from "./schemas";
import { checkSchema } from "./validation";
import { METRIC_FIELDS } from "../model/types";

describe("shared tool schemas", () => {
  it.each(METRIC_FIELDS)("accepts the simulation metric %s in agent expectations", (metric) => {
    expect(() =>
      checkSchema(
        {
          title: "Deadline check",
          traffic: [],
          expectations: [{ label: "Expected count", node: "caller", metric, op: ">=", value: 0 }],
        },
        toolSchemas.set_simulation,
      ),
    ).not.toThrow();
  });
  it("provides seven self-contained JSON schemas and descriptions", () => {
    expect(Object.keys(toolSchemas)).toHaveLength(7);
    for (const [name, schema] of Object.entries(toolSchemas)) {
      expect(schema.$defs).toBeDefined();
      expect(schema.type).toBe("object");
      expect(toolDescriptions[name as keyof typeof toolDescriptions].length).toBeGreaterThan(20);
      expect(() => JSON.stringify(schema)).not.toThrow();
    }
  });
  it("supports flat constrained output without oneOf or const", () => {
    const schema = JSON.stringify(flatOpsSchema);
    expect(schema).not.toContain('"oneOf"');
    expect(schema).not.toContain('"const"');
    checkSchema(
      {
        ops: [
          { op: "add_node", kind: ".NET consumer", label: "Worker" },
          { op: "update", target: "Worker", sublabel: null, props: { replicas: null } },
          { op: "connect", from: "Worker", to: "Store", fromSide: "bottom", toSide: "top" },
          { op: "update", target: "connection", fromSide: null, toSide: "left", route: "auto" },
        ],
      },
      flatOpsSchema,
    );
  });
  it("checks per-op fields in the full schema and supports boundary membership", () => {
    expect(() => checkSchema({ ops: [{ op: "connect", from: "a" }] }, edit_diagramSchema)).toThrow();
    expect(() =>
      checkSchema({ ops: [{ op: "update", target: "g", members: ["a"], tone: "azure" }] }, edit_diagramSchema),
    ).not.toThrow();
  });
  it("rejects inherited property names as unknown op fields", () => {
    const op = JSON.parse('{"op":"set_meta","constructor":123}');
    expect(() => checkSchema({ ops: [op] }, edit_diagramSchema)).toThrow();
  });
});
