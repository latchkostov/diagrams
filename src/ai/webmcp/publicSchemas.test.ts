import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { catalog } from "../../stencils/catalog";
import { publicSchemaFiles } from "./publicSchemas";

describe("public/schema", () => {
  const files = publicSchemaFiles();

  it("is current with the code (run `pnpm schemas` after changing the catalog or the tool schemas)", () => {
    for (const [name, text] of Object.entries(files))
      expect(readFileSync(join(process.cwd(), "public", "schema", name), "utf8").replace(/\r\n/g, "\n"), name).toBe(
        text,
      );
  });

  it("lists every stencil and describes the file and ops formats", () => {
    const stencils = JSON.parse(files["stencils.json"]).stencils as { id: string; aliases?: string[] }[];
    expect(stencils.map((s) => s.id)).toEqual(catalog.map((s) => s.id));
    expect(stencils.find((s) => s.id === "azure.service-bus.queue")?.aliases).toContain("dlq");
    const diagram = JSON.parse(files["diagram.v1.json"]);
    expect(diagram.properties.format).toEqual({ const: "diagrams/v1" });
    expect(diagram.required).toEqual(["format", "title", "nodes", "edges"]);
    const ops = JSON.parse(files["ops.v1.json"]);
    expect(ops.required).toEqual(["ops"]);
    expect(Object.keys(ops.$tools)).toEqual([
      "describe_diagram",
      "find_stencils",
      "edit_diagram",
      "set_simulation",
      "new_diagram",
      "get_share_link",
    ]);
  });
});
