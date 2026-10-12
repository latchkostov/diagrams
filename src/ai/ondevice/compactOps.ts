// The on-device model's reply, turned into the core's ops. The model is small, so this layer forgives
// what it reliably gets wrong, and only that:
// - references to nodes it adds in the same reply, in one precedence order (ReplyRefs in refs.ts);
// - "this" for the selection, and a missing or reversed connection for "after this" / "before this";
// - the one connection a request describes with a consume verb ("Java consumes a Kafka topic"), when the
//   reply draws it the wrong way round;
// - a "between" answered with plain connects, which becomes the core's insert_between.
// Everything else is the core's job: applyOps applies the ops in order, validates, resolves kinds and
// places nodes (insert_between included, so it sees the batch as it is at that op).

import type { DiagramFile, SimRole } from "../../model/types";
import { getStencil } from "../../stencils/registry";
import { resolveKind } from "../stencils";
import type { DiagramOp } from "../index";
import { RefIndex, ReplyRefs, type NewNodeAlias } from "../refs";
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

type Connect = Extract<DiagramOp, { op: "connect" }>;
type Result = { ok: true; ops: DiagramOp[]; summary: string } | { ok: false; error: string };

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24) || "node";
/** Batch keys live where no element id can: generated ids never start with "~". */
const KEY_PREFIX = "~";

/** "this", "it", "the selection": the selected node, when exactly one is. */
const THIS = /^(?:this|it|that|the selection|selection|the selected node|selected node|selected)$/i;

/** Consume-type verbs: the data flows from the object to the subject ("Java consumes a topic"). */
export const CONSUMES =
  /\b(?:consumes?|consuming|reads? from|subscribes? to|listens? (?:to|on)|pulls? from|(?:is )?fed by|(?:is )?triggered by)\b/i;

class ReplyError extends Error {}

/** The reply's ops for the core, or what's wrong with it (fed back to the model for one retry). */
export function toOps(reply: string, ctx: ReplyContext): Result {
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
  try {
    return { ok: true, ops: convert(body.ops as CompactOp[], ctx), summary: text(body.summary)?.slice(0, 200) ?? "" };
  } catch (err) {
    if (err instanceof ReplyError) return { ok: false, error: err.message };
    throw err;
  }
}

function convert(raw: CompactOp[], ctx: ReplyContext): DiagramOp[] {
  const { diagram } = ctx;
  const request = ctx.request ?? "";
  const index = new RefIndex(diagram);
  const refs = new ReplyRefs(diagram, index);
  const selected = ctx.scope?.length === 1 && ctx.scope[0].kind === "node" ? ctx.scope[0] : undefined;

  // First pass: the nodes this reply adds. Their keys can't be an element id, and a key the model
  // wrote mustn't name an existing element or another new node.
  const keyOf = new Map<CompactOp, string>();
  const used = new Set<string>();
  const aliases = new Set<string>();
  for (const op of raw) {
    if ((op?.op !== "add" && op?.op !== "insert_between") || !text(op.kind) || !text(op.label)) continue;
    const alias = text(op.key);
    if (alias) {
      if (refs.existingName(alias))
        throw new ReplyError(`Key ${JSON.stringify(alias)} is already an element's id or label: pick another key.`);
      if (aliases.has(alias.toLowerCase())) throw new ReplyError(`Key ${JSON.stringify(alias)} is used twice.`);
      aliases.add(alias.toLowerCase());
    }
    let key = `${KEY_PREFIX}${slug(alias ?? text(op.label)!)}`;
    while (used.has(key)) key = `${key}-2`;
    used.add(key);
    keyOf.set(op, key);
    refs.add({ key, ...(alias ? { alias } : {}), kind: text(op.kind)!, label: text(op.label)! } satisfies NewNodeAlias);
  }

  const ref = (r: string): string => {
    if (THIS.test(r) && selected) return selected.id;
    const out = refs.resolve(r);
    if ("error" in out) throw new ReplyError(out.error);
    return out.ref;
  };
  const edgeRef = (r: string) => {
    const parts = r.split("->");
    return parts.length === 2 ? `${ref(parts[0].trim())} -> ${ref(parts[1].trim())}` : ref(r);
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
    const sublabel = text(op?.sublabel);
    switch (op?.op) {
      case "add":
        if (!kind || !label) throw new ReplyError(`${at} needs "kind" and "label".`);
        ops.push({ op: "add_node", kind, label, key: keyOf.get(op)!, ...(sublabel ? { sublabel } : {}) });
        break;
      case "connect":
        if (!from || !to) throw new ReplyError(`${at} needs "from" and "to".`);
        ops.push({ op: "connect", from: ref(from), to: ref(to), ...flowKind(op.flow), ...(label ? { label } : {}) });
        break;
      case "insert_between":
        if (!kind || !label || !from || !to) throw new ReplyError(`${at} needs "kind", "label", "from" and "to".`);
        ops.push({
          op: "insert_between",
          from: ref(from),
          to: ref(to),
          kind,
          label,
          key: keyOf.get(op)!,
          ...(sublabel ? { sublabel } : {}),
        });
        break;
      case "rename":
      case "change_kind":
      case "change": {
        // The model sometimes picks the wrong one of the two: a "rename" with only a kind is a kind
        // change ("Make Orders database a MongoDB"), a "change_kind" with only a label a rename.
        const renames = op.op === "rename" ? !!label || !kind : !kind && !!label;
        if (renames) {
          if (!target || !label) throw new ReplyError(`${at} needs "target" and the new "label".`);
          ops.push({ op: "update", target: ref(target), label });
          break;
        }
        if (!target || !kind) throw new ReplyError(`${at} needs "target" and "kind".`);
        ops.push({ op: "update", target: ref(target), kind, ...(sublabel ? { sublabel } : {}) });
        break;
      }
      case "remove":
        if (!target) throw new ReplyError(`${at} needs "target".`);
        ops.push({ op: "remove", targets: [edgeRef(target)] });
        break;
      default:
        throw new ReplyError(`${at}: "op" must be one of ${COMPACT_OPS.join(", ")}.`);
    }
  }

  const batch = [...keyOf.values()];
  flipConsumed(ops, request, refs, diagram);
  if (selected) connectSelection(ops, request, selected.id, batch);
  return betweenAsInsert(ops, request, diagram, refs);
}

/**
 * The pair a request describes with a consume verb: "<subject> consumes <object>", each phrase matched
 * to one node (new or existing). The data flows object -> subject. Null unless both match one node each.
 */
export function consumedPair(request: string, refs: ReplyRefs): { subject: string; object: string } | null {
  const m = CONSUMES.exec(request);
  if (!m) return null;
  // The clause around the verb: back to the start or a break, forward to the next break.
  const before =
    request
      .slice(0, m.index)
      .split(/[,;.]|\b(?:and|then|which|that|while|before|after)\b/i)
      .pop() ?? "";
  const after =
    request.slice(m.index + m[0].length).split(/[,;.]|\b(?:and|then|which|that|while|before|after)\b/i)[0] ?? "";
  const subject = refs.match(before);
  const object = refs.match(after);
  return subject && object && subject !== object ? { subject, object } : null;
}

const MESSAGING: readonly (SimRole | "none")[] = ["queue", "topic", "stream"];

/** The sim role of a new node (by its kind) or an existing one. */
function roleOf(ref: string, refs: ReplyRefs, diagram: DiagramFile): SimRole | undefined {
  const fresh = refs.newNode(ref);
  if (fresh) return getStencil(resolveKind(fresh.kind, fresh.label).id).simRole;
  const n = diagram.nodes.find((x) => x.id === ref);
  return n ? getStencil(n.stencil).simRole : undefined;
}

/**
 * "Java consumes a Kafka topic": the data flows from the topic to Java. When the reply draws exactly
 * that pair the other way round (Java -> topic), that one connection is turned. Nothing else is touched.
 */
export function flipConsumed(ops: DiagramOp[], request: string, refs: ReplyRefs, diagram: DiagramFile) {
  const pair = consumedPair(request, refs);
  // Only what's consumed from a queue, topic or stream: a service "consuming data from Postgres" still
  // calls the database (a request drawn service -> database).
  if (!pair || !MESSAGING.includes(roleOf(pair.object, refs, diagram) ?? "none")) return;
  const id = (r: string) => refs.existingId(r) ?? r;
  const connects = ops.filter((o): o is Connect => o.op === "connect");
  const wrong = connects.filter((c) => id(c.from) === pair.subject && id(c.to) === pair.object);
  const right = connects.some((c) => id(c.from) === pair.object && id(c.to) === pair.subject);
  if (wrong.length === 1 && !right) [wrong[0].from, wrong[0].to] = [wrong[0].to, wrong[0].from];
}

/**
 * "Add a retry queue after this": the new node hangs off the selection. A connection between the
 * selection and a new node drawn the wrong way round is turned; when the reply connects no new node to
 * the selection, the first new node is connected (after: selection -> new; before: new -> selection).
 * References are ids or keys by now, so the comparison is exact.
 */
export function connectSelection(ops: DiagramOp[], request: string, selected: string, batch: readonly string[]) {
  const after = /\b(?:after|downstream of|behind|out of|from)\s+(?:this|it|the selection)\b/i.test(request);
  const before = /\b(?:before|upstream of|in front of|into)\s+(?:this|it|the selection)\b/i.test(request);
  if (!batch.length || after === before) return;
  const keys = new Set(batch);
  const touching = ops.filter(
    (o): o is Connect =>
      o.op === "connect" && ((o.from === selected && keys.has(o.to)) || (o.to === selected && keys.has(o.from))),
  );
  for (const o of touching)
    if ((after && o.to === selected) || (before && o.from === selected)) [o.from, o.to] = [o.to, o.from];
  // Turned round, two connections may now be the same one: keep one.
  const seen = new Set<string>();
  for (const o of touching) {
    const k = `${o.from}\u0000${o.to}`;
    if (seen.has(k)) ops.splice(ops.indexOf(o), 1);
    seen.add(k);
  }
  if (touching.length) return;
  const first = batch[0];
  ops.push(after ? { op: "connect", from: selected, to: first } : { op: "connect", from: first, to: selected });
}

/**
 * "Put a cache between A and B", answered as add + A -> cache + cache -> B (and perhaps a remove of
 * A -> B): that's the core's insert_between, which keeps the replaced connection's kind, relation, label,
 * props and sides. Only when the request says "between" and A -> B exists. Either way, a remove of the
 * connection an insert_between replaces is dropped (the insert does it).
 */
export function betweenAsInsert(ops: DiagramOp[], request: string, diagram: DiagramFile, refs: ReplyRefs): DiagramOp[] {
  const between = /\bbetween\b/i.test(request);
  const id = (r: string) => refs.existingId(r);
  const edgeOf = (t: string) => {
    const parts = t.split("->");
    if (parts.length !== 2) return diagram.edges.find((e) => e.id === id(t))?.id;
    const [a, b] = parts.map((p) => id(p.trim()));
    return diagram.edges.find((e) => e.from === a && e.to === b)?.id;
  };
  let out = [...ops];
  for (const add of between ? ops : []) {
    if (add.op !== "add_node" || !add.key) continue;
    const ins = out.filter((o): o is Connect => o.op === "connect" && o.to === add.key);
    const outs = out.filter((o): o is Connect => o.op === "connect" && o.from === add.key);
    if (ins.length !== 1 || outs.length !== 1) continue;
    const [a, b] = [id(ins[0].from), id(outs[0].to)];
    const edge = diagram.edges.find((e) => e.from === a && e.to === b);
    if (!edge) continue;
    const insert: DiagramOp = {
      op: "insert_between",
      from: ins[0].from,
      to: outs[0].to,
      kind: add.kind,
      label: add.label,
      key: add.key,
      ...(add.sublabel ? { sublabel: add.sublabel } : {}),
    };
    out = out
      .filter((o) => o !== ins[0] && o !== outs[0])
      .filter((o) => !(o.op === "remove" && o.targets.length === 1 && edgeOf(o.targets[0]) === edge.id))
      .map((o) => (o === add ? insert : o));
  }
  // An insert_between the model wrote itself, with a remove of the same connection: drop the remove.
  for (const ins of out.filter((o): o is Extract<DiagramOp, { op: "insert_between" }> => o.op === "insert_between")) {
    const [a, b] = [id(ins.from), id(ins.to)];
    const edge = diagram.edges.find((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
    if (edge)
      out = out.filter((o) => !(o.op === "remove" && o.targets.length === 1 && edgeOf(o.targets[0]) === edge.id));
  }
  return out;
}
