import * as Y from "yjs";
import { COLLAB_LIMITS } from "./limits";
import type { DiagramCommand } from "./commands";
import { ROOT_NAMES, valueDepthExceeds } from "./schema";

// Bounds on a decoded Yjs update from another peer, checked before it touches the document. Every check here
// depends only on the update's bytes, never on local state, so every honest peer accepts or refuses the same update
// alike: refusing one can't make honest peers diverge. (Checks that depend on state, such as the 5,000-node
// limit, belong to the projection, which every peer computes from the same converged state: ./schema.ts.)
//
// Refused: undecodable bytes; too many structs, clients or delete ranges; clocks past the cap; roots this schema
// doesn't have; content kinds the schema never writes (subdocuments, binary, embeds, formatting, text, legacy
// JSON, XML types); over-long strings or field names; values nested too deeply.

export type GuardProblem =
  | "too-large"
  | "undecodable"
  | "too-many-structs"
  | "too-many-clients"
  | "clock-out-of-range"
  | "too-many-deletions"
  | "unknown-root"
  | "forbidden-content"
  | "string-too-long"
  | "key-too-long"
  | "too-deep";

export type GuardResult = { ok: true; structs: number } | { ok: false; problem: GuardProblem };

const tooLongString = (v: unknown): boolean => {
  const stack: unknown[] = [v];
  while (stack.length) {
    const x = stack.pop();
    if (typeof x === "string") {
      if (x.length > COLLAB_LIMITS.maxStringChars) return true;
    } else if (Array.isArray(x)) {
      // One at a time: spreading a hostile 200,000-element array into push() overflows the call stack.
      for (const item of x) stack.push(item);
    } else if (typeof x === "object" && x !== null) {
      for (const [k, child] of Object.entries(x)) {
        if (k.length > COLLAB_LIMITS.maxStringChars) return true;
        stack.push(child);
      }
    }
  }
  return false;
};

/** Never throws: anything unexpected while inspecting is a refusal, not an exception in the receive loop. */
export function inspectUpdate(update: Uint8Array): GuardResult {
  try {
    return inspect(update);
  } catch {
    return { ok: false, problem: "undecodable" };
  }
}

function inspect(update: Uint8Array): GuardResult {
  if (update.length > COLLAB_LIMITS.maxMessageBytes) return { ok: false, problem: "too-large" };
  let decoded: ReturnType<typeof Y.decodeUpdate>;
  try {
    decoded = Y.decodeUpdate(update);
  } catch {
    return { ok: false, problem: "undecodable" };
  }
  const { structs, ds } = decoded;
  if (structs.length > COLLAB_LIMITS.maxStructsPerUpdate) return { ok: false, problem: "too-many-structs" };
  const clients = new Set<number>();
  for (const s of structs) {
    clients.add(s.id.client);
    if (clients.size > COLLAB_LIMITS.maxClientsPerUpdate) return { ok: false, problem: "too-many-clients" };
    if (s.id.clock + s.length > COLLAB_LIMITS.maxClock || s.length < 0)
      return { ok: false, problem: "clock-out-of-range" };
    if (!(s instanceof Y.Item)) continue; // GC and Skip carry no content
    if (typeof s.parent === "string" && !ROOT_NAMES.has(s.parent)) return { ok: false, problem: "unknown-root" };
    if (typeof s.parentSub === "string" && s.parentSub.length > COLLAB_LIMITS.maxKeyChars)
      return { ok: false, problem: "key-too-long" };
    const content = s.content;
    if (content instanceof Y.ContentAny) {
      for (const v of content.arr) {
        if (valueDepthExceeds(v)) return { ok: false, problem: "too-deep" };
        if (tooLongString(v)) return { ok: false, problem: "string-too-long" };
      }
    } else if (content instanceof Y.ContentType) {
      if (!(content.type instanceof Y.Map) && !(content.type instanceof Y.Array))
        return { ok: false, problem: "forbidden-content" };
      // Y.XmlFragment and friends extend neither, Y.Text neither; the instanceof checks above refuse them.
    } else if (!(content instanceof Y.ContentDeleted)) return { ok: false, problem: "forbidden-content" };
  }
  let ranges = 0;
  for (const [client, items] of ds.clients) {
    clients.add(client);
    if (clients.size > COLLAB_LIMITS.maxClientsPerUpdate) return { ok: false, problem: "too-many-clients" };
    ranges += items.length;
    if (ranges > COLLAB_LIMITS.maxDeleteRanges) return { ok: false, problem: "too-many-deletions" };
    for (const item of items)
      if (item.clock < 0 || item.len < 0 || item.clock + item.len > COLLAB_LIMITS.maxClock)
        return { ok: false, problem: "clock-out-of-range" };
  }
  return { ok: true, structs: structs.length };
}

export type LocalProblem = "key-too-long" | "string-too-long" | "too-deep" | "too-large" | "bad-id" | "room-full";

const utf8 = new TextEncoder();
const VAR = 5; // a varuint of up to 2^35
/** Yjs's own structure per stored value (one Item): info, its id, origins, parent and the key, at most. */
const PER_ITEM = 64;
const PER_DELETION = 16;

/**
 * An upper bound on how many bytes lib0's `writeAny` (which Yjs uses for every value a map holds) takes for `v`:
 * a type tag, then numbers in at most 8 bytes, strings and keys as UTF-8 with a length, arrays and objects with a
 * count. Iterative, so a hostile value can't overflow the stack.
 */
export function anyBound(value: unknown): number {
  let size = 0;
  const stack: unknown[] = [value];
  while (stack.length) {
    const v = stack.pop();
    size += 1;
    if (typeof v === "string") size += VAR + utf8.encode(v).length;
    else if (typeof v === "number" || typeof v === "bigint") size += 8;
    else if (Array.isArray(v)) {
      size += VAR;
      for (const item of v) stack.push(item);
    } else if (v instanceof Uint8Array) size += VAR + v.length;
    else if (v !== null && typeof v === "object") {
      size += VAR; // the key count
      for (const [k, child] of Object.entries(v)) {
        size += VAR + VAR + utf8.encode(k).length;
        stack.push(child);
      }
    }
  }
  return size + VAR;
}

const keyBytes = (k: string) => utf8.encode(k).length;
const itemBound = (key: string, value: unknown) => PER_ITEM + keyBytes(key) + anyBound(value);

/**
 * The same bounds, checked on a local step before it touches the document: an edit every peer would refuse is
 * refused here instead, so it never reaches the wire and gets its sender quarantined by everyone else. `bytes` is an
 * upper bound on the step's encoded update, following how ./schema.ts stores each command (one Item per field, per
 * props key, per order entry; a deletion per value it replaces); scale.test.ts checks it against real encodings.
 */
export function checkCommands(
  commands: readonly DiagramCommand[],
): { ok: true; bytes: number } | { ok: false; problem: LocalProblem } {
  let size = 0;
  const longKey = (o: Record<string, unknown> | undefined) =>
    Object.keys(o ?? {}).some((k) => k.length >= COLLAB_LIMITS.maxKeyChars);
  const check = (v: unknown): LocalProblem | undefined => {
    if (v === undefined) return undefined;
    if (valueDepthExceeds(v)) return "too-deep";
    if (tooLongString(v)) return "string-too-long";
    return undefined;
  };
  for (const c of commands) {
    const id = "id" in c ? c.id : c.op === "put" ? c.record.id : undefined;
    if (id !== undefined && (typeof id !== "string" || !id || id.length >= COLLAB_LIMITS.maxKeyChars))
      return { ok: false, problem: "bad-id" };
    const fields = c.op === "put" ? c.record : "set" in c ? c.set : undefined;
    if (longKey(fields)) return { ok: false, problem: "key-too-long" };
    // The record itself (a put: its map, its props map and its order entry), or the field it replaces.
    size += PER_ITEM * 3 + keyBytes(id ?? "") * 2 + PER_DELETION;
    for (const [k, v] of Object.entries(fields ?? {})) {
      const problem = check(v);
      if (problem) return { ok: false, problem };
      if (c.op === "put" && v !== null && typeof v === "object" && !Array.isArray(v)) {
        if (longKey(v as Record<string, unknown>)) return { ok: false, problem: "key-too-long" };
        // Props (and anything object-valued) may be stored key by key: count both ways.
        for (const [pk, pv] of Object.entries(v)) size += itemBound(pk, pv);
      }
      size += itemBound(k, v) + PER_DELETION;
    }
    for (const k of "unset" in c ? (c.unset ?? []) : []) size += PER_ITEM + keyBytes(k) + PER_DELETION;
    if (c.op === "order") {
      if (c.ids.some((x) => typeof x !== "string" || x.length >= COLLAB_LIMITS.maxStringChars))
        return { ok: false, problem: "bad-id" };
      for (const x of c.ids) size += itemBound("", x) + PER_DELETION;
    }
  }
  if (size > COLLAB_LIMITS.maxStepBytes) return { ok: false, problem: "too-large" };
  return { ok: true, bytes: size };
}
