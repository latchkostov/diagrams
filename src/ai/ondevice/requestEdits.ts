// What an edit request says about renames and kind changes, and the reply's rename and kind-change ops
// filled in from it. Run 4: the model answered "Rename Payments service to Billing service" with a
// rename that had no label, and "Make Orders database a MongoDB" with a kind change that had no kind
// plus an empty rename of the same node. The request said both values plainly.
//
// Only when the op lacks the field and the request's pattern names the same element as the op's target;
// a value the model did write is never replaced, except where the model picked the wrong one of the two
// ops for exactly what the request asked (a rename to the kind "make X a MongoDB" asks for).

import { namedStencil } from "../stencils";

export interface EditIntent {
  /** The element, as the request names it ("Orders database", "this"). */
  target: string;
  /** "label" for a rename, "kind" for a kind change. */
  field: "label" | "kind";
  value: string;
}

/** Where a clause's value ends: the request's end, punctuation, or "and"/"then" before the next clause. */
const END = String.raw`(?=$|[,;]|\.(?:\s|$)|\s+(?:and|then)\s+)`;
const ARTICLE = String.raw`(?:(?:a|an|the)\s+)?`;
const PATTERNS: { field: EditIntent["field"]; re: RegExp }[] = [
  // "Rename X to Y", "rename X as Y".
  { field: "label", re: new RegExp(String.raw`\brename\s+${ARTICLE}(.+?)\s+(?:to|as)\s+(.+?)${END}`, "gi") },
  // "Make X a Y", "make X into a Y", "turn X into Y".
  {
    field: "kind",
    re: new RegExp(String.raw`\b(?:make|turn)\s+${ARTICLE}(.+?)\s+(?:into\s+${ARTICLE}|an?\s+)(.+?)${END}`, "gi"),
  },
  // "Change X to Y", "change the kind of X to a Y".
  {
    field: "kind",
    re: new RegExp(
      String.raw`\bchange\s+(?:the\s+(?:kind|type|technology)\s+of\s+)?${ARTICLE}(.+?)\s+(?:to|into)\s+${ARTICLE}(.+?)${END}`,
      "gi",
    ),
  },
  // "X should be a Y" (X starts its clause).
  {
    field: "kind",
    re: new RegExp(
      String.raw`(?:^|[,;]\s*|\.\s+|\b(?:and|then)\s+)${ARTICLE}(.+?)\s+should\s+(?:be|become)\s+${ARTICLE}(.+?)${END}`,
      "gi",
    ),
  },
];

const clean = (s: string) =>
  s
    .trim()
    .replace(/^["'“‘]|["'”’]$/g, "")
    .trim();

/**
 * The renames and kind changes a request asks for, each with the element as the request names it. A kind
 * must name a technology the catalogue knows ("change X to Y" with an unknown Y says nothing certain).
 */
export function editIntents(request: string): EditIntent[] {
  const out: EditIntent[] = [];
  for (const { field, re } of PATTERNS)
    for (const m of request.matchAll(re)) {
      // The target is in the value's own clause ("…, then Payments should be a Go service").
      const target = clean(
        (m[1].split(/[,;]|\.\s+|\s+(?:and|then)\s+/i).pop() ?? "").replace(/^\s*(?:a|an|the)\s+/i, ""),
      );
      const value = clean(m[2]);
      if (!target || !value) continue;
      if (field === "kind" && !namedStencil(value)) continue;
      out.push({ target, field, value });
    }
  return out;
}

/** The parts of a reply op this reads and fills (CompactOp's, structurally). */
export interface EditOp {
  op: string;
  target?: string;
  label?: string;
  kind?: string;
}

const has = (v: unknown) => typeof v === "string" && v.trim().length > 0;
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The reply's rename and kind-change ops, filled in from the request. `element` resolves a name (the
 * op's target, or the request's words) to an existing element's id, or undefined.
 * - A rename with no label gets the label "Rename X to Y" gives X; with no kind either, a kind change
 *   the request asks for X becomes its kind (a kind-only rename is a kind change).
 * - A kind change with no kind gets the kind "Make X a Y" (or "change X to Y", "X should be Y") gives X;
 *   with no label either, the label a rename of X asks for.
 * - A rename whose label is exactly the kind the request asks X to become, with no rename of X asked
 *   for, is that kind change; and the other way round.
 * - Then an op that is the same change as an earlier one, or still empty while another op changes the
 *   same element, is dropped ("change_kind Orders database" + an empty "rename Orders database").
 */
export function fillEdits<T extends EditOp>(
  ops: readonly T[],
  request: string,
  element: (name: string) => string | undefined,
): T[] {
  const intents = editIntents(request);
  const idOf = (name: string | undefined) => (name ? element(name) : undefined);
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
  // Duplicates and leftovers.
  const seen = new Set<string>();
  const changes = new Set(ops.flatMap((o, i) => (isEdit(o) && (has(o.label) || has(o.kind)) ? [targetIds[i]] : [])));
  return ops.filter((o, i) => {
    if (!isEdit(o)) return true;
    const id = targetIds[i];
    if (id === undefined) return true;
    if (!has(o.label) && !has(o.kind)) return !changes.has(id);
    const sig = `${id}\u0000${has(o.label) ? o.label!.trim() : ""}\u0000${has(o.kind) ? o.kind!.trim().toLowerCase() : ""}`;
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
}

const isEdit = (o: EditOp) => o?.op === "rename" || o?.op === "change_kind" || o?.op === "change";
