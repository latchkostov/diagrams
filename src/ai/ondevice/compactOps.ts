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
import { confidentStencil, namedStencil, resolveKind } from "../stencils";
import type { DiagramOp } from "../index";
import { RefIndex, ReplyRefs, refWords, type ElementKind, type NewNodeAlias } from "../refs";

/** What a connection may end on: a node or a shape (refs.ts resolves names among these only). */
const ENDS: readonly ElementKind[] = ["node", "note"];
import type { ScopeItem } from "../ui/context";
import { incompleteness, inRequest, kindFor, leakedName, reconcileKinds, salvageable } from "./replyChecks";
import { withoutLeaked } from "./leaks";
import { relationFlow, relationsCoverRequest, requestRelations } from "./requestRelations";
import { tokenize, wordOf, type Token } from "./requestClauses";
import { fillEdits } from "./requestEdits";

/** At most this many ops per reply (checked in code: hard limits in a schema make small models odd). */
export const MAX_OPS = 6;

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
  /**
   * After the retry: drop the ops that use names from the few-shot examples ("sample-app") instead of
   * failing, so completeness and completion see what's left.
   */
  dropLeaked?: boolean;
}

/** The fields a reply op may have; each is text when present. */
const OP_FIELDS = ["op", "key", "kind", "label", "sublabel", "from", "to", "flow", "target"] as const;

type Connect = Extract<DiagramOp, { op: "connect" }>;
type Result =
  | { ok: true; ops: DiagramOp[]; summary: string; dropped?: string[] }
  | { ok: false; error: string; partial?: DiagramOp[]; dropped?: string[] };

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
export { CONSUMES } from "./requestRelations";

class ReplyError extends Error {
  /** For an incomplete reply: the ops it did make (for completeFromRequest). */
  constructor(
    message: string,
    readonly partial?: DiagramOp[],
  ) {
    super(message);
  }
}

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
  // Every field is text (or missing, for the repairs to fill): nothing past here needs to check.
  for (const [i, op] of body.ops.entries()) {
    if (!op || typeof op !== "object") continue;
    for (const field of OP_FIELDS) {
      const v = (op as Record<string, unknown>)[field];
      if (v !== undefined && v !== null && typeof v !== "string")
        return { ok: false, error: `Op ${i + 1}: "${field}" must be text.` };
    }
  }
  const dropped: string[] = [];
  try {
    const ops = convert(body.ops as CompactOp[], ctx, dropped);
    return {
      ok: true,
      ops,
      summary: text(body.summary)?.slice(0, 200) ?? "",
      ...(dropped.length ? { dropped } : {}),
    };
  } catch (err) {
    if (err instanceof ReplyError)
      return {
        ok: false,
        error: err.message,
        ...(err.partial ? { partial: err.partial } : {}),
        ...(dropped.length ? { dropped } : {}),
      };
    throw err;
  }
}

/** The leak's feedback for the retry, and the error when even the retry's reply can't be cleaned. */
const leakError = (name: string) =>
  new ReplyError(`Don't reuse names from the examples (${JSON.stringify(name)}): name things as the request does.`);

/** `dropped` collects the example names left out (ctx.dropLeaked). */
function convert(reply: CompactOp[], ctx: ReplyContext, dropped: string[] = []): DiagramOp[] {
  const { diagram } = ctx;
  const request = ctx.request ?? "";
  const index = new RefIndex(diagram);
  const refs = new ReplyRefs(diagram, index);
  const selected = ctx.scope?.length === 1 && ctx.scope[0].kind === "node" ? ctx.scope[0] : undefined;
  /** "this" as a rename, kind change or remove target: whatever is selected (a node, connection or boundary). */
  const selectedAny = ctx.scope?.length === 1 ? ctx.scope[0] : undefined;
  // A rename's label or a kind change's kind the reply left out, from the request's own words ("Rename X
  // to Y", "Make X a Y"), and an empty duplicate of a change dropped.
  /** The existing element a name means ("this" is the selection). */
  const element = (name: string) =>
    typeof name !== "string" ? undefined : THIS.test(name.trim()) ? selectedAny?.id : refs.existingId(name.trim());
  let raw = fillEdits(reply, request, element);

  // First pass: the nodes this reply adds. Their keys can't be an element id, and a key the model
  // wrote mustn't name an existing element or another new node.
  // Names copied from the few-shot examples ("sample-worker") are never meant: an error for the retry,
  // and after it (dropLeaked) the ops that use them go, so completeness and completion see the rest.
  for (;;) {
    const leaked = leakedName(
      raw.flatMap((o) =>
        [o?.label, o?.key, o?.from, o?.to, o?.target].filter((x): x is string => typeof x === "string"),
      ),
      request,
      diagram,
    );
    if (!leaked) break;
    if (!ctx.dropLeaked || dropped.length >= MAX_OPS) throw leakError(leaked);
    raw = withoutLeaked(raw, leaked, diagram);
    dropped.push(leaked);
  }

  /** Each new node, normalized once: its key and its effective kind (after kindFor). */
  const nodeOf = new Map<CompactOp, { key: string; kind: string }>();
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
    // The label wins over a wrong kind word, when the request names it.
    nodeOf.set(op, { key, kind: kindFor(text(op.kind)!, text(op.label)!, request) });
  }
  // Then the request's technologies: one it names that no new node has goes to a new node of one it never
  // mentions. Everything after this (references, repairs, the ops) reads these kinds.
  const fresh = raw.filter((op) => nodeOf.has(op));
  // The technologies the reply gives existing nodes (a kind change, or a kind-only "rename").
  const kindChange = (op: CompactOp) =>
    !!text(op?.kind) && (op.op === "change_kind" || op.op === "change" || (op.op === "rename" && !text(op.label)));
  const updates = new Set(raw.filter(kindChange).map((op) => resolveKind(text(op.kind)!).id));
  const reconciled = reconcileKinds(
    fresh.map((op) => ({ label: text(op.label)!, kind: nodeOf.get(op)!.kind })),
    request,
    diagram,
    updates,
  );
  for (const [i, op] of fresh.entries()) {
    const n = nodeOf.get(op)!;
    n.kind = reconciled[i];
    const alias = text(op.key);
    refs.add({ key: n.key, ...(alias ? { alias } : {}), kind: n.kind, label: text(op.label)! } satisfies NewNodeAlias);
  }

  /** A reference, looked up: never creates anything. Unresolved text goes on to the core's error. */
  const ref = (r: string, kinds?: readonly ElementKind[]): string => {
    if (THIS.test(r) && selectedAny) return selectedAny.id;
    const out = refs.resolve(r, kinds);
    if ("error" in out) throw new ReplyError(out.error);
    return out.ref;
  };
  /** Nodes added for components the request names but the reply only connected. */
  const added: DiagramOp[] = [];
  /**
   * A connection's endpoint. The one repair that creates a node: "Container Apps", connected but never
   * added, named so in the request and placed confidently by the catalogue, is added. Not when one of
   * the reply's new nodes already is that component ("Python job" for the node added as Python, "Azure
   * functions" for the node whose kind was corrected to Azure Functions).
   */
  const endpoint = (r: string): string => {
    if (THIS.test(r) && selected) return selected.id;
    const exact = refs.strict(r, ENDS);
    if (exact && "error" in exact) throw new ReplyError(exact.error);
    if (exact) return exact.ref;
    const repaired = repairMissingEndpoint(r);
    return repaired ?? ref(r, ENDS);
  };
  const repairMissingEndpoint = (r: string): string | undefined => {
    if (!inRequest(r, request) || refs.existingId(r, ENDS)) return undefined;
    const stencil = confidentStencil(r);
    if (!stencil || stencil === "generic.service") return undefined;
    const near = refs.resolve(r, ENDS);
    const mine = "ref" in near ? refs.newNode(near.ref) : undefined;
    if (mine && resolveKind(mine.kind, mine.label).id === stencil) return mine.key;
    let key = `${KEY_PREFIX}${slug(r)}`;
    while (used.has(key)) key = `${key}-2`;
    used.add(key);
    refs.add({ key, kind: r, label: r });
    added.push({ op: "add_node", kind: r, label: r, key });
    return key;
  };
  /** "this" (or "it", "the selection"…) with nothing selected, no new node so named, and not in the request. */
  const strayThis = (r: string) =>
    !selectedAny &&
    THIS.test(r) &&
    !refs.strict(r) &&
    !new RegExp(`(?:^|[^a-z0-9])${r.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9])`, "i").test(request);
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
        ops.push({
          op: "add_node",
          kind: nodeOf.get(op)!.kind,
          label,
          key: nodeOf.get(op)!.key,
          ...(sublabel ? { sublabel } : {}),
        });
        break;
      case "connect": {
        if (!from || !to) throw new ReplyError(`${at} needs "from" and "to".`);
        // "this" with nothing selected, in a request that never says it: nothing is meant (run 4 connected
        // a webhook to "this"). The connection goes; whatever it left unconnected, the completeness check
        // asks for.
        if (strayThis(from) || strayThis(to)) break;
        const [a, b] = [endpoint(from), endpoint(to)];
        if (a === b)
          throw new ReplyError("A connection can't start and end at the same node; add the missing component first.");
        ops.push({ op: "connect", from: a, to: b, ...flowKind(op.flow), ...(label ? { label } : {}) });
        break;
      }
      case "insert_between":
        if (!kind || !label || !from || !to) throw new ReplyError(`${at} needs "kind", "label", "from" and "to".`);
        ops.push({
          op: "insert_between",
          from: ref(from, ["node"]),
          to: ref(to, ["node"]),
          kind: nodeOf.get(op)!.kind,
          label,
          key: nodeOf.get(op)!.key,
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

  ops.unshift(...added);
  const batch = [...keyOf.values()];
  flipDescribed(ops, request, refs, diagram);
  if (selected) connectSelection(ops, request, selected.id, batch);
  const out = betweenAsInsert(
    ops,
    request,
    diagram,
    refs,
    [...nodeOf.values()].map((n) => n.key),
  );
  // Cleaned of a placeholder: only when what's left can be checked against the whole request (into an
  // empty diagram, the completeness check below; on an existing one, every edit the request asks for).
  if (dropped.length && !salvageable(out, request, diagram, element)) throw leakError(dropped[0]);
  // Everything the request names added, and connected: else the retry says what's missing.
  const missing = incompleteness(out, request, diagram);
  if (missing) throw new ReplyError(missing, out);
  return out;
}

export { PRODUCES } from "./requestRelations";

/**
 * The connections a request describes (requestRelations.ts), each end matched to one node (new or
 * existing), with the way the data flows there (relationFlow: role-aware). Negated relations, and those
 * whose ends don't each match exactly one node, are left out.
 */
export function describedPairs(
  request: string,
  refs: ReplyRefs,
  diagram: DiagramFile,
): { from: string; to: string; consume: boolean }[] {
  const out: { from: string; to: string; consume: boolean }[] = [];
  for (const r of requestRelations(request)) {
    if (r.negated) continue;
    const subject = refs.match(r.subject);
    const object = refs.match(r.object);
    if (!subject || !object || subject === object) continue;
    const flow = relationFlow(r, roleOf(object, refs, diagram));
    out.push(
      flow.fromSubject
        ? { from: subject, to: object, consume: r.consume }
        : { from: object, to: subject, consume: r.consume },
    );
  }
  return out;
}

/** Back-compatible name: the first consumed pair, as subject (the consumer) and object (the source). */
export function consumedPair(
  request: string,
  refs: ReplyRefs,
  diagram: DiagramFile,
): { subject: string; object: string } | null {
  const p = describedPairs(request, refs, diagram).find((x) => x.consume);
  return p ? { subject: p.to, object: p.from } : null;
}

/** The sim role of a new node (by its kind) or an existing one. */
function roleOf(ref: string, refs: ReplyRefs, diagram: DiagramFile): SimRole | undefined {
  const fresh = refs.newNode(ref);
  if (fresh) return getStencil(resolveKind(fresh.kind, fresh.label).id).simRole;
  const n = diagram.nodes.find((x) => x.id === ref);
  return n ? getStencil(n.stencil).simRole : undefined;
}

/**
 * A connection the request describes, drawn against the way its data flows, is turned, and only that
 * one: when the reply has exactly that pair reversed and not the right way. Drawn both ways, the reversed
 * one is dropped only when it's demonstrably not asked for: every clause of the request is a relation
 * it reads, and none describes that way. The way comes from the shared, role-aware relation semantics,
 * so a service "reading from Postgres" still calls it.
 */
export function flipDescribed(ops: DiagramOp[], request: string, refs: ReplyRefs, diagram: DiagramFile) {
  const id = (r: string) => refs.existingId(r) ?? r;
  const connects = ops.filter((o): o is Connect => o.op === "connect");
  const pairs = describedPairs(request, refs, diagram);
  // Removing needs the whole request understood: a clause it can't read ("…and API responds to Client")
  // may be what asks for the other way.
  const understood = relationsCoverRequest(request);
  for (const pair of pairs) {
    const wrong = connects.filter((c) => id(c.from) === pair.to && id(c.to) === pair.from);
    const right = connects.some((c) => id(c.from) === pair.from && id(c.to) === pair.to);
    if (wrong.length === 1 && !right) [wrong[0].from, wrong[0].to] = [wrong[0].to, wrong[0].from];
    // Drawn both ways, where every clause is understood and none asks for the other way: the reversed
    // one goes.
    else if (wrong.length && right && understood && !pairs.some((p) => p.from === pair.to && p.to === pair.from))
      for (const w of wrong) if (ops.includes(w)) ops.splice(ops.indexOf(w), 1);
  }
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
 * "Put a <component> between <X> and <Y>": the component's phrase and the two endpoints' phrases, from
 * the clause that says it. Null without one.
 */
export function betweenIntent(request: string): { component: string; x: string; y: string } | null {
  // Tokens, not a backtracking regex: linear in the request, and a quoted name is one token.
  const tokens = tokenize(request);
  const text = (ts: readonly Token[]) => (ts.length ? request.slice(ts[0].start, ts[ts.length - 1].end) : "");
  const stop = (t: Token) => t.kind === "punct" || wordOf(t) === "and";
  const b = tokens.findIndex((t) => wordOf(t) === "between");
  if (b < 0) return null;
  let a = b + 2;
  while (a < tokens.length && !stop(tokens[a])) a++;
  if (a >= tokens.length || wordOf(tokens[a]) !== "and") return null;
  let end = a + 1;
  while (end < tokens.length && !stop(tokens[end])) end++;
  if (end === a + 1) return null;
  let s = b;
  while (s > 0 && !(tokens[s - 1].kind === "punct" || ["and", "then"].includes(wordOf(tokens[s - 1])))) s--;
  let c = s;
  if (["put", "add", "insert", "place", "drop"].includes(wordOf(tokens[c])) && c < b) c++;
  if (["a", "an", "the"].includes(wordOf(tokens[c])) && c < b) c++;
  return { component: text(tokens.slice(c, b)), x: text(tokens.slice(b + 1, a)), y: text(tokens.slice(a + 1, end)) };
}

/**
 * "Put a cache between A and B": the core's insert_between, which keeps the replaced connection's kind,
 * relation, label, props and sides. Only for the new node that is the clause's component (and the two
 * endpoints it names); other additions are left alone. That node, answered with add + A -> new + new ->
 * B, or connected to only one of A and B, becomes the insert. Either way, a remove of the connection an
 * insert_between replaces is dropped (the insert does it).
 */
export function betweenAsInsert(
  ops: DiagramOp[],
  request: string,
  diagram: DiagramFile,
  refs: ReplyRefs,
  batch: readonly string[],
): DiagramOp[] {
  const id = (r: string) => refs.existingId(r);
  const edgeOf = (t: string) => {
    const parts = t.split("->");
    if (parts.length !== 2) return diagram.edges.find((e) => e.id === id(t))?.id;
    const [a, b] = parts.map((p) => id(p.trim()));
    return diagram.edges.find((e) => e.from === a && e.to === b)?.id;
  };
  let out = [...ops];
  const intent = betweenIntent(request);
  const phraseRef = (p: string) => {
    const bare = p.replace(/^(?:the|a|an)\s+/i, "").trim();
    const exact = refs.strict(bare);
    return exact && "ref" in exact ? exact.ref : (refs.match(bare) ?? undefined);
  };
  const [x, y] = intent ? [phraseRef(intent.x), phraseRef(intent.y)] : [undefined, undefined];
  // The new node the clause puts between them: the one that matches its component, or the only one.
  const target = intent && x && y && x !== y ? betweenTarget(intent.component, refs, batch) : undefined;
  const add = target ? out.find((o) => o.op === "add_node" && o.key === target) : undefined;
  if (add && add.op === "add_node" && x && y) {
    const touching = out.filter((o): o is Connect => o.op === "connect" && (o.to === add.key || o.from === add.key));
    const ends = touching.map((c) => id(c.to === add.key ? c.from : c.to) ?? (c.to === add.key ? c.from : c.to));
    const both =
      touching.length === 2 &&
      touching.some((c) => c.to === add.key && ends[touching.indexOf(c)] === x) &&
      touching.some((c) => c.from === add.key && ends[touching.indexOf(c)] === y);
    const one = touching.length === 1 && (ends[0] === x || ends[0] === y);
    const edge = diagram.edges.find((e) => (e.from === x && e.to === y) || (e.from === y && e.to === x));
    if ((both || one) && edge) {
      const insert: DiagramOp = {
        op: "insert_between",
        from: x,
        to: y,
        kind: add.kind,
        label: add.label,
        key: add.key,
        ...(add.sublabel ? { sublabel: add.sublabel } : {}),
      };
      out = out.filter((o) => !touching.includes(o as Connect)).map((o) => (o === add ? insert : o));
    }
  }
  // An insert_between with a remove of the same connection: drop the remove.
  for (const ins of out.filter((o): o is Extract<DiagramOp, { op: "insert_between" }> => o.op === "insert_between")) {
    const [a, b] = [id(ins.from), id(ins.to)];
    const edge = diagram.edges.find((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
    if (edge)
      out = out.filter((o) => !(o.op === "remove" && o.targets.length === 1 && edgeOf(o.targets[0]) === edge.id));
  }
  return out;
}

/** The new node a "between" clause's component phrase names: one match by words or stencil, or the only new node. */
function betweenTarget(component: string, refs: ReplyRefs, batch: readonly string[]): string | undefined {
  const named = namedStencil(component);
  const words = refWords(component);
  const scored = batch.map((key) => {
    const n = refs.newNode(key)!;
    const overlap = refWords(`${n.label} ${n.kind}`).filter((w) => words.includes(w)).length;
    return { key, n: overlap + (named && resolveKind(n.kind, n.label).id === named ? 2 : 0) };
  });
  const top = Math.max(0, ...scored.map((x) => x.n));
  const best = scored.filter((x) => x.n === top);
  if (top > 0) return best.length === 1 ? best[0].key : undefined;
  return batch.length === 1 ? batch[0] : undefined;
}
