// A reply with names copied from the few-shot examples ("sample-app"), cleaned after the retry: the
// placeholder's ops go, and so does everything that depends on them. Which op refers to the placeholder is
// decided by the shared reference precedence (ReplyRefs in refs.ts), the same way the conversion will
// resolve it: an existing element's exact label wins over a new node's ("Worker" stays the existing
// Worker), and names match ignoring case and spaces, by key, label or kind. Whether what's left may be
// applied is decided afterwards (salvageable, in replyChecks.ts).

import type { DiagramFile } from "../../model/types";
import { ReplyRefs } from "../refs";
import type { CompactOp } from "./compactOps";

/**
 * The reply without the placeholder `leaked`:
 * - every op that has it in a name it writes (a new node's key or label, a connection's label, a rename's
 *   new label, a reference);
 * - every op whose reference resolves to a dropped new node (by key, label or kind);
 * - and no half insertion: a removal of the connection between two elements a dropped node was put
 *   between (an insert_between, or connections from both) goes too.
 */
export function withoutLeaked(ops: readonly CompactOp[], leaked: string, diagram: DiagramFile): CompactOp[] {
  const e = leaked.toLowerCase();
  const writes = (v: unknown) => typeof v === "string" && v.toLowerCase().includes(e);
  // The reply's new nodes, as the conversion will see them.
  const refs = new ReplyRefs(diagram);
  const keyOf = new Map<CompactOp, string>();
  ops.forEach((o, i) => {
    if ((o?.op !== "add" && o?.op !== "insert_between") || typeof o.kind !== "string" || typeof o.label !== "string")
      return;
    const key = `~reply-${i}`;
    keyOf.set(o, key);
    refs.add({ key, ...(typeof o.key === "string" ? { alias: o.key } : {}), kind: o.kind, label: o.label });
  });
  const leakedKeys = new Set([...keyOf].filter(([o]) => writes(o.key) || writes(o.label)).map(([, k]) => k));
  const resolve = (r: unknown): string | undefined => {
    if (typeof r !== "string" || !r.trim()) return undefined;
    const out = refs.resolve(r.trim());
    return "ref" in out ? out.ref : undefined;
  };
  const toLeaked = (r: unknown) => {
    const x = resolve(r);
    return x !== undefined && leakedKeys.has(x);
  };

  const dropped = new Set<CompactOp>();
  /** Existing elements a dropped op connected to, or put a dropped node between. */
  const neighbours = new Set<string>();
  for (const o of ops) {
    if (!o || typeof o !== "object") continue;
    const own = keyOf.get(o);
    const goes =
      (own !== undefined && leakedKeys.has(own)) ||
      [o.label, o.key, o.from, o.to, o.target].some(writes) ||
      [o.from, o.to, o.target].some(toLeaked);
    if (!goes) continue;
    dropped.add(o);
    for (const end of [o.from, o.to]) {
      const x = resolve(end);
      if (x && !x.startsWith("~") && diagram.nodes.some((n) => n.id === x)) neighbours.add(x);
    }
  }
  // A removal of the connection between two neighbours was half of the dropped insertion.
  const ends = (t: string): [string | undefined, string | undefined] => {
    const parts = t.split("->");
    if (parts.length === 2) return [resolve(parts[0]), resolve(parts[1])];
    const id = resolve(t);
    const edge = diagram.edges.find((x) => x.id === id);
    return [edge?.from, edge?.to];
  };
  for (const o of ops) {
    if (o?.op !== "remove" || typeof o.target !== "string" || dropped.has(o)) continue;
    const [a, b] = ends(o.target);
    if (a && b && neighbours.has(a) && neighbours.has(b)) dropped.add(o);
  }
  return ops.filter((o) => !dropped.has(o));
}
