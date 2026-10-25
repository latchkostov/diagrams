/**
 * Message-rule identity (docs/design-review/2026-10-25-rule-identity.md). Documents always hold the authored form:
 * legacy strings/maps and ID-less rules stay as written. An ID-less rule's identity is derived on read from its
 * incoming type, so every copy (history, room projection, proposal validation, reload) derives the same ID and
 * nothing is ever stripped or serialized. Only editMessageProps writes IDs: for rules created or edited.
 * Editing-only: the read-only viewer stubs this module (scripts/interactive-viewer.ts).
 */
import { validRule as valid, type MessageRule } from "./emitsMapping";

export type { Emits, MessageRule } from "./emitsMapping";
export type IdentifiedMessageRule = MessageRule & { id: string };

/** Available on HTTP self-hosts too; randomUUID requires a secure context. */
export function newMessageRuleId(): string {
  const [a, b] = crypto.getRandomValues(new Uint32Array(2));
  return `rule-${a.toString(36)}${b.toString(36)}`;
}

/** The authored rules, never copied: legacy shorthand becomes ID-less rules. */
function authoredRules(emits: unknown): MessageRule[] {
  return typeof emits === "string"
    ? [{ receives: "*", sends: emits }]
    : Array.isArray(emits)
      ? emits.filter(valid)
      : emits && typeof emits === "object"
        ? Object.entries(emits)
            .filter((entry): entry is [string, string] => typeof entry[1] === "string")
            .map(([receives, sends]) => ({ receives, sends }))
        : [];
}

const hash = (text: string) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};

interface Identified {
  rules: IdentifiedMessageRule[];
  authored: MessageRule[];
}
const identified = new WeakMap<object, Identified>();

function identify(emits: unknown): Identified {
  const cached = emits && typeof emits === "object" ? identified.get(emits) : undefined;
  if (cached) return cached;
  const authored = authoredRules(emits);
  // First occurrences of explicit IDs are reserved before any derived ID is chosen.
  const used = new Set<string>();
  const owns = authored.map(
    (rule) => !!rule.id && typeof rule.id === "string" && !used.has(rule.id) && !!used.add(rule.id),
  );
  // Each base resumes at its next free suffix: an ID probed once is never probed again, so repeated incoming
  // types in untrusted input cost linear work in total.
  const next = new Map<string, number>();
  const rules = authored.map((rule, i) => {
    if (owns[i]) return rule as IdentifiedMessageRule;
    const base = `rule-${hash(rule.receives)}`;
    let id = base;
    if (used.has(id)) {
      let n = next.get(base) ?? 2;
      while (used.has((id = `${base}-${n}`))) n++;
      next.set(base, n + 1);
    }
    used.add(id);
    return { ...rule, id };
  });
  const result = { rules, authored };
  if (emits && typeof emits === "object") identified.set(emits, result);
  return result;
}

/** Every rule with its runtime ID: explicit, or derived for ID-less and duplicate-ID rules. Never mutate. */
export const messageRules = (emits: unknown): readonly IdentifiedMessageRule[] => identify(emits).rules;

const same = (a: MessageRule, b: MessageRule) => {
  const keys = Object.keys(a).filter((key) => key !== "id");
  const other = b as unknown as Record<string, unknown>;
  return (
    keys.length === Object.keys(b).filter((key) => key !== "id").length &&
    keys.every((key) => JSON.stringify((a as unknown as Record<string, unknown>)[key]) === JSON.stringify(other[key]))
  );
};

/**
 * The one write boundary (inspector, bulk editor, agent operations). Untouched rules keep their authored object,
 * so an unedited list keeps its exact form; created or edited rules carry an explicit ID: kept, inherited by
 * incoming type, or fresh.
 */
export function editMessageProps(
  props: Record<string, unknown>,
  previous: Record<string, unknown>,
): Record<string, unknown> {
  const next = props.emits;
  if (next == null || next === previous.emits) return props;
  const before = identify(previous.emits);
  const at = new Map(before.rules.map((rule, i) => [rule.id, i]));
  const byType = new Map(before.rules.map((rule) => [rule.receives, rule.id]));
  const incoming = authoredRules(next);
  if (!incoming.length) return props;
  // Explicit IDs claim first, so a renamed rule keeps its ID even when another row could inherit it.
  const used = new Set<string>();
  const ids = incoming.map((rule) =>
    rule.id && typeof rule.id === "string" && !used.has(rule.id) && used.add(rule.id) ? rule.id : undefined,
  );
  const emits = incoming.map((rule, i) => {
    let id = ids[i];
    if (id === undefined) {
      id = byType.get(rule.receives);
      // A fresh ID never reuses one the previous list held.
      if (id === undefined || used.has(id))
        do id = newMessageRuleId();
        while (used.has(id) || at.has(id));
      used.add(id);
    }
    const j = at.get(id);
    if (j !== undefined && same(before.rules[j], rule)) return before.authored[j];
    const { id: _id, ...content } = rule;
    return { id, ...content };
  });
  const authored = new Set(before.authored);
  if (emits.length === before.authored.length && emits.every((rule, i) => rule === before.authored[i]))
    return { ...props, emits: previous.emits };
  // Removing or reordering untouched legacy rules keeps the legacy map.
  if (!Array.isArray(previous.emits) && emits.every((rule) => authored.has(rule)))
    return { ...props, emits: Object.fromEntries(emits.map((rule) => [rule.receives, rule.sends])) };
  return { ...props, emits };
}
