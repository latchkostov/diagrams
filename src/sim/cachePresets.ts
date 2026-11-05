import type { CachePolicy, CacheTable } from "../model/caching";

/** PR 3's first fix. Freshness and origin capacity are deliberately untouched. */
export const oneFetchPerItem = (policy: CachePolicy): CachePolicy => ({ ...policy, coalesce: true });

export function coalesceRule(table: CacheTable, rule: string): CacheTable {
  return rule === ""
    ? { ...table, default: table.default && oneFetchPerItem(table.default) }
    : { ...table, rules: table.rules.map((r) => (r.id === rule ? { ...r, policy: oneFetchPerItem(r.policy) } : r)) };
}

/** The smallest 1–2–5 duration covering four measured origin trips, at least one second. */
export function staleWindow(fetchMs: number): number {
  const required = Math.max(1000, 4 * fetchMs);
  let unit = 1;
  while (unit * 10 < required) unit *= 10;
  return Math.min(
    86_400_000,
    [1, 2, 5, 10].map((n) => n * unit).find((n) => n >= required)!,
  );
}
export function staleRule(table: CacheTable, rule: string, fetchMs: number): CacheTable {
  const change = (policy: CachePolicy) => ({
    ...oneFetchPerItem(policy),
    staleWhileRevalidateMs: Math.max(policy.staleWhileRevalidateMs ?? 0, staleWindow(fetchMs)),
  });
  return rule === ""
    ? { ...table, default: table.default && change(table.default) }
    : { ...table, rules: table.rules.map((r) => (r.id === rule ? { ...r, policy: change(r.policy) } : r)) };
}
