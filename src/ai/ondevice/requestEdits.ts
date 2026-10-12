// What an edit request says about renames and kind changes, and the reply's rename and kind-change ops
// filled in from it. Run 4: the model answered "Rename Payments service to Billing service" with a
// rename that had no label, and "Make Orders database a MongoDB" with a kind change that had no kind
// plus an empty rename of the same node. The request said both values plainly.
//
// Only when the op lacks the field and the request's clause names the same element as the op's target,
// and never from a negated clause ("Don't rename X to Y", "…not a MongoDB"). A value the model did write
// is never replaced, except where the model picked the wrong one of the two ops for exactly what the
// request asked (a rename to the kind "make X a MongoDB" asks for). The request is read by the shared
// clause tokenizer (requestClauses.ts): linear, and a quoted name is one token.

import { namedStencil } from "../stencils";
import { splitClauses, wordOf, type Token } from "./requestClauses";

export interface EditIntent {
  /** The element, as the request names it ("Orders database", "this"). */
  target: string;
  /** "label" for a rename, "kind" for a kind change. */
  field: "label" | "kind";
  value: string;
  /** From a negated clause: something the request says not to do. */
  negated: boolean;
}

/** Words that start an instruction: "…and make X a Y" is a new clause, "Billing and Shipping" isn't. */
const COMMANDS = new Set(
  "rename make turn change add remove delete put insert connect set replace move drop keep".split(" "),
);
const JOINERS: ReadonlySet<string> = new Set(["and", "then", "but"]);
const ARTICLES = new Set(["a", "an", "the"]);

/** Does this piece, after "and", "then" or "but", start an instruction of its own? */
const startsInstruction = (piece: readonly Token[]) =>
  piece.slice(0, 2).some((t) => COMMANDS.has(wordOf(t))) || piece.some((t) => wordOf(t) === "should");

/** The first token at or after `from` whose word is one of `words`; -1 when none. */
const find = (tokens: readonly Token[], words: readonly string[], from = 0) => {
  for (let i = Math.max(0, from); i < tokens.length; i++) if (words.includes(wordOf(tokens[i]))) return i;
  return -1;
};

/** Tokens as a name: a lone quoted name as written, else the words, without a leading article. */
function phrase(tokens: readonly Token[]): string {
  const ts = tokens.length > 1 && ARTICLES.has(wordOf(tokens[0])) ? tokens.slice(1) : tokens;
  if (ts.length === 1 && ts[0].kind === "quoted") return ts[0].text.trim();
  let s = ts.map((t) => t.text).join(" ");
  let end = s.length;
  while (end > 0 && "!?".includes(s[end - 1])) end--;
  s = s.slice(0, end);
  if ("'‘".includes(s[0] ?? "x")) s = s.slice(1);
  if ("'’".includes(s[s.length - 1] ?? "x")) s = s.slice(0, -1);
  return s.trim();
}

/** One clause's rename or kind change: target, field and value tokens. Null when it asks for neither. */
function clauseEdit(tokens: readonly Token[]): { target: Token[]; field: EditIntent["field"]; value: Token[] } | null {
  const skipArticle = (i: number) => (ARTICLES.has(wordOf(tokens[i])) ? i + 1 : i);
  // "Rename X to Y", "rename X as Y".
  let i = find(tokens, ["rename"]);
  if (i >= 0) {
    const j = find(tokens, ["to", "as"], i + 2);
    if (j > 0) return { target: tokens.slice(i + 1, j), field: "label", value: tokens.slice(j + 1) };
  }
  // "Make X a Y", "make X into a Y", "turn X into Y".
  i = find(tokens, ["make", "turn"]);
  if (i >= 0) {
    const j = find(tokens, ["a", "an", "into"], i + 2);
    if (j > 0) {
      const v = wordOf(tokens[j]) === "into" ? skipArticle(j + 1) : j + 1;
      return { target: tokens.slice(i + 1, j), field: "kind", value: tokens.slice(v) };
    }
  }
  // "Change X to Y", "change the kind of X to a Y".
  i = find(tokens, ["change"]);
  if (i >= 0) {
    let k = i + 1;
    if (wordOf(tokens[k]) === "the" && ["kind", "type", "technology"].includes(wordOf(tokens[k + 1])))
      k += wordOf(tokens[k + 2]) === "of" ? 3 : 0;
    const j = find(tokens, ["to", "into"], k + 1);
    if (j > 0) return { target: tokens.slice(k, j), field: "kind", value: tokens.slice(skipArticle(j + 1)) };
  }
  // "X should be a Y", "X should become Y".
  i = find(tokens, ["should"], 1);
  if (i > 0 && ["be", "become"].includes(wordOf(tokens[i + 1])))
    return { target: tokens.slice(0, i), field: "kind", value: tokens.slice(skipArticle(i + 2)) };
  return null;
}

/**
 * The renames and kind changes a request asks for, each with the element as the request names it, and
 * whether its clause is negated. A kind must name a technology the catalogue knows ("change X to Y" with
 * an unknown Y says nothing certain).
 */
export function editIntents(request: string): EditIntent[] {
  const out: EditIntent[] = [];
  for (const clause of splitClauses(request, JOINERS, startsInstruction)) {
    const e = clauseEdit(clause.tokens);
    if (!e) continue;
    const target = phrase(e.target);
    const value = phrase(e.value);
    if (!target || !value) continue;
    if (e.field === "kind" && !namedStencil(value)) continue;
    out.push({ target, field: e.field, value, negated: clause.negated });
  }
  return out;
}

/** The parts of a reply op this reads and fills (CompactOp's, structurally; already checked to be text). */
export interface EditOp {
  op: string;
  target?: string;
  label?: string;
  kind?: string;
  sublabel?: string;
}

const has = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const isEdit = (o: EditOp) => o?.op === "rename" || o?.op === "change_kind" || o?.op === "change";

/**
 * The reply's rename and kind-change ops, filled in from the request's positive (not negated)
 * instructions. `element` resolves a name (the op's target, or the request's words) to an existing
 * element's id, or undefined.
 * - A rename with no label gets the label "Rename X to Y" gives X; with no kind either, a kind change
 *   the request asks for X becomes its kind (a kind-only rename is a kind change).
 * - A kind change with no kind gets the kind "Make X a Y" (or "change X to Y", "X should be Y") gives X;
 *   with no label either, the label a rename of X asks for.
 * - A rename whose label is exactly the kind the request asks X to become, with no rename of X asked
 *   for, is that kind change; and the other way round.
 * Then, keeping the order, only ops with no effect go: one exactly like the element's change just
 * before it, and one with nothing to change (no label, kind or sublabel) beside another change of the
 * same element.
 */
export function fillEdits<T extends EditOp>(
  ops: readonly T[],
  request: string,
  element: (name: string) => string | undefined,
): T[] {
  const intents = editIntents(request).filter((i) => !i.negated);
  const idOf = (name: unknown) => (has(name) ? element(name) : undefined);
  const targetIds = ops.map((o) => (isEdit(o) ? idOf(o.target) : undefined));
  if (intents.length) {
    const intentIds = intents.map((i) => idOf(i.target));
    const asked = (field: EditIntent["field"], id: string | undefined) =>
      id === undefined ? undefined : intents.find((x, j) => x.field === field && intentIds[j] === id);
    ops = ops.map((o, i) => {
      if (!isEdit(o)) return o;
      const id = targetIds[i];
      const rename = asked("label", id);
      const kind = asked("kind", id);
      const label = has(o.label) ? o.label : undefined;
      const k = has(o.kind) ? o.kind : undefined;
      // The wrong one of the two ops, for exactly what was asked.
      if (o.op === "rename" && label && !k && kind && !rename && same(label, kind.value))
        return { ...o, op: "change_kind", kind: kind.value, label: undefined };
      if (o.op !== "rename" && k && !label && rename && !kind && same(k, rename.value))
        return { ...o, op: "rename", label: rename.value, kind: undefined };
      if (label || k) return o;
      // Nothing written: what the request asks for this element.
      const first = o.op === "rename" ? (rename ?? kind) : (kind ?? rename);
      if (!first) return o;
      return first.field === "label" ? { ...o, label: first.value } : { ...o, kind: first.value };
    });
  }
  // What each change does to its element: an empty one does nothing.
  const effect = (o: EditOp) =>
    has(o.label) || has(o.kind) || has(o.sublabel)
      ? JSON.stringify([o.label?.trim() ?? "", o.kind?.trim() ?? "", o.sublabel?.trim() ?? ""])
      : "";
  const changed = new Set(ops.flatMap((o, i) => (isEdit(o) && effect(o) ? [targetIds[i]] : [])));
  /** Each element's latest change so far, in order. */
  const latest = new Map<string, string>();
  return ops.filter((o, i) => {
    if (!isEdit(o)) return true;
    const id = targetIds[i];
    if (id === undefined) return true;
    const e = effect(o);
    if (!e) return !changed.has(id);
    if (latest.get(id) === e) return false;
    latest.set(id, e);
    return true;
  });
}
