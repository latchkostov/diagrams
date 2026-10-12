// The on-device model's reply, turned into the core's ops. The model is small, so this layer forgives
// what it reliably gets wrong, and only that:
// - references to nodes it adds in the same reply (by key, label, kind, or a word of them);
// - "this" for the selection, and a missing connection for "after this" / "before this";
// - a connection drawn against a "consumes / reads from" request (a service into the queue it reads);
// - "insert_between" and "change_kind", which it can't spell as several core ops reliably.
// Everything else is the core's job (applyOps validates, resolves kinds, places nodes).

import type { DiagramFile, SimRole } from "../../model/types";
import type { DiagramOp } from "../index";
import { resolveKind } from "../stencils";
import { normalizeRef, resolveRef } from "../refs";
import { getStencil } from "../../stencils/registry";
import type { ScopeItem } from "../ui/context";

/** At most this many ops per reply (checked in code: hard limits in a schema make small models odd). */
export const MAX_OPS = 16;

export const COMPACT_OPS = ["add", "connect", "insert_between", "rename", "change_kind", "remove"] as const;
export type CompactOpName = (typeof COMPACT_OPS)[number];

export interface CompactOp {
  op: CompactOpName | "change";
  key?: string;
  kind?: string;
  label?: string;
  sublabel?: string;
  from?: string;
  to?: string;
  flow?: "message" | "request";
  target?: string;
}

export interface ReplyContext {
  diagram: DiagramFile;
  scope?: readonly ScopeItem[];
  request?: string;
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9.#+]+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
const STOP = new Set(["a", "an", "the", "new", "node", "of", "to", "for", "and", "service", "this"]);
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24) || "node";

/** A node the reply adds: how it can be referred to before it exists. */
interface BatchNode {
  key: string;
  kind: string;
  label: string;
}

/** "this", "it", "the selection": the selected node, when exactly one is. */
const THIS = /^(?:this|it|that|the selection|selection|the selected node|selected node|selected)$/i;

/** Consume-type verbs: the data flows from the object to the subject ("Java consumes a topic"). */
export const CONSUMES =
  /\b(?:consumes?|consuming|reads? from|subscribes? to|listens? (?:to|on)|pulls? from|(?:is )?fed by|(?:is )?triggered by)\b/i;
/** Produce-type verbs: when the request has these too, it's mixed and nothing is flipped. */
export const PRODUCES = /\b(?:publish(?:es)?|sends?|writes?|produces?|emits?|pushes?|posts?|puts?)\b/i;
const MESSAGING: readonly SimRole[] = ["queue", "topic", "stream"];

/** The reply's ops for the core, or what's wrong with it (fed back to the model for one retry). */
export function toOps(
  reply: string,
  ctx: ReplyContext,
): { ok: true; ops: DiagramOp[]; summary: string } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply);
  } catch {
    return { ok: false, error: "The reply wasn't JSON." };
  }
  const body = parsed as { summary?: unknown; ops?: unknown };
  if (!body || !Array.isArray(body.ops)) return { ok: false, error: 'The reply needs an "ops" array.' };
  if (!body.ops.length) return { ok: false, error: "The reply has no ops." };
  if (body.ops.length > MAX_OPS) return { ok: false, error: `Use at most ${MAX_OPS} ops.` };
  const raw = body.ops as CompactOp[];
  const { diagram } = ctx;
  const selected = ctx.scope?.length === 1 && ctx.scope[0].kind === "node" ? ctx.scope[0] : undefined;

  // First pass: the nodes this reply adds, each with a key that can't be mistaken for an existing id.
  const taken = new Set([...diagram.nodes.map((n) => n.id), ...(diagram.edges ?? []).map((e) => e.id)]);
  const batch: BatchNode[] = [];
  for (const op of raw) {
    if ((op?.op !== "add" && op?.op !== "insert_between") || !text(op.kind) || !text(op.label)) continue;
    let key = slug(text(op.key) ?? text(op.label)!);
    while (taken.has(key)) key = `${key}-new`;
    taken.add(key);
    batch.push({ key, kind: text(op.kind)!, label: text(op.label)! });
  }
  const keyOf = new Map<CompactOp, string>();
  let next = 0;
  for (const op of raw)
    if ((op?.op === "add" || op?.op === "insert_between") && text(op.kind) && text(op.label))
      keyOf.set(op, batch[next++].key);
  // The keys the model wrote map to ours.
  const modelKeys = new Map<string, string>();
  for (const op of raw) if (text(op?.key) && keyOf.has(op)) modelKeys.set(text(op.key)!.toLowerCase(), keyOf.get(op)!);

  const exactExisting = (r: string) =>
    diagram.nodes.some((n) => n.id === r || normalizeRef(n.label) === normalizeRef(r)) ||
    diagram.nodes.some((n) => n.sublabel && normalizeRef(`${n.label} (${n.sublabel})`) === normalizeRef(r));
  const unique = <T>(xs: T[]) => (xs.length === 1 ? xs[0] : undefined);

  /** A reference as the core should see it: a key for a node of this reply, the selection for "this". */
  const ref = (r: string): string => {
    if (THIS.test(r) && selected) return selected.id;
    const lower = r.toLowerCase();
    const byKey = modelKeys.get(lower) ?? batch.find((b) => b.key === lower)?.key;
    if (byKey) return byKey;
    const byLabel = unique(batch.filter((b) => b.label.toLowerCase() === lower));
    if (byLabel) return byLabel.key;
    if (exactExisting(r)) return r;
    const byKind = unique(batch.filter((b) => b.kind.toLowerCase() === lower));
    if (byKind) return byKind.key;
    // A word of a new node's label or kind ("Python job" for the node added as a Python service), when
    // exactly one new node shares more words with it than any existing node does.
    const mine = words(r);
    if (mine.length) {
      const overlap = (s: string) => words(s).filter((w) => mine.includes(w)).length;
      const scored = batch.map((b) => ({ b, n: Math.max(overlap(b.label), overlap(b.kind)) })).filter((x) => x.n > 0);
      const top = Math.max(0, ...scored.map((x) => x.n));
      const best = scored.filter((x) => x.n === top);
      const rival = Math.max(0, ...diagram.nodes.map((n) => overlap(n.label)));
      if (best.length === 1 && top > rival) return best[0].b.key;
    }
    return r;
  };
  const edgeRef = (r: string) => {
    const parts = r.split("->");
    return parts.length === 2 ? `${ref(parts[0].trim())} -> ${ref(parts[1].trim())}` : ref(r);
  };
  const idOf = (r: string): string | undefined => {
    try {
      return resolveRef(diagram, r);
    } catch {
      return undefined;
    }
  };
  const flowKind = (flow: unknown) =>
    flow === "request" ? { kind: "sync" as const } : flow === "message" ? { kind: "async" as const } : {};

  const ops: DiagramOp[] = [];
  for (const [i, op] of raw.entries()) {
    const at = `Op ${i + 1} (${String(op?.op)})`;
    const kind = text(op?.kind);
    const label = text(op?.label);
    const target = text(op?.target);
    const from = text(op?.from);
    const to = text(op?.to);
    switch (op?.op) {
      case "add":
        if (!kind || !label) return { ok: false, error: `${at} needs "kind" and "label".` };
        ops.push({
          op: "add_node",
          kind,
          label,
          key: keyOf.get(op)!,
          ...(text(op.sublabel) ? { sublabel: text(op.sublabel) } : {}),
        });
        break;
      case "connect":
        if (!from || !to) return { ok: false, error: `${at} needs "from" and "to".` };
        ops.push({ op: "connect", from: ref(from), to: ref(to), ...flowKind(op.flow), ...(label ? { label } : {}) });
        break;
      case "insert_between": {
        if (!kind || !label || !from || !to)
          return { ok: false, error: `${at} needs "kind", "label", "from" and "to".` };
        let a = ref(from);
        let b = ref(to);
        const [ia, ib] = [idOf(a), idOf(b)];
        // The model may name the two ends the other way round: follow the connection that exists.
        let edge = diagram.edges.find((e) => e.from === ia && e.to === ib);
        if (!edge) {
          const back = diagram.edges.find((e) => e.from === ib && e.to === ia);
          if (back) [a, b, edge] = [b, a, back];
        }
        const key = keyOf.get(op)!;
        const flow = op.flow ? flowKind(op.flow) : edge ? { kind: edge.kind ?? ("async" as const) } : {};
        ops.push({ op: "add_node", kind, label, key });
        if (edge) ops.push({ op: "remove", targets: [edge.id] });
        ops.push({ op: "connect", from: a, to: key, ...flow }, { op: "connect", from: key, to: b, ...flow });
        break;
      }
      case "rename":
      case "change_kind":
      case "change": {
        // The model sometimes picks the wrong one of the two: a "rename" with only a kind is a kind
        // change ("Make Orders database a MongoDB"), a "change_kind" with only a label a rename.
        const renames = op.op === "rename" ? !!label || !kind : !kind && !!label;
        if (renames) {
          if (!target || !label) return { ok: false, error: `${at} needs "target" and the new "label".` };
          ops.push({ op: "update", target: ref(target), label });
          break;
        }
        if (!target || !kind) return { ok: false, error: `${at} needs "target" and "kind".` };
        ops.push({
          op: "update",
          target: ref(target),
          kind,
          ...(text(op.sublabel) ? { sublabel: text(op.sublabel) } : {}),
        });
        break;
      }
      case "remove":
        if (!target) return { ok: false, error: `${at} needs "target".` };
        ops.push({ op: "remove", targets: [edgeRef(target)] });
        break;
      default:
        return { ok: false, error: `${at}: "op" must be one of ${COMPACT_OPS.join(", ")}.` };
    }
  }

  const request = ctx.request ?? "";
  flipConsumes(ops, request, batch, diagram);
  if (selected) connectSelection(ops, request, selected.id, batch);
  dropBypassed(ops, request, batch, diagram);
  return { ok: true, ops, summary: text(body.summary)?.slice(0, 200) ?? "" };
}

/** The sim role of what a ref names: a node of this reply (by its kind) or an existing node. */
function roleOf(r: string, batch: readonly BatchNode[], diagram: DiagramFile): SimRole | undefined {
  const b = batch.find((x) => x.key === r);
  if (b) return getStencil(resolveKind(b.kind, b.label).id).simRole;
  try {
    const id = resolveRef(diagram, r);
    const n = diagram.nodes.find((x) => x.id === id);
    return n ? getStencil(n.stencil).simRole : undefined;
  } catch {
    return undefined;
  }
}

/**
 * "Java consumes a Kafka topic": data flows from the topic to the service. A small model often draws
 * the service into the topic. Only for a request with a consume verb and no produce verb, and only a
 * connection from a processor into a queue, topic or stream: then it's turned round.
 */
export function flipConsumes(ops: DiagramOp[], request: string, batch: readonly BatchNode[], diagram: DiagramFile) {
  if (!CONSUMES.test(request) || PRODUCES.test(request)) return;
  for (const op of ops) {
    if (op.op !== "connect") continue;
    const fromRole = roleOf(op.from, batch, diagram);
    const toRole = roleOf(op.to, batch, diagram);
    if (fromRole === "processor" && toRole && MESSAGING.includes(toRole)) [op.from, op.to] = [op.to, op.from];
  }
}

/**
 * "Add a retry queue after this": the new node hangs off the selection. When the reply adds nodes but
 * doesn't connect any to the selection, the first one is connected (after: selection -> new; before:
 * new -> selection), and one drawn the wrong way round is turned.
 */
export function connectSelection(ops: DiagramOp[], request: string, selected: string, batch: readonly BatchNode[]) {
  const after = /\b(?:after|downstream of|behind|out of|from)\s+(?:this|it|the selection)\b/i.test(request);
  const before = /\b(?:before|upstream of|in front of|into)\s+(?:this|it|the selection)\b/i.test(request);
  if (!batch.length || after === before) return;
  const keys = new Set(batch.map((b) => b.key));
  const touching = ops.filter(
    (o): o is Extract<DiagramOp, { op: "connect" }> =>
      o.op === "connect" && ((o.from === selected && keys.has(o.to)) || (o.to === selected && keys.has(o.from))),
  );
  for (const o of touching)
    if ((after && o.to === selected) || (before && o.from === selected)) [o.from, o.to] = [o.to, o.from];
  if (touching.length) return;
  const first = batch[0].key;
  ops.push(after ? { op: "connect", from: selected, to: first } : { op: "connect", from: first, to: selected });
}

/**
 * "Put a cache between A and B", answered as add + A -> cache + cache -> B without removing A -> B:
 * the direct connection is dropped, as insert_between would. Only when the request says "between" and
 * a new node now joins two nodes that were directly connected.
 */
export function dropBypassed(ops: DiagramOp[], request: string, batch: readonly BatchNode[], diagram: DiagramFile) {
  if (!/\bbetween\b/i.test(request)) return;
  const id = (r: string) => {
    try {
      return resolveRef(diagram, r);
    } catch {
      return undefined;
    }
  };
  const connects = ops.filter((o): o is Extract<DiagramOp, { op: "connect" }> => o.op === "connect");
  // What the reply removes already, as edge ids ("A -> B" included).
  const edgeId = (t: string) => {
    const parts = t.split("->");
    if (parts.length !== 2) return id(t);
    const [a, b] = parts.map((p) => id(p.trim()));
    return diagram.edges.find((e) => e.from === a && e.to === b)?.id;
  };
  const removed = new Set(ops.flatMap((o) => (o.op === "remove" ? o.targets.map((t) => edgeId(t) ?? t) : [])));
  for (const b of batch) {
    const ins = connects.filter((c) => c.to === b.key).map((c) => id(c.from));
    const outs = connects.filter((c) => c.from === b.key).map((c) => id(c.to));
    for (const from of ins)
      for (const to of outs) {
        const edge = diagram.edges.find((e) => e.from === from && e.to === to);
        if (edge && !removed.has(edge.id)) {
          ops.push({ op: "remove", targets: [edge.id] });
          removed.add(edge.id);
        }
      }
  }
}
