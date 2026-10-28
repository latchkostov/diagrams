import { describe, expect, it } from "vitest";
import { catalog } from "../../stencils/catalog";
import { publicSchemaFiles } from "./publicSchemas";
import { checkSchema } from "../validation";

describe("public/schema", () => {
  const files = publicSchemaFiles();

  it("publishes side selection and automatic route reset, without agent waypoint writes", () => {
    const schema = JSON.parse(files["ops.v1.json"]);
    for (const op of [
      { op: "connect", from: "a", to: "b", fromSide: "bottom", toSide: "top" },
      { op: "update", target: "e", fromSide: null, toSide: "left", route: "auto" },
    ])
      expect(() => checkSchema({ ops: [op] }, schema)).not.toThrow();
    for (const op of [
      { op: "connect", from: "a", to: "b", fromSide: null },
      { op: "update", target: "e", toSide: "diagonal" },
      { op: "update", target: "e", route: "custom" },
      { op: "update", target: "e", waypoints: [{ x: 0, y: 0 }] },
    ])
      expect(() => checkSchema({ ops: [op] }, schema)).toThrow();
  });

  it("lists every stencil and describes the file and ops formats", () => {
    const stencils = JSON.parse(files["stencils.json"]).stencils as { id: string; aliases?: string[] }[];
    expect(stencils.map((s) => s.id)).toEqual(catalog.map((s) => s.id));
    expect(stencils.find((s) => s.id === "azure.service-bus.queue")?.aliases).toContain("dlq");
    const diagram = JSON.parse(files["diagram.v1.json"]);
    expect(diagram.properties.format).toEqual({ const: "diagrams/v1" });
    expect(diagram.required).toEqual(["format", "title", "nodes", "edges"]);
    const planning = JSON.parse(files["diagram.v2.json"]);
    expect(planning.properties.format).toEqual({ const: "diagrams/v2" });
    expect(planning.required).toContain("planning");
    expect(planning.properties.planning.properties.revision).toEqual({
      enum: ["p1", "p2", "p3", "p3-a1", "p3-w1", "p3-w2"],
    });
    const ops = JSON.parse(files["ops.v1.json"]);
    expect(ops.required).toEqual(["ops"]);
    expect(Object.keys(ops.$tools)).toEqual([
      "describe_diagram",
      "check_diagram",
      "find_stencils",
      "edit_diagram",
      "set_simulation",
      "new_diagram",
      "get_share_link",
    ]);
  });
});

describe("the tool list the AI panel shows", () => {
  it("names every tool, with a line for people", async () => {
    const { toolSchemas } = await import("../schemas");
    const { EDIT_TOOLS, LIVE_TOOLS } = await import("./toolList");
    const { TOOL_HELP } = await import("./toolHelp");
    expect([...EDIT_TOOLS].sort()).toEqual(Object.keys(toolSchemas).sort());
    expect(Object.keys(TOOL_HELP).sort()).toEqual([...EDIT_TOOLS].sort());
    expect(LIVE_TOOLS.every((t) => EDIT_TOOLS.includes(t))).toBe(true);
    for (const line of Object.values(TOOL_HELP)) expect(line()).toMatch(/^[A-Z].{10,80}\.$/);
  });
});
