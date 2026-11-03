import type { CachePolicy, CacheTable } from "../model/caching";

/** PR 3's first fix. Freshness and origin capacity are deliberately untouched. */
export const oneFetchPerItem = (policy: CachePolicy): CachePolicy => ({ ...policy, coalesce: true });

export function coalesceRule(table: CacheTable, rule: string): CacheTable {
  return rule === ""
    ? { ...table, default: table.default && oneFetchPerItem(table.default) }
    : { ...table, rules: table.rules.map((r) => (r.id === rule ? { ...r, policy: oneFetchPerItem(r.policy) } : r)) };
}
