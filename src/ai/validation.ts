import { exceedsDepth, LIMITS, validateDiagram } from "../interop/native";
import type { DiagramFile } from "../model/types";
import { sharedDefs, type JsonSchema } from "./schemas";

/** The small JSON Schema vocabulary used by our tools, also enforced for flat model replies. */
export function checkSchema(value: unknown, schema: JsonSchema, path = "input"): void {
  if (schema.$ref) {
    const name = String(schema.$ref).split("/").pop()!;
    return checkSchema(value, (sharedDefs as Record<string, JsonSchema>)[name], path);
  }
  if (schema.oneOf) {
    for (const variant of schema.oneOf as JsonSchema[]) {
      try {
        checkSchema(value, variant, path);
        return;
      } catch {
        /* Try the next variant. */
      }
    }
    throw new Error(`${path}: invalid operation or fields; use the edit_diagram schema.`);
  }
  if ("const" in schema && value !== schema.const) throw new Error(`${path}: expected ${String(schema.const)}.`);
  if (schema.enum && !(schema.enum as unknown[]).includes(value))
    throw new Error(`${path}: expected one of ${(schema.enum as unknown[]).join(", ")}.`);
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const matches = (type: unknown) =>
    type === undefined ||
    (type === "null"
      ? value === null
      : type === "array"
        ? Array.isArray(value)
        : type === "object"
          ? typeof value === "object" && value !== null && !Array.isArray(value)
          : type === "integer"
            ? Number.isInteger(value)
            : typeof value === type);
  if (!types.some(matches)) throw new Error(`${path}: expected ${types.join(" or ")}.`);
  if (typeof value === "number") {
    if (
      !Number.isFinite(value) ||
      (typeof schema.minimum === "number" && value < schema.minimum) ||
      (typeof schema.maximum === "number" && value > schema.maximum)
    )
      throw new Error(`${path}: number outside allowed range.`);
  }
  if (
    typeof value === "string" &&
    ((typeof schema.maxLength === "number" && value.length > schema.maxLength) ||
      (typeof schema.minLength === "number" && value.length < schema.minLength))
  )
    throw new Error(`${path}: text outside allowed length.`);
  if (Array.isArray(value)) {
    if (
      (typeof schema.maxItems === "number" && value.length > schema.maxItems) ||
      (typeof schema.minItems === "number" && value.length < schema.minItems)
    )
      throw new Error(`${path}: list outside allowed size.`);
    if (schema.items) value.forEach((v, i) => checkSchema(v, schema.items as JsonSchema, `${path}[${i}]`));
  } else if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    for (const key of (schema.required ?? []) as string[])
      if (object[key] === undefined) throw new Error(`${path}: missing ${key}.`);
    const props = (schema.properties ?? {}) as Record<string, JsonSchema>;
    for (const [key, child] of Object.entries(object)) {
      if (Object.hasOwn(props, key)) checkSchema(child, props[key], `${path}.${key}`);
      else if (schema.additionalProperties === false) throw new Error(`${path}: unknown field ${key}.`);
    }
  }
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
