import { MAX_VALUE } from "./settings";
import { list, own, str } from "./yaml";

// A Kubernetes container's environment, as the kubelet builds it (docs/research/imports.md § Connections from
// settings): each container on its own; `envFrom` sources in order, a later one overriding an earlier one; then
// `env`, which overrides them all; `$(VAR)` expanded once, from the variables before it. ConfigMap values are read
// in memory to find hosts. A Secret's values never are: its keys only mark the settings it overrides as unknown.

/** A setting whose value can't be known (from a Secret, a field reference, or past a budget). */
export const OPAQUE = "\u0000";

export const ENV_LIMITS = {
  /** `$(VAR)` references expanded in one value. */
  maxReferences: 64,
  /** Settings materialized for one import, across every container: ConfigMaps shared by many workloads count each time. */
  maxSettings: 100_000,
} as const;

/** What a container's environment reads from the files. */
export interface EnvSources {
  /** A ConfigMap's `data`, when it's in the files. */
  configMap(name: string): Record<string, unknown> | undefined;
  /** A Secret's key names (`data` and `stringData`), when it's in the files. Never its values. */
  secretKeys(name: string): string[] | undefined;
}

/** The budget an import shares: settings materialized so far. */
export interface EnvBudget {
  left: number;
  /** Set once the budget ran out: some settings weren't read. */
  exhausted?: boolean;
}

export const newEnvBudget = (): EnvBudget => ({ left: ENV_LIMITS.maxSettings });

/**
 * `$(VAR)` from the variables before it; `$$` is a literal `$`; an undefined variable stays as written. The output
 * is bounded before anything is built: a value that would pass MAX_VALUE characters, take more than
 * `maxReferences` substitutions, or include an unknown value is OPAQUE. Expansion is one pass, as in Kubernetes:
 * an expanded value is never expanded again.
 */
export function expandVars(value: string, env: ReadonlyMap<string, string>): string {
  if (value.length > MAX_VALUE) return OPAQUE;
  if (!value.includes("$")) return value;
  let out = "";
  let refs = 0;
  let i = 0;
  const append = (piece: string) => {
    if (out.length + piece.length > MAX_VALUE) return false;
    out += piece;
    return true;
  };
  while (i < value.length) {
    const dollar = value.indexOf("$", i);
    if (dollar < 0) {
      if (!append(value.slice(i))) return OPAQUE;
      break;
    }
    if (!append(value.slice(i, dollar))) return OPAQUE;
    if (value[dollar + 1] === "$") {
      if (!append("$")) return OPAQUE;
      i = dollar + 2;
      continue;
    }
    const close = value[dollar + 1] === "(" ? value.indexOf(")", dollar + 2) : -1;
    const name = close > 0 ? value.slice(dollar + 2, close) : "";
    if (!name || name.length > 256 || !/^[A-Za-z_][\w.-]*$/.test(name)) {
      if (!append("$")) return OPAQUE;
      i = dollar + 1;
      continue;
    }
    if (++refs > ENV_LIMITS.maxReferences) return OPAQUE;
    const resolved = env.get(name);
    if (resolved === OPAQUE) return OPAQUE;
    if (!append(resolved ?? value.slice(dollar, close + 1))) return OPAQUE;
    i = close + 1;
  }
  return out;
}

/**
 * One container's settings, name → value (OPAQUE when unknown). Undefined when the import's budget ran out
 * part-way: a partial environment could keep a value a later source overrides, so none of it is used.
 */
export function containerEnv(
  container: unknown,
  sources: EnvSources,
  budget: EnvBudget,
): Map<string, string> | undefined {
  const env = new Map<string, string>();
  const set = (name: string, value: string) => {
    if (--budget.left < 0) return false;
    env.set(name, value);
    return true;
  };
  const fail = () => {
    budget.exhausted = true;
    return undefined;
  };
  for (const ef of list(own(container, "envFrom"))) {
    const prefix = str(own(ef, "prefix")) ?? "";
    const cm = str(own(own(ef, "configMapRef"), "name"));
    const data = cm ? sources.configMap(cm) : undefined;
    if (data)
      for (const k of Object.keys(data)) {
        const v = str(data[k]);
        if (v !== undefined && !set(prefix + k, v.length > MAX_VALUE ? OPAQUE : v)) return fail();
      }
    const secret = str(own(own(ef, "secretRef"), "name"));
    // A later Secret overrides what came before, with a value that is never read.
    for (const k of (secret && sources.secretKeys(secret)) || []) if (!set(prefix + k, OPAQUE)) return fail();
  }
  for (const e of list(own(container, "env"))) {
    const name = str(own(e, "name"));
    if (!name) continue;
    const value = str(own(e, "value"));
    const cmRef = own(own(e, "valueFrom"), "configMapKeyRef");
    const cm = str(own(cmRef, "name"));
    const key = str(own(cmRef, "key"));
    const fromConfig = cm && key ? str(own(sources.configMap(cm), key)) : undefined;
    // `env` beats `envFrom`. A Secret, a field or a resource reference is a value we don't know.
    const resolved =
      value !== undefined
        ? expandVars(value, env)
        : fromConfig !== undefined && fromConfig.length <= MAX_VALUE
          ? fromConfig
          : OPAQUE;
    if (!set(name, resolved)) return fail();
  }
  return env;
}

/** The settings worth reading for connections: known values only. */
export function* knownSettings(env: ReadonlyMap<string, string>): Iterable<readonly [string, string]> {
  for (const [name, value] of env) if (!value.includes(OPAQUE)) yield [name, value];
}
