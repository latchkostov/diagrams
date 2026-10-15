// The golden printer: deterministic, readable JSON. Small objects and arrays sit on one line (up to WIDTH
// characters), and so does a record (an object of plain values: a trace step, a route) up to RECORD_WIDTH, so a
// changed value is a one-line diff; anything bigger is one value per line. Key order is the
// value's own (it is part of the output: findings, exports and reports keep their order).
//
// JSON has no Infinity, NaN or undefined. Capacity analysis reports Infinity ("can't keep up at all"), so
// non-finite numbers print as the strings "Infinity", "-Infinity" and "NaN" rather than JSON's lossy null.
// Undefined object properties are left out (as JSON.stringify does); undefined in an array is an error,
// since it can't round-trip. -0 prints as 0. Maps, Sets, class instances and functions are errors: a collector
// must say how it wants them recorded.

const WIDTH = 120;
/** A record (a trace step, a beat, a route, a row) may run this long on its one line. */
const RECORD_WIDTH = 400;

/** A number as the golden records it. */
export function numberText(n: number): string {
  if (Number.isNaN(n)) return '"NaN"';
  if (n === Infinity) return '"Infinity"';
  if (n === -Infinity) return '"-Infinity"';
  if (Object.is(n, -0)) return "0";
  return JSON.stringify(n);
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function scalar(value: unknown, path: string): string | undefined {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number":
      return numberText(value);
    case "boolean":
      return value ? "true" : "false";
    case "bigint":
    case "function":
    case "symbol":
      throw new Error(`stable: ${typeof value} at ${path || "(root)"} can't be recorded`);
    default:
      return undefined;
  }
}

function entries(value: object, path: string): [string, unknown][] {
  if (Array.isArray(value)) {
    return value.map((item, i) => {
      if (item === undefined) throw new Error(`stable: undefined in an array at ${path}[${i}]`);
      return [String(i), item];
    });
  }
  if (!isPlainObject(value)) {
    const name = (value as { constructor?: { name?: string } }).constructor?.name ?? "object";
    throw new Error(`stable: a ${name} at ${path || "(root)"}: convert it to plain data first`);
  }
  return Object.entries(value).filter(([, v]) => v !== undefined);
}

/** One line, or undefined when it doesn't fit in `room` characters. */
function inline(value: unknown, path: string, room: number): string | undefined {
  const s = scalar(value, path);
  if (s !== undefined) return s;
  const obj = value as object;
  const items = entries(obj, path);
  const array = Array.isArray(obj);
  if (!items.length) return array ? "[]" : "{}";
  let out = array ? "[" : "{ ";
  for (const [i, [key, item]] of items.entries()) {
    const head = (i ? ", " : "") + (array ? "" : `${JSON.stringify(key)}: `);
    const text = inline(item, `${path}.${key}`, room - out.length - head.length);
    if (text === undefined) return undefined;
    out += head + text;
    if (out.length > room) return undefined;
  }
  out += array ? "]" : " }";
  return out.length <= room ? out : undefined;
}

/** A record: a plain object whose values are scalars or arrays of scalars (a trace step, a beat, a row). */
function isRecord(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value) || !isPlainObject(value)) return false;
  return Object.values(value).every(
    (v) =>
      v === null || typeof v !== "object" || (Array.isArray(v) && v.every((x) => x === null || typeof x !== "object")),
  );
}

function print(value: unknown, path: string, indent: string, lead: number): string {
  const one = inline(value, path, WIDTH - indent.length - lead);
  if (one !== undefined) return one;
  const obj = value as object;
  const array = Array.isArray(obj);
  const inner = indent + "  ";
  const lines = entries(obj, path).map(([key, item]) => {
    const head = array ? "" : `${JSON.stringify(key)}: `;
    // A record stays on one line even past the width (up to RECORD_WIDTH): one row, one line.
    const row = isRecord(item) ? inline(item, `${path}.${key}`, RECORD_WIDTH) : undefined;
    return inner + head + (row ?? print(item, `${path}.${key}`, inner, head.length + 1));
  });
  return `${array ? "[" : "{"}\n${lines.join(",\n")}\n${indent}${array ? "]" : "}"}`;
}

/** The golden text of a value, with a final newline. */
export function stable(value: unknown): string {
  return print(value, "", "", 0) + "\n";
}

/** Rounds every number in a value to the nearest `step` (only for the browser tier's measured geometry). */
export function roundTo<T>(value: T, step: number): T {
  if (typeof value === "number") return (Number.isFinite(value) ? Math.round(value / step) * step + 0 : value) as T;
  if (Array.isArray(value)) return value.map((v: unknown) => roundTo(v, step)) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, roundTo(v, step)])) as T;
  return value;
}
