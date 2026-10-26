import type { PatchValue, PathLiteral, PathSegment, PropPatch, PropPath } from "./types";

/**
 * Paths into props, for prop checks and edit-preserving demo patches (types.ts: PropPath, PropPatch). Pure and data
 * only: a path reads own properties, never the prototype, and a patch returns new objects along its path, so whatever
 * else the learner has stays the same object and value.
 */

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
/** Keys a path never reads or writes, whatever the props say. */
export const UNSAFE_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

export const equal = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>,
    right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && equal(left[key], right[key]))
  );
};

/** A value as written: catalog messages in the current language. */
export const resolve = (value: PatchValue): unknown =>
  typeof value === "function"
    ? value()
    : Array.isArray(value)
      ? value.map(resolve)
      : isRecord(value)
        ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v as PatchValue)]))
        : value;

const matches = (item: unknown, match: Readonly<Record<string, PathLiteral>>) =>
  isRecord(item) &&
  Object.entries(match).every(([key, value]) => Object.hasOwn(item, key) && equal(item[key], resolve(value)));

/** The index a list segment names in `list`, or -1. */
const indexIn = (list: readonly unknown[], segment: Exclude<PathSegment, string>) =>
  typeof segment === "number"
    ? Number.isInteger(segment) && segment >= 0 && segment < list.length
      ? segment
      : -1
    : list.findIndex((item) => matches(item, segment.where));

/** The value at the path, or undefined when any step of it isn't there. */
export function readPath(props: unknown, path: PropPath): unknown {
  let value = props;
  for (const segment of path) {
    if (typeof segment === "string") {
      if (!isRecord(value) || UNSAFE_KEYS.has(segment) || !Object.hasOwn(value, segment)) return undefined;
      value = value[segment];
    } else {
      if (!Array.isArray(value)) return undefined;
      const i = indexIn(value, segment);
      if (i < 0) return undefined;
      value = value[i];
    }
  }
  return value;
}

const SKIP = Symbol("unchanged");
type Edit = (current: unknown) => unknown;

/** `container` with `edit` applied at `path`, copied only along it; SKIP when it can't be reached or doesn't change. */
function update(container: unknown, path: readonly PathSegment[], edit: Edit): unknown {
  if (!path.length) return edit(container);
  const [head, ...rest] = path;
  if (typeof head === "string") {
    if ((container !== undefined && !isRecord(container)) || UNSAFE_KEYS.has(head)) return SKIP;
    const base = container ?? {};
    const next = update(Object.hasOwn(base, head) ? base[head] : undefined, rest, edit);
    return next === SKIP ? SKIP : { ...base, [head]: next };
  }
  if (!Array.isArray(container)) return SKIP;
  const i = indexIn(container, head);
  if (i < 0) return SKIP;
  const next = update(container[i], rest, edit);
  return next === SKIP ? SKIP : container.map((item, n) => (n === i ? next : item));
}

const edits: { [K in PropPatch["op"]]: (patch: Extract<PropPatch, { op: K }>) => Edit } = {
  set: (patch) => (current) => {
    const value = resolve(patch.value);
    return equal(current, value) ? SKIP : value;
  },
  setIfMissing: (patch) => (current) => (current === undefined ? resolve(patch.value) : SKIP),
  ensureItem: (patch) => (current) => {
    if (current !== undefined && !Array.isArray(current)) return SKIP;
    const list = current ?? [];
    if (list.some((item) => matches(item, patch.match))) return SKIP;
    return [...list, resolve({ ...patch.match, ...patch.with })];
  },
  atLeast: (patch) => (current) => (typeof current === "number" && current < patch.value ? patch.value : SKIP),
};

/**
 * The top-level props these patches change, ready for the editor's shallow-merging setNodeProps / setEdgeProps, or null
 * when nothing is missing. Applying it again changes nothing.
 */
export function patchProps(
  props: Readonly<Record<string, unknown>> | undefined,
  patches: readonly PropPatch[],
): Record<string, unknown> | null {
  const before = props ?? {};
  let next: Record<string, unknown> = { ...before };
  for (const patch of patches) {
    const edit = (edits[patch.op] as (p: PropPatch) => Edit)(patch);
    const result = update(next, patch.path, edit);
    if (result !== SKIP) next = result as Record<string, unknown>;
  }
  const changed = Object.keys(next).filter((key) => next[key] !== before[key]);
  return changed.length ? Object.fromEntries(changed.map((key) => [key, next[key]])) : null;
}
