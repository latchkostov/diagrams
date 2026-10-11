import { describe, expect, it } from "vitest";
import { toolSchemas, toolDescriptions, edit_diagramSchema, flatOpsSchema } from "./schemas";
import { checkSchema } from "./validation";

describe("shared tool schemas", () => {
  it("provides six self-contained JSON schemas and descriptions", () => {
    expect(Object.keys(toolSchemas)).toHaveLength(6);
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
