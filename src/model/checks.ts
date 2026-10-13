import type { CheckIgnore, DiagramChecks } from "./types";

// The file format's `checks` field: rules turned off and findings ignored for one diagram. Validation
// only; the checks themselves live in src/checks/ (a lazy chunk). Bounded, like every untrusted input.

export const CHECK_LIMITS = { maxOff: 100, maxIgnores: 2_000, maxReason: 200, maxTarget: 200 } as const;

/** Rule ids are short kebab-case words ("dead-letter"). Unknown ones are kept: a newer app may have them. */
export const CHECK_RULE_ID = /^[a-z][a-z0-9-]{0,49}$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Valid `checks` for a file whose element ids are `ids`, or undefined when nothing is left. Bounded before any
 * work: only the first 100 `off` and 2,000 `ignore` entries are read (more is a warning), and deduplication
 * is a Set, so a hostile file costs no more than a full one. Malformed entries are dropped with a warning; an
 * ignore whose target is gone is dropped silently (it's stale, not wrong); a long reason is shortened.
 * `aliases` are the ids an ignore's target was also given when elements that shared it were renamed apart
 * (validateDiagram): the ignore is kept for each, within the same 2,000, counted before each copy.
 */
export function sanitizeChecks(
  raw: unknown,
  ids: ReadonlySet<string>,
  warnings: string[],
  aliases: ReadonlyMap<string, readonly string[]> = new Map(),
): DiagramChecks | undefined {
  if (raw === undefined) return undefined;
  if (!isObj(raw)) {
    warnings.push("The checks field wasn't an object and was ignored.");
    return undefined;
  }
  let skipped = 0;
  let truncated = false;
  /** The first `max` entries of a list, or null (counted as malformed) when it isn't one. */
  const bounded = (list: unknown, max: number): readonly unknown[] | null => {
    if (list === undefined) return [];
    if (!Array.isArray(list)) {
      skipped++;
      return null;
    }
    if (list.length > max) truncated = true;
    return list.length > max ? list.slice(0, max) : list;
  };
  const off = new Set<string>();
  for (const id of bounded(raw.off, CHECK_LIMITS.maxOff) ?? []) {
    if (typeof id !== "string" || !CHECK_RULE_ID.test(id)) skipped++;
    else off.add(id);
  }
  const ignore = new Map<string, CheckIgnore>();
  read: for (const item of bounded(raw.ignore, CHECK_LIMITS.maxIgnores) ?? []) {
    if (
      !isObj(item) ||
      typeof item.rule !== "string" ||
      !CHECK_RULE_ID.test(item.rule) ||
      typeof item.target !== "string" ||
      !item.target ||
      item.target.length > CHECK_LIMITS.maxTarget ||
      (item.reason !== undefined && typeof item.reason !== "string")
    ) {
      skipped++;
      continue;
    }
    const key = (target: string) => `${item.rule}\u0000${target}`;
    if (ignore.has(key(item.target))) continue;
    const reason =
      typeof item.reason === "string"
        ? item.reason
            .slice(0, CHECK_LIMITS.maxReason * 4)
            .trim()
            .slice(0, CHECK_LIMITS.maxReason)
        : "";
    // A target's aliases are its own (renamed ids are new), so no copy repeats another ignore; they come in suffix
    // order, so once one is too long to be a target, the rest are too.
    for (const target of [item.target, ...(aliases.get(item.target) ?? [])]) {
      if (target.length > CHECK_LIMITS.maxTarget) break;
      if (!ids.has(target)) continue;
      if (ignore.size >= CHECK_LIMITS.maxIgnores) {
        truncated = true;
        break read;
      }
      ignore.set(key(target), { rule: item.rule, target, ...(reason ? { reason } : {}) });
    }
  }
  if (skipped) warnings.push(`${skipped} malformed check setting${skipped === 1 ? " was" : "s were"} ignored.`);
  if (truncated)
    warnings.push(
      `Only the first ${CHECK_LIMITS.maxOff} turned-off checks and ${CHECK_LIMITS.maxIgnores} ignored findings were read.`,
    );
  if (!off.size && !ignore.size) return undefined;
  return { ...(off.size ? { off: [...off] } : {}), ...(ignore.size ? { ignore: [...ignore.values()] } : {}) };
}

/** The rules this version runs, in the order findings list them. Ids are a public contract: never renamed. */
export const CHECK_RULES = [
  "dead-letter",
  "no-reader",
  "sync-cycle",
  "sync-chain",
  "shared-database",
  "entry-gateway",
  "capacity",
  "single-point",
  "secret-identity",
  "schema-registry",
  // Only Run simulations raises it (src/checks/evidence.ts), never the checks that run as you edit.
  "dropped",
] as const;
export type CheckRuleId = (typeof CHECK_RULES)[number];
export const isCheckRule = (v: unknown): v is CheckRuleId =>
  typeof v === "string" && (CHECK_RULES as readonly string[]).includes(v);

/** `checks` without ignores whose element is gone (what a save writes), or undefined when nothing is left. */
export function pruneChecks(checks: DiagramChecks | undefined, ids: ReadonlySet<string>): DiagramChecks | undefined {
  if (!checks?.ignore?.some((i) => !ids.has(i.target))) return checks;
  const ignore = checks.ignore.filter((i) => ids.has(i.target));
  const out = { ...(checks.off?.length ? { off: checks.off } : {}), ...(ignore.length ? { ignore } : {}) };
  return out.off || out.ignore ? out : undefined;
}
