import { exceedsDepth, LIMITS, validateDiagram } from "../interop/native";
import type { DiagramFile } from "../model/types";
import { sharedDefs, type JsonSchema } from "./schemas";

import { checkJsonSchema } from "../model/jsonSchema";

export function checkSchema(value: unknown, schema: JsonSchema, path = "input"): void {
  checkJsonSchema(value, schema, path, sharedDefs);
}
export function checkBudget(value: unknown): void {
  if (exceedsDepth(value)) throw new Error("Input exceeds the nesting limit.");
  if (JSON.stringify(value).length > LIMITS.maxTextChars) throw new Error("Input exceeds the text limit.");
}
export function validated(diagram: DiagramFile): DiagramFile {
  checkBudget(diagram);
  const result = validateDiagram(diagram);
  if (!result.ok) throw new Error(result.error);
  // AI operations must not silently lose newly requested elements to native repairs.
  const repairs = result.warnings.filter((w) => !w.includes("repair the reference in the simulation editor"));
  if (repairs.length) throw new Error(repairs.join(" "));
  return result.diagram;
}
