export type JsonSchema = Record<string, unknown>;

/** The small JSON Schema vocabulary used by our tools, also enforced for flat model replies. */
export function checkJsonSchema(
  value: unknown,
  schema: JsonSchema,
  path = "input",
  definitions: Record<string, JsonSchema> = {},
): void {
  if (schema.$ref) {
    const name = String(schema.$ref).split("/").pop()!;
    return checkJsonSchema(value, definitions[name], path, definitions);
  }
  if (schema.oneOf || schema.anyOf) {
    for (const variant of (schema.oneOf ?? schema.anyOf) as JsonSchema[]) {
      try {
        checkJsonSchema(value, variant, path, definitions);
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
    if (schema.items)
      value.forEach((v, i) => checkJsonSchema(v, schema.items as JsonSchema, `${path}[${i}]`, definitions));
  } else if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    for (const key of (schema.required ?? []) as string[])
      if (object[key] === undefined) throw new Error(`${path}: missing ${key}.`);
    const props = (schema.properties ?? {}) as Record<string, JsonSchema>;
    for (const [key, child] of Object.entries(object)) {
      if (Object.hasOwn(props, key)) {
        if (child !== undefined) checkJsonSchema(child, props[key], `${path}.${key}`, definitions);
      } else if (schema.additionalProperties === false) throw new Error(`${path}: unknown field ${key}.`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object")
        checkJsonSchema(child, schema.additionalProperties as JsonSchema, `${path}.${key}`, definitions);
    }
  }
}
