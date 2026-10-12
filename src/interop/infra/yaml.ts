import { parseAllDocuments, type DocumentOptions, type ParseOptions, type SchemaOptions } from "yaml";
import { LIMITS } from "../native";

// YAML for every infrastructure reader, read as untrusted input (docs/research/imports.md § Security). The
// `yaml` package counts how far aliases *expand*, so a "billion laughs" file fails fast; the core schema has
// no custom tags, so `!!js/function` stays a string. The result is then walked iteratively with the native
// validator's depth limit and a node budget, so even an object graph that passed the parser can't run away.

/** An error whose message is meant for the person importing. */
export class ImportError extends Error {
  override name = "ImportError";
}

export const YAML_LIMITS = {
  maxAliasCount: 100,
  maxDocuments: 2_000,
  maxNodes: 200_000,
  maxDepth: LIMITS.maxDepth,
} as const;

export const TOO_MANY_ALIASES =
  "This file has too many aliases (it could expand to millions of values), so it wasn't read.";

const OPTIONS: ParseOptions & DocumentOptions & SchemaOptions = {
  merge: true,
  uniqueKeys: true,
  schema: "core",
  customTags: [],
  prettyErrors: true,
};

/** Every document in `text` as plain data. Throws ImportError with a readable message. */
export function readYaml(text: string, fileName: string): unknown[] {
  let docs;
  try {
    docs = parseAllDocuments(text, OPTIONS);
  } catch {
    throw new ImportError(`${fileName} couldn't be read as YAML.`);
  }
  const list = Array.isArray(docs) ? docs : [docs];
  if (list.length > YAML_LIMITS.maxDocuments)
    throw new ImportError(`${fileName} has more than ${YAML_LIMITS.maxDocuments.toLocaleString("en")} documents.`);
  const out: unknown[] = [];
  for (const doc of list) {
    const err = doc.errors[0];
    if (err) {
      const [line, col] = err.linePos?.[0] ? [err.linePos[0].line, err.linePos[0].col] : [];
      const what = err.message.split("\n")[0].replace(/ at line \d+, column \d+:?$/, "");
      throw new ImportError(`${fileName} isn't valid YAML${line ? ` (line ${line}, column ${col})` : ""}: ${what}`);
    }
    let value: unknown;
    try {
      value = doc.toJS({ maxAliasCount: YAML_LIMITS.maxAliasCount });
    } catch (e) {
      if (e instanceof ReferenceError && /alias/i.test(e.message)) throw new ImportError(TOO_MANY_ALIASES);
      throw new ImportError(`${fileName} couldn't be read as YAML.`);
    }
    checkBudget(value);
    if (value !== null && value !== undefined) out.push(value);
  }
  return out;
}

/** Iterative walk: depth and node count, never recursion. */
export function checkBudget(value: unknown): void {
  const stack: [unknown, number][] = [[value, 0]];
  let seen = 0;
  while (stack.length) {
    const [v, depth] = stack.pop()!;
    if (++seen > YAML_LIMITS.maxNodes) throw new ImportError("This file holds too many values to read.");
    if (typeof v !== "object" || v === null) continue;
    if (depth >= YAML_LIMITS.maxDepth) throw new ImportError("This file is nested too deeply to read.");
    for (const child of Array.isArray(v) ? v : Object.values(v)) stack.push([child, depth + 1]);
  }
}

// ---------------------------------------------------------------- reading parsed data safely

/** Parsed data is never spread or merged into our own objects: read own keys only. */
export const isMap = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function own(obj: unknown, key: string): unknown {
  return isMap(obj) && Object.hasOwn(obj, key) ? obj[key] : undefined;
}

export const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : undefined;

export const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** A fresh map with no prototype: keys like `__proto__` from a file stay plain keys. */
export const bare = (): Record<string, unknown> => Object.create(null) as Record<string, unknown>;
