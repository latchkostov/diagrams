import * as Y from "yjs";
import { structuralText } from "../model/diagramDiff";
import type { DiagramFile } from "../model/types";
import {
  GEOMETRY,
  hasNestedProps,
  isPlainObject,
  jsonClone,
  metaOf,
  orderOf,
  PROPS_KEY,
  RECORD_KINDS,
  recordMap,
  recordsOf,
  writeFields,
  type RecordKind,
} from "./schema";

// The command adapter: the one place that writes the shared document. Every editor mutation path reaches the room
// as commands, made here from what changed (`commandsFromDiff`, between the state both sides last agreed on and
// the editor's state now), and applied here in one Yjs transaction per editor step (`applyCommands`), under the
// session's local origin, so per-user Undo (Y.UndoManager) tracks exactly those.
//
// Commands are field-level: a rename sets one field, a move one geometry value, a props edit one key. Two people
// editing different fields, or different settings of the same node, both keep their edits. Diffing against the
// agreed base (never against the current shared state) means a local step can't undo a remote change it never saw.

export type FieldPatch = { set?: Record<string, unknown>; unset?: string[] };

export type DiagramCommand =
  /** A new record (or one replaced whole). New records are appended to their list's order. */
  | { op: "put"; kind: RecordKind; record: Record<string, unknown> & { id: string } }
  /** Fields of a record. Geometry fields merge into the record's atomic geometry value. */
  | ({ op: "patch"; kind: RecordKind; id: string } & FieldPatch)
  /** Keys of a node's or an edge's props. */
  | ({ op: "props"; kind: "nodes" | "edges"; id: string } & FieldPatch)
  | { op: "remove"; kind: RecordKind; id: string }
  /** The whole order of a list (a reorder). Concurrent appends by others survive it. */
  | { op: "order"; kind: RecordKind; ids: string[] }
  /** Top-level fields: title, description, colour, direction, format, planning, checks, layerOrder. */
  | ({ op: "meta" } & FieldPatch);

const RESERVED_META = new Set<string>([...RECORD_KINDS, "private"]);

const same = (a: unknown, b: unknown) =>
  a === b ||
  (typeof a === "object" &&
    a !== null &&
    typeof b === "object" &&
    b !== null &&
    structuralText(a) === structuralText(b));

/** Field-level differences between two versions of a record (`id` excluded), as a patch. */
function fieldPatch(a: Record<string, unknown>, b: Record<string, unknown>, skip?: string): FieldPatch | undefined {
  const set: Record<string, unknown> = {};
  const unset: string[] = [];
  for (const k of Object.keys(b))
    if (k !== "id" && k !== skip && b[k] !== undefined && !same(a[k], b[k])) set[k] = b[k];
  for (const k of Object.keys(a))
    if (k !== "id" && k !== skip && a[k] !== undefined && b[k] === undefined) unset.push(k);
  return Object.keys(set).length || unset.length ? { set, unset } : undefined;
}

const byId = (list: readonly { id: string }[] | undefined) => {
  const m = new Map<string, Record<string, unknown> & { id: string }>();
  for (const r of list ?? []) if (!m.has(r.id)) m.set(r.id, r as unknown as Record<string, unknown> & { id: string });
  return m;
};

/**
 * What changed from `before` to `after`, as commands. `private` is never included: it is local provenance and
 * never leaves the device. Linear in the diagram's size; unchanged records cost a reference or field comparison.
 */
export function commandsFromDiff(before: DiagramFile, after: DiagramFile): DiagramCommand[] {
  const out: DiagramCommand[] = [];
  const b = before as unknown as Record<string, unknown>;
  const a = after as unknown as Record<string, unknown>;
  const metaBefore: Record<string, unknown> = {};
  const metaAfter: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(b)) if (!RESERVED_META.has(k)) metaBefore[k] = v;
  for (const [k, v] of Object.entries(a)) if (!RESERVED_META.has(k)) metaAfter[k] = v;
  const meta = fieldPatch(metaBefore, metaAfter);
  if (meta) out.push({ op: "meta", ...meta });

  for (const kind of RECORD_KINDS) {
    const prev = byId(before[kind] as { id: string }[] | undefined);
    const next = byId(after[kind] as { id: string }[] | undefined);
    for (const id of prev.keys()) if (!next.has(id)) out.push({ op: "remove", kind, id });
    for (const [id, record] of next) {
      const old = prev.get(id);
      if (!old) {
        out.push({ op: "put", kind, record });
        continue;
      }
      if (old === record) continue;
      const nested = hasNestedProps(kind) && isPlainObject(old.props) && isPlainObject(record.props);
      const patch = fieldPatch(old, record, nested ? "props" : undefined);
      if (patch) out.push({ op: "patch", kind, id, ...patch });
      if (nested) {
        const props = fieldPatch(old.props as Record<string, unknown>, record.props as Record<string, unknown>);
        if (props) out.push({ op: "props", kind: kind as "nodes" | "edges", id, ...props });
      }
    }
    // Order: survivors in a different relative order, or a new record anywhere but after them, is a reorder.
    const expected = [...prev.keys()].filter((id) => next.has(id));
    const added = [...next.keys()].filter((id) => !prev.has(id));
    const actual = [...next.keys()];
    const appended = [...expected, ...added];
    if (actual.some((id, i) => id !== appended[i])) out.push({ op: "order", kind, ids: actual });
  }
  return out;
}

/** Thrown for a command that can't apply (an unknown kind, a malformed record): a bug in the caller. */
export class CommandError extends Error {}

const checkId = (id: unknown): string => {
  if (typeof id !== "string" || !id) throw new CommandError("A record needs a non-empty string id.");
  return id;
};

/**
 * Applies `commands` to the shared document. Call inside one `doc.transact(…, origin)` (CollabDoc.apply does), so
 * an editor step is one update on the wire and one Undo step. A patch for a record that's gone (someone deleted
 * it meanwhile) is dropped: the delete wins, the same on every peer.
 */
export function applyCommands(doc: Y.Doc, commands: readonly DiagramCommand[]): void {
  const removals = new Map<RecordKind, Set<string>>();
  for (const c of commands) {
    switch (c.op) {
      case "put": {
        const id = checkId(c.record.id);
        const records = recordsOf(doc, c.kind);
        const existed = records.has(id);
        records.set(id, recordMap(c.kind, c.record));
        if (!existed) orderOf(doc, c.kind).push([id]);
        removals.get(c.kind)?.delete(id);
        break;
      }
      case "patch": {
        const map = recordsOf(doc, c.kind).get(checkId(c.id));
        if (!(map instanceof Y.Map)) break;
        writeFields(map, c.kind, c.set ?? {}, Object.keys(c.set ?? {}), c.unset ?? []);
        break;
      }
      case "props": {
        const map = recordsOf(doc, c.kind).get(checkId(c.id));
        if (!(map instanceof Y.Map)) break;
        let props = map.get(PROPS_KEY);
        if (!(props instanceof Y.Map)) {
          // The record had no props map (it was put without props): create it. Two peers doing this at once is a
          // same-record race whose loser's keys are dropped, deterministically.
          props = new Y.Map<unknown>();
          map.set(PROPS_KEY, props);
          map.delete("props");
        }
        const p = props as Y.Map<unknown>;
        for (const [k, v] of Object.entries(c.set ?? {})) if (v !== undefined) p.set(k, jsonClone(v));
        for (const k of c.unset ?? []) p.delete(k);
        break;
      }
      case "remove": {
        const id = checkId(c.id);
        recordsOf(doc, c.kind).delete(id);
        let set = removals.get(c.kind);
        if (!set) removals.set(c.kind, (set = new Set()));
        set.add(id);
        break;
      }
      case "order": {
        const order = orderOf(doc, c.kind);
        if (order.length) order.delete(0, order.length);
        order.push(c.ids.map(checkId));
        break;
      }
      case "meta": {
        const meta = metaOf(doc);
        for (const [k, v] of Object.entries(c.set ?? {})) {
          if (RESERVED_META.has(k)) throw new CommandError(`"${k}" isn't a top-level field a room shares.`);
          if (v !== undefined) meta.set(k, jsonClone(v));
        }
        for (const k of c.unset ?? []) if (!RESERVED_META.has(k)) meta.delete(k);
        break;
      }
      default:
        throw new CommandError("Unknown command.");
    }
  }
  // One pass per list for every removal in this step, deleting runs of neighbours with one call each, from the end
  // (so earlier indices stay put): removing a whole list is one delete, not one per element (bulk deletes linear).
  for (const [kind, ids] of removals) {
    if (!ids.size) continue;
    const order = orderOf(doc, kind);
    const items = order.toArray();
    const gone = (i: number) => typeof items[i] === "string" && ids.has(items[i] as string);
    for (let end = items.length - 1; end >= 0; end--) {
      if (!gone(end)) continue;
      let start = end;
      while (start > 0 && gone(start - 1)) start--;
      order.delete(start, end - start + 1);
      end = start;
    }
  }
}

/** Whether `kind` stores `field` inside an atomic geometry value. */
export const isGeometryField = (kind: RecordKind, field: string) => !!GEOMETRY[kind]?.fields.includes(field);
