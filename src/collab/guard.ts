import * as Y from "yjs";
import { COLLAB_LIMITS } from "./limits";
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
    } else if (Array.isArray(x)) stack.push(...x);
    else if (typeof x === "object" && x !== null) {
      for (const [k, child] of Object.entries(x)) {
        if (k.length > COLLAB_LIMITS.maxStringChars) return true;
        stack.push(child);
      }
    }
  }
  return false;
};

export function inspectUpdate(update: Uint8Array): GuardResult {
  if (update.length > COLLAB_LIMITS.maxDocFrameBytes) return { ok: false, problem: "too-large" };
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
