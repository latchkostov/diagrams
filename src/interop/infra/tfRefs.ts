import { isMap, own } from "./yaml";

// A Terraform plan's `configuration` (docs/research/imports.md § Mapping: Terraform): which resource each attribute
// refers to. Expressions are never evaluated; only their `references` are read, and `constant_value` never is (a
// plan can hold a password there). A reference into a module's variable or out of its output is followed through
// the module call, with every step cached, cycles cut where they close, and a budget for the whole import.

export const TF_LIMITS = {
  /** Modules nested deeper than this aren't read (listed). */
  maxModuleDepth: 32,
  /** Values visited while collecting references, for the whole import. */
  maxVisits: 1_000_000,
  /** Steps taken to follow references through modules, for the whole import. */
  maxSteps: 200_000,
  /** Resources one reference can stand for (a module output of a list, say). */
  maxTargets: 500,
  /** References followed one inside another (a variable into an output into a variable…). */
  maxChain: 256,
  /** Expressions are nested blocks at most this deep. */
  maxExpressionDepth: 16,
  maxRefLength: 512,
} as const;

/** Attribute → the references in it (nested blocks under their top-level name). */
export type Refs = Map<string, string[]>;

interface ModuleConfig {
  /** Local address ("aws_sqs_queue.orders", "data.aws_iam_policy_document.x") → its references. */
  resources: Map<string, Refs>;
  /** Module call → its inputs' references, read in this module. */
  calls: Map<string, Refs>;
  /** Output → the references in its expression, read in this module. */
  outputs: Map<string, string[]>;
}

/** The budget shared by everything one import reads. */
export interface RefBudget {
  visits: number;
  steps: number;
  /** Set once a budget ran out: the report says so. */
  exhausted?: boolean;
}

export const newRefBudget = (): RefBudget => ({ visits: 0, steps: 0 });

/** `module.a["x"].module.b[0]` → `module.a.module.b`: the configuration's path, without instance keys. */
export function configPath(address: string): string {
  let out = "";
  let depth = 0;
  let quote = false;
  for (let i = 0; i < address.length && i < 4_096; i++) {
    const c = address[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === '"') quote = false;
    } else if (c === '"' && depth) quote = true;
    else if (c === "[") depth++;
    else if (c === "]") depth = Math.max(0, depth - 1);
    else if (!depth) out += c;
  }
  return out;
}

/** Own keys, at most `max`: past that the budget is spent, and the report says some references weren't read. */
function keysUpTo(obj: Record<string, unknown>, max: number, budget: RefBudget): string[] {
  const keys = Object.keys(obj);
  if (keys.length > max) budget.exhausted = true;
  return keys.slice(0, max);
}

/** The references in one resource's (or call's) expressions, by top-level attribute. Iterative and bounded. */
export function collectRefs(expressions: unknown, budget: RefBudget): Refs {
  const out: Refs = new Map();
  if (!isMap(expressions)) return out;
  for (const attr of keysUpTo(expressions, 1_000, budget)) {
    const refs: string[] = [];
    const stack: [unknown, number][] = [[expressions[attr], 0]];
    while (stack.length) {
      const [v, depth] = stack.pop()!;
      if (++budget.visits > TF_LIMITS.maxVisits) {
        budget.exhausted = true;
        break;
      }
      if (depth > TF_LIMITS.maxExpressionDepth || typeof v !== "object" || v === null) continue;
      if (Array.isArray(v)) {
        for (const item of v) stack.push([item, depth + 1]);
        continue;
      }
      for (const key of Object.keys(v)) {
        // A literal's value is never read: it may be a password.
        if (key === "constant_value") continue;
        const child = (v as Record<string, unknown>)[key];
        if (key === "references" && Array.isArray(child)) {
          for (const r of child)
            if (typeof r === "string" && r.length <= TF_LIMITS.maxRefLength && refs.length < 2_000) refs.push(r);
        } else stack.push([child, depth + 1]);
      }
    }
    if (refs.length) out.set(attr, refs);
  }
  return out;
}

/** What a reference names, with instance keys and attributes dropped. */
type Ref =
  | { kind: "resource"; address: string }
  | { kind: "var"; name: string }
  | { kind: "module"; name: string; output?: string };

const IDENT = /^[A-Za-z_][\w-]{0,127}$/;
const TYPE = /^[a-z][a-z0-9_]{0,127}$/;
const NOT_RESOURCES = new Set(["local", "each", "count", "path", "terraform", "self"]);

export function parseRef(ref: string): Ref | undefined {
  const parts = configPath(ref).split(".");
  const [a, b, c] = parts;
  if (!a || !b) return undefined;
  if (a === "var") return IDENT.test(b) ? { kind: "var", name: b } : undefined;
  if (a === "module")
    return IDENT.test(b) ? { kind: "module", name: b, ...(c && IDENT.test(c) ? { output: c } : {}) } : undefined;
  if (a === "data")
    return c && TYPE.test(b) && IDENT.test(c) ? { kind: "resource", address: `data.${b}.${c}` } : undefined;
  if (NOT_RESOURCES.has(a) || !TYPE.test(a) || !a.includes("_") || !IDENT.test(b)) return undefined;
  return { kind: "resource", address: `${a}.${b}` };
}

/** `module.a.module.b` → `module.a`, and the call's name `b`. */
const parentOf = (path: string): [string, string] | undefined => {
  const i = path.lastIndexOf("module.");
  return i < 0 ? undefined : [path.slice(0, Math.max(0, i - 1)), path.slice(i + "module.".length)];
};

/** One file's configuration: modules by path, and a cached reference resolver. */
export class TfConfig {
  readonly modules = new Map<string, ModuleConfig>();
  /** Module paths not read (nested too deeply). */
  readonly tooDeep: string[] = [];
  private readonly memo = new Map<string, readonly string[]>();
  private readonly busy = new Set<string>();
  private chain = 0;

  constructor(
    configuration: unknown,
    private readonly budget: RefBudget,
  ) {
    const stack: [unknown, string, number][] = [[own(configuration, "root_module"), "", 0]];
    while (stack.length) {
      const [mod, path, depth] = stack.pop()!;
      if (!isMap(mod) || this.modules.has(path)) continue;
      if (depth > TF_LIMITS.maxModuleDepth) {
        if (this.tooDeep.length < 100) this.tooDeep.push(path);
        continue;
      }
      const m: ModuleConfig = { resources: new Map(), calls: new Map(), outputs: new Map() };
      this.modules.set(path, m);
      const resources = own(mod, "resources");
      for (const r of Array.isArray(resources) ? resources : []) {
        const address = own(r, "address");
        if (typeof address !== "string" || address.length > 512) continue;
        const refs = collectRefs(own(r, "expressions"), budget);
        // `depends_on` is an explicit dependency: read like a reference.
        const deps = own(r, "depends_on");
        if (Array.isArray(deps)) {
          const named = deps.filter((d): d is string => typeof d === "string" && d.length <= TF_LIMITS.maxRefLength);
          if (named.length) refs.set("depends_on", named.slice(0, 200));
        }
        m.resources.set(address, refs);
      }
      const outputs = own(mod, "outputs");
      if (isMap(outputs))
        for (const name of keysUpTo(outputs, 2_000, budget)) {
          const refs = collectRefs({ value: own(outputs[name], "expression") }, budget).get("value");
          if (refs) m.outputs.set(name, refs);
        }
      const calls = own(mod, "module_calls");
      if (isMap(calls))
        for (const name of keysUpTo(calls, 2_000, budget)) {
          if (!IDENT.test(name)) continue;
          m.calls.set(name, collectRefs(own(calls[name], "expressions"), budget));
          stack.push([own(calls[name], "module"), path ? `${path}.module.${name}` : `module.${name}`, depth + 1]);
        }
    }
  }

  /** A resource's references by attribute, if the configuration has it. */
  refsOf(path: string, address: string): Refs | undefined {
    return this.modules.get(path)?.resources.get(address);
  }

  /**
   * The resources `ref`, read in module `path`, stands for: `path\u0001address` keys. A variable is followed to
   * its module call in the parent, a module output into the module. Cached; a cycle resolves to nothing.
   */
  resolve(path: string, ref: string): readonly string[] {
    const parsed = parseRef(ref);
    if (!parsed) return [];
    const id = `${path}\u0002${parsed.kind}\u0002${"address" in parsed ? parsed.address : `${parsed.name}.${"output" in parsed ? (parsed.output ?? "") : ""}`}`;
    const cached = this.memo.get(id);
    if (cached) return cached;
    if (this.busy.has(id)) return [];
    if (++this.budget.steps > TF_LIMITS.maxSteps || this.chain >= TF_LIMITS.maxChain) {
      this.budget.exhausted = true;
      return [];
    }
    this.busy.add(id);
    this.chain++;
    const out = new Set<string>();
    const add = (keys: readonly string[]) => {
      for (const k of keys) if (out.size < TF_LIMITS.maxTargets) out.add(k);
    };
    if (parsed.kind === "resource") out.add(`${path}\u0001${parsed.address}`);
    else if (parsed.kind === "var") {
      const parent = parentOf(path);
      const inputs = parent && this.modules.get(parent[0])?.calls.get(parent[1])?.get(parsed.name);
      if (parent && inputs) for (const r of inputs) add(this.resolve(parent[0], r));
    } else {
      const child = path ? `${path}.module.${parsed.name}` : `module.${parsed.name}`;
      const outputs = this.modules.get(child)?.outputs;
      if (outputs)
        for (const [name, refs] of outputs)
          if (!parsed.output || parsed.output === name) for (const r of refs) add(this.resolve(child, r));
    }
    this.busy.delete(id);
    this.chain--;
    const result = [...out];
    this.memo.set(id, result);
    return result;
  }
}
