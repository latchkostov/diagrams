/** A processor's message rules as the engine, type analysis and planning read them (identity: ./messageRules). */
export interface MessageRule {
  id?: string;
  receives: string;
  sends: string;
}

export type Emits = string | Record<string, string> | MessageRule[];

export const validRule = (rule: unknown): rule is MessageRule =>
  !!rule && typeof (rule as MessageRule).receives === "string" && typeof (rule as MessageRule).sends === "string";

// The sanitized legacy lookup table, never the authored object: IDs never change behavior or random draws.
// One table per (immutable) rule list or map.
const mappings = new WeakMap<object, Record<string, string>>();
export function emitsMapping(emits: unknown): string | Record<string, string> | undefined {
  if (typeof emits === "string") return emits;
  if (!emits || typeof emits !== "object") return undefined;
  let mapping = mappings.get(emits);
  if (!mapping)
    mappings.set(
      emits,
      (mapping = Object.fromEntries(
        Array.isArray(emits)
          ? emits.filter(validRule).map((rule) => [rule.receives, rule.sends])
          : Object.entries(emits).filter((entry) => typeof entry[1] === "string"),
      )),
    );
  return mapping;
}
