import type { CheckIgnore, DiagramChecks } from "./types";

// The file format's `checks` field: rules turned off and findings ignored for one diagram. Validation
// only; the checks themselves live in src/checks/ (a lazy chunk). Bounded, like every untrusted input.

export const CHECK_LIMITS = { maxOff: 100, maxIgnores: 2_000, maxReason: 200, maxTarget: 200 } as const;

/** Rule ids are short kebab-case words ("dead-letter"). Unknown ones are kept: a newer app may have them. */
export const CHECK_RULE_ID = /^[a-z][a-z0-9-]{0,49}$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Valid `checks` for a file whose element ids are `ids`, or undefined when nothing is left. Malformed
 * entries are dropped with a warning; an ignore whose target is gone is dropped silently (it's stale,
 * not wrong); a long reason is shortened.
 */
export function sanitizeChecks(raw: unknown, ids: ReadonlySet<string>, warnings: string[]): DiagramChecks | undefined {
  if (raw === undefined) return undefined;
  if (!isObj(raw)) {
    warnings.push("The checks field wasn't an object and was ignored.");
    return undefined;
  }
  let skipped = 0;
  const off: string[] = [];
  if (raw.off !== undefined) {
    if (!Array.isArray(raw.off)) skipped++;
    else
      for (const id of raw.off) {
        if (typeof id !== "string" || !CHECK_RULE_ID.test(id)) skipped++;
        else if (!off.includes(id)) off.push(id);
      }
  }
  const ignore: CheckIgnore[] = [];
  const seen = new Set<string>();
  if (raw.ignore !== undefined) {
    if (!Array.isArray(raw.ignore)) skipped++;
    else
      for (const item of raw.ignore) {
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
        if (!ids.has(item.target)) continue;
        const key = `${item.rule}\u0000${item.target}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const reason = typeof item.reason === "string" ? item.reason.trim().slice(0, CHECK_LIMITS.maxReason) : "";
        ignore.push({ rule: item.rule, target: item.target, ...(reason ? { reason } : {}) });
      }
  }
  if (skipped) warnings.push(`${skipped} malformed check setting${skipped === 1 ? " was" : "s were"} ignored.`);
  if (off.length > CHECK_LIMITS.maxOff || ignore.length > CHECK_LIMITS.maxIgnores) {
    warnings.push(
      `Only the first ${CHECK_LIMITS.maxOff} turned-off checks and ${CHECK_LIMITS.maxIgnores} ignored findings were kept.`,
    );
    off.length = Math.min(off.length, CHECK_LIMITS.maxOff);
    ignore.length = Math.min(ignore.length, CHECK_LIMITS.maxIgnores);
  }
  if (!off.length && !ignore.length) return undefined;
  return { ...(off.length ? { off } : {}), ...(ignore.length ? { ignore } : {}) };
}

/** The rules this version runs, in the order findings list them. Ids are a public contract: never renamed. */
export const CHECK_RULES = ["dead-letter", "no-reader", "sync-cycle", "capacity"] as const;
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
