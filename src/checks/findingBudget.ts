import type { Finding } from "./types";

/** Display data only: authored names and types stay intact in the diagram and analysis. */
export const FINDING_NAME_MAX = 200;
export function findingName(name: string): string {
  if (name.length <= FINDING_NAME_MAX) return name;
  const chars = Array.from(name.slice(0, 2 * FINDING_NAME_MAX + 2));
  return chars.length <= FINDING_NAME_MAX ? name : `${chars.slice(0, FINDING_NAME_MAX - 1).join("")}…`;
}

/** Shared per-diagram output-character ceiling for amplified findings, including their neutral UI metadata. */
export const FINDINGS_BUDGET = 1_000_000;

/**
 * Reserve before constructing output. Count every string occurrence, including ids and metadata; JSON escaping
 * costs at most six characters per UTF-16 unit. Fixed fields, keys and punctuation fit in the 1,024-char reserve.
 * No full-string serialization or collection is needed to reject an oversized finding.
 */
export function findingBudget(limit = FINDINGS_BUDGET) {
  let remaining = limit;
  return {
    take(strings: Iterable<string>) {
      let cost = 1024;
      for (const value of strings) {
        cost += 6 * value.length;
        if (cost > remaining) return false;
      }
      if (cost > remaining) return false;
      remaining -= cost;
      return true;
    },
  };
}

/** Counts travel separately from findings so a truncated result is never reported as clean. */
export function omission(rule: Finding["rule"], count: number): Finding {
  return {
    id: `${rule}:*omitted`,
    rule,
    severity: "suggestion",
    target: "",
    elements: [],
    title: "",
    message: "",
    rationale: "",
    omitted: count,
  };
}
