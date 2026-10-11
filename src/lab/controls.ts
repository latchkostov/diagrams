import type { ControlDef, ControlValue, ControlValues } from "./types";

/** Query params the Lab reserves; control keys must not use them. */
export const RESERVED_PARAMS = new Set(["view", "preset", "example", "present"]);

export function defaultsOf(controls: readonly ControlDef[] = []): ControlValues {
  return Object.fromEntries(controls.map((c) => [c.key, c.default]));
}

/** Parses a raw string (from the URL or an input) for a control; invalid input falls back to the default. */
export function coerce(def: ControlDef, raw: string | null | undefined): ControlValue {
  if (raw == null) return def.default;
  switch (def.type) {
    case "number": {
      const n = Number(raw);
      if (raw.trim() === "" || !Number.isFinite(n)) return def.default;
      return clamp(n, def.min, def.max);
    }
    case "boolean":
      return raw === "1" || raw === "true" ? true : raw === "0" || raw === "false" ? false : def.default;
    case "select":
      return def.options.some((o) => o.value === raw) ? raw : def.default;
    case "text":
      return raw;
  }
}

export function clamp(n: number, min = -Infinity, max = Infinity) {
  return Math.min(max, Math.max(min, n));
}

/** Control values for a preset from a query string. Unknown params are ignored. */
export function readValues(controls: readonly ControlDef[] = [], params: URLSearchParams): ControlValues {
  return Object.fromEntries(controls.map((c) => [c.key, coerce(c, params.get(c.key))]));
}

export function encodeValue(v: ControlValue): string {
  return typeof v === "boolean" ? (v ? "1" : "0") : String(v);
}

/**
 * Writes a preset + its non-default control values into `params` (mutates and returns it).
 * Defaults are omitted so links stay short; keys in `keep` (e.g. theme) are left untouched.
 */
export function writeValues(
  params: URLSearchParams,
  presetId: string,
  controls: readonly ControlDef[] = [],
  values: ControlValues,
  keep: ReadonlySet<string> = new Set(),
): URLSearchParams {
  for (const k of [...params.keys()]) if (!RESERVED_PARAMS.has(k) && !keep.has(k)) params.delete(k);
  params.set("view", "lab");
  params.set("preset", presetId);
  for (const c of controls) {
    const v = values[c.key];
    if (v !== undefined && v !== c.default) params.set(c.key, encodeValue(v));
  }
  return params;
}
