import * as Y from "yjs";
import { validateDiagram } from "../interop/native";
import { DIAGRAM_FORMAT, type DiagramFile } from "../model/types";
import { COLLAB_LIMITS } from "./limits";

// The diagram as shared Yjs state (docs/research/collaboration.md, "Map the Live Diagrams model to shared state").
//
// Shared, every one a root type (roots never conflict on creation, unlike nested containers two peers might create
// at once):
//   meta                 Y.Map: title, description, color, direction, format, planning, checks, layerOrder and any
//                        unknown top-level field, each one atomic value.
//   nodes, edges, groups, annotations, simulations
//                        Y.Map<id, Y.Map>: one map of fields per record, keyed by its stable id.
//   <kind>.order         Y.Array<id>: the file's order of each list (simulation and layer order depend on it).
//
// Inside a record map, a field is one atomic value under its own name, except:
//   @xy                  a node's {x, y}: a move is one value, never x from one peer and y from another.
//   @box                 a boundary's or annotation's {x, y, width, height}: move and resize as one.
//   @ends                an edge's {from, to}: a reconnect keeps both ends together.
//   @props               nodes' and edges' props: a nested Y.Map, one value per key, so two people changing
//                        different settings of one node both keep theirs.
//   @@name               a field whose own name starts with "@" (escaped).
//
// Never shared: `private` (sticky, local provenance: a remote peer can't clear it), the view, selection, inspector
// and panels (each person's own), AI conversations and save destinations.
//
// The projection back to a DiagramFile is deterministic, so peers with the same state show the same diagram:
// records in list order (first occurrence; ids missing from the order follow, sorted), fields in a fixed order,
// edges whose ends don't exist hidden (their records kept), and the result checked by the same validator as an
// imported file. A state that fails it (two people's additions together past the 5,000-node limit, a hostile
// value) is reported as invalid on every peer alike; the last valid diagram stays on screen and the records stay
// in the room for recovery. Nothing is "repaired" by order-dependent truncation.

export const RECORD_KINDS = ["nodes", "edges", "groups", "annotations", "simulations"] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

export const META = "meta";
export const orderRoot = (kind: RecordKind) => `${kind}.order`;
/** Every root a room's document may have. An update naming any other root is refused (./guard.ts). */
export const ROOT_NAMES: ReadonlySet<string> = new Set([META, ...RECORD_KINDS, ...RECORD_KINDS.map(orderRoot)]);

/** Top-level fields that are not meta values. */
const NOT_META = new Set<string>([...RECORD_KINDS, "private"]);

interface Geometry {
  key: string;
  fields: readonly string[];
}
export const GEOMETRY: Record<RecordKind, Geometry | undefined> = {
  nodes: { key: "@xy", fields: ["x", "y"] },
  groups: { key: "@box", fields: ["x", "y", "width", "height"] },
  annotations: { key: "@box", fields: ["x", "y", "width", "height"] },
  edges: { key: "@ends", fields: ["from", "to"] },
  simulations: undefined,
};
export const PROPS_KEY = "@props";
export const hasNestedProps = (kind: RecordKind) => kind === "nodes" || kind === "edges";

/** Field order in a projected record (the rest follow, sorted): the editor's own export order. */
const FIELD_ORDER: Record<RecordKind, readonly string[]> = {
  nodes: ["id", "stencil", "label", "sublabel", "x", "y", "group", "props"],
  edges: ["id", "from", "to", "label", "kind", "relation", "relationOrigin", "sourceSide", "targetSide", "props"],
  groups: ["id", "label", "tone", "x", "y", "width", "height", "group"],
  annotations: ["id", "kind", "text", "shape", "color", "textSize", "x", "y", "width", "height", "group"],
  simulations: [
    "id",
    "title",
    "description",
    "seed",
    "scale",
    "multipliers",
    "durationMs",
    "setup",
    "traffic",
    "timeline",
    "expectations",
  ],
};
const META_ORDER = ["format", "planning", "title", "description", "color", "direction"];
const TAIL_ORDER = ["simulations", "annotations", "layerOrder", "checks"];

export const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" &&
  v !== null &&
  !Array.isArray(v) &&
  !(v instanceof Uint8Array) &&
  !(v instanceof Y.AbstractType);

/** A JSON copy (drops undefined and functions; non-finite numbers become null), so no shared state aliases the caller's. */
export const jsonClone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

export const escapeField = (name: string) => (name.startsWith("@") ? `@${name}` : name);
/** The field a map key stores, or undefined for a reserved key. */
export const unescapeField = (key: string): string | undefined =>
  key.startsWith("@@") ? key.slice(1) : key.startsWith("@") ? undefined : key;

export const recordsOf = (doc: Y.Doc, kind: RecordKind) => doc.getMap<unknown>(kind);
export const orderOf = (doc: Y.Doc, kind: RecordKind) => doc.getArray<unknown>(orderRoot(kind));
export const metaOf = (doc: Y.Doc) => doc.getMap<unknown>(META);

/** A record's fields as a new Y.Map (for a put). */
export function recordMap(kind: RecordKind, record: Record<string, unknown>): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  writeFields(map, kind, record, Object.keys(record), []);
  return map;
}

/**
 * Sets `fields` of `record` on a record map and removes `unset` (field names). Geometry fields are written as one
 * atomic value, completed from the map's current geometry when only some of them change.
 */
export function writeFields(
  map: Y.Map<unknown>,
  kind: RecordKind,
  record: Record<string, unknown>,
  fields: readonly string[],
  unset: readonly string[],
): void {
  const geometry = GEOMETRY[kind];
  let geo: Record<string, unknown> | undefined;
  const touchGeo = (name: string, value: unknown) => {
    // A map not yet in a document (a new record) has no current geometry to read.
    const current = map.doc ? map.get(geometry!.key) : undefined;
    geo ??= { ...(isPlainObject(current) ? current : {}) };
    geo = Object.fromEntries(Object.entries({ ...geo, [name]: jsonClone(value) }).filter(([, v]) => v !== undefined));
  };
  for (const name of fields) {
    if (name === "id") continue;
    const value = record[name];
    if (geometry?.fields.includes(name)) touchGeo(name, value);
    else if (name === "props" && hasNestedProps(kind) && isPlainObject(value)) {
      const props = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(value)) if (v !== undefined) props.set(k, jsonClone(v));
      map.set(PROPS_KEY, props);
      map.delete("props");
    } else if (value === undefined) map.delete(escapeField(name));
    else {
      if (name === "props") map.delete(PROPS_KEY);
      map.set(escapeField(name), jsonClone(value));
    }
  }
  for (const name of unset) {
    if (geometry?.fields.includes(name)) touchGeo(name, undefined);
    else if (name === "props") {
      map.delete(PROPS_KEY);
      map.delete("props");
    } else map.delete(escapeField(name));
  }
  if (geo) map.set(geometry!.key, geo);
}

/** Deep copy of a value read from shared state: consumers can never mutate what Yjs holds. */
function readValue(v: unknown): unknown {
  if (v instanceof Y.AbstractType) return undefined;
  return jsonClone(v);
}

const ordered = (fields: Record<string, unknown>, order: readonly string[]) => {
  const out: Record<string, unknown> = {};
  for (const k of order) if (k in fields) out[k] = fields[k];
  for (const k of Object.keys(fields).sort()) if (!(k in out)) out[k] = fields[k];
  return out;
};

/** One record map as a native record, or undefined when the shared value isn't a record at all. */
export function projectRecord(kind: RecordKind, id: string, value: unknown): Record<string, unknown> | undefined {
  if (!(value instanceof Y.Map)) return undefined;
  const geometry = GEOMETRY[kind];
  const fields: Record<string, unknown> = {};
  for (const [key, v] of value.entries()) {
    if (geometry && key === geometry.key) {
      if (!isPlainObject(v)) continue;
      for (const f of geometry.fields) if (f in v) fields[f] = readValue(v[f]);
    } else if (key === PROPS_KEY && hasNestedProps(kind)) {
      if (!(v instanceof Y.Map)) continue;
      const props: Record<string, unknown> = {};
      for (const k of [...v.keys()].sort()) {
        const pv = readValue(v.get(k));
        if (pv !== undefined) props[k] = pv;
      }
      if (Object.keys(props).length) fields.props = props;
    } else {
      const name = unescapeField(key);
      if (name === undefined || name === "id") continue;
      if (geometry?.fields.includes(name)) continue;
      const rv = readValue(v);
      if (rv !== undefined) fields[name] = rv;
    }
  }
  fields.id = id;
  return ordered(fields, FIELD_ORDER[kind]);
}

/** The ids of a list in projection order: the shared order (first occurrence), then the rest sorted. */
export function orderedIds(order: readonly unknown[], present: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of order) {
    if (typeof id !== "string" || seen.has(id) || !present.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  if (seen.size < present.size) {
    const rest = [...present].filter((id) => !seen.has(id)).sort();
    out.push(...rest);
  }
  return out;
}

export function projectMeta(meta: Y.Map<unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, v] of meta.entries()) {
    if (NOT_META.has(key) || key.startsWith("@") || key === "nodes" || key === "edges") continue;
    const rv = readValue(v);
    if (rv !== undefined) out[key] = rv;
  }
  return out;
}

export interface Assembled {
  /** The raw projection, before validation (what a recovery export keeps). */
  raw: Record<string, unknown>;
  /**
   * Records hidden from the diagram, their shared records kept: incomplete ones (a concurrent Undo can leave a
   * record without a field it needs: Yjs refuses to restore a map value that conflicts with another person's
   * change, so the key can end up empty), and edges with an end that doesn't exist (a concurrent delete).
   */
  hidden: string[];
}

const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
/** What a record needs before the validator sees it; anything less is hidden, the same on every peer. */
const COMPLETE: Record<RecordKind, (r: Record<string, unknown>) => boolean> = {
  nodes: (r) => typeof r.stencil === "string" && finite(r.x) && finite(r.y),
  groups: (r) => finite(r.x) && finite(r.y) && finite(r.width) && finite(r.height),
  annotations: (r) => typeof r.kind === "string" && finite(r.x) && finite(r.y) && finite(r.width) && finite(r.height),
  edges: (r) => typeof r.from === "string" && typeof r.to === "string",
  simulations: () => true,
};

/** Puts the parts together in the native shape: meta first, lists in their order, tail fields last. */
export function assemble(meta: Record<string, unknown>, all: Record<RecordKind, Record<string, unknown>[]>): Assembled {
  const hidden: string[] = [];
  const lists = Object.fromEntries(
    RECORD_KINDS.map((kind) => [
      kind,
      all[kind].filter((r) => {
        if (COMPLETE[kind](r)) return true;
        hidden.push(r.id as string);
        return false;
      }),
    ]),
  ) as Record<RecordKind, Record<string, unknown>[]>;
  const ends = new Set<string>();
  for (const n of lists.nodes) ends.add(n.id as string);
  for (const a of lists.annotations) ends.add(a.id as string);
  const edges = lists.edges.filter((e) => {
    const ok = ends.has(e.from as string) && ends.has(e.to as string);
    if (!ok) hidden.push(e.id as string);
    return ok;
  });
  const raw: Record<string, unknown> = {};
  for (const k of META_ORDER) if (k in meta) raw[k] = meta[k];
  if (!("format" in raw)) raw.format = DIAGRAM_FORMAT;
  if (!("title" in raw)) raw.title = "Untitled diagram";
  if (lists.groups.length) raw.groups = lists.groups;
  raw.nodes = lists.nodes;
  raw.edges = edges;
  if (lists.simulations.length) raw.simulations = lists.simulations;
  if (lists.annotations.length) raw.annotations = lists.annotations;
  for (const k of TAIL_ORDER) if (k in meta && !(k in raw)) raw[k] = meta[k];
  for (const k of Object.keys(meta).sort()) if (!(k in raw)) raw[k] = meta[k];
  return { raw, hidden };
}

export type Validated = { ok: true; diagram: DiagramFile; warnings: string[] } | { ok: false; error: string };

/** The same validator as every other way in (files, links, paste, storage). */
export function validateProjection(raw: Record<string, unknown>): Validated {
  return validateDiagram(raw);
}

/** Writes a whole diagram into an empty document (the room's creator, once). */
export function hydrate(doc: Y.Doc, d: DiagramFile): void {
  const meta = metaOf(doc);
  for (const [k, v] of Object.entries(d)) {
    if (NOT_META.has(k) || v === undefined) continue;
    meta.set(k, jsonClone(v));
  }
  for (const kind of RECORD_KINDS) {
    const list = (d[kind] ?? []) as unknown as Record<string, unknown>[];
    const records = recordsOf(doc, kind);
    const ids: string[] = [];
    for (const r of list) {
      if (typeof r.id !== "string") continue;
      records.set(r.id, recordMap(kind, r));
      ids.push(r.id);
    }
    if (ids.length) orderOf(doc, kind).push(ids);
  }
}

/** Depth of a JSON value, iteratively (hostile values can't overflow the stack). */
export function valueDepthExceeds(value: unknown, max = COLLAB_LIMITS.maxValueDepth): boolean {
  const stack: [unknown, number][] = [[value, 0]];
  while (stack.length) {
    const [v, d] = stack.pop()!;
    if (typeof v !== "object" || v === null) continue;
    if (d >= max) return true;
    for (const child of Array.isArray(v) ? v : Object.values(v)) stack.push([child, d + 1]);
  }
  return false;
}
