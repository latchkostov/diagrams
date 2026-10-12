// The static agent docs under public/schema/, built from the code so they can't drift:
//   diagram.v1.json  the .diagram.json file format (src/model/types.ts)
//   ops.v1.json      edit_diagram's input (src/ai/schemas.ts), plus the other tools' inputs
//   stencils.json    the stencil catalog with search aliases (src/stencils/catalog.ts)
// Written by scripts/gen-schemas.mjs before every build; a unit test keeps the committed files current.

import { catalog } from "../../stencils/catalog";
import { STENCIL_ALIASES } from "../../lib/stencilSearch";
import { diagramV1Schema, toolDescriptions, toolSchemas, opsSchema, toolAnnotations } from "../index";

export const SITE = "https://www.livediagrams.dev";
const SCHEMA = "https://json-schema.org/draft/2020-12/schema";

const ROLES = ["source", "topic", "queue", "stream", "processor", "gateway", "store", "sink", "none"];
const CATEGORIES = ["messaging", "compute", "data", "network", "observability", "security", "clients", "generic"];
function opsDoc() {
  return {
    $schema: SCHEMA,
    $id: `${SITE}/schema/ops.v1.json`,
    title: "Live Diagrams edit ops (v1)",
    description: `${toolDescriptions.edit_diagram} The same input as the WebMCP tool edit_diagram and the AI panel's Advanced paste box (which also takes a bare array of ops).`,
    ...opsSchema,
    $comment: "The other tools' inputs are under $tools.",
    $tools: Object.fromEntries(
      Object.entries(toolSchemas).map(([name, schema]) => [
        name,
        {
          description: toolDescriptions[name as keyof typeof toolDescriptions],
          inputSchema: schema,
          annotations: toolAnnotations[name as keyof typeof toolAnnotations],
        },
      ]),
    ),
  };
}

function stencilsDoc() {
  return {
    $comment: "Stencil ids are a public contract: never renamed. Use 'kind' in plain words or an id from here.",
    categories: CATEGORIES,
    simRoles: ROLES,
    stencils: catalog.map((s) => ({
      id: s.id,
      label: s.label,
      vendor: s.vendor,
      category: s.category,
      simRole: s.simRole,
      description: s.description,
      ...(STENCIL_ALIASES[s.id]?.length ? { aliases: [...STENCIL_ALIASES[s.id]] } : {}),
    })),
  };
}

/** File name (under public/schema/) → JSON text. */
export function publicSchemaFiles(): Record<string, string> {
  const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
  return {
    "diagram.v1.json": json(diagramV1Schema),
    "ops.v1.json": json(opsDoc()),
    "stencils.json": json(stencilsDoc()),
  };
}
