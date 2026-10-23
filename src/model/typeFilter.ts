// Static analysis only: kept out of src/sim/topology.ts so playback chunks never carry it.
/**
 * acceptsType compiled once for repeated static analysis: exact names in a set and wildcard prefixes grouped by
 * length, so one check costs a lookup per distinct prefix length no longer than the type. `cost` is the work
 * compiling took. Callers charge it, and every typeFilterAccepts check, to their own work budget.
 */
export interface TypeFilter {
  exact: Set<string>;
  prefixes: Map<number, Set<string>>;
  lengths: number[];
  cost: number;
}

export function compileTypeFilter(filter: readonly unknown[]): TypeFilter {
  const exact = new Set<string>();
  const prefixes = new Map<number, Set<string>>();
  let cost = 1;
  for (const pattern of filter) {
    cost++;
    if (typeof pattern !== "string") continue;
    cost += pattern.length >> 4;
    if (!pattern.endsWith("*")) {
      exact.add(pattern);
      continue;
    }
    const prefix = pattern.slice(0, -1);
    const set = prefixes.get(prefix.length) ?? new Set<string>();
    set.add(prefix);
    prefixes.set(prefix.length, set);
  }
  return { exact, prefixes, lengths: [...prefixes.keys()].sort((a, b) => a - b), cost };
}

/** Exactly acceptsType(filter, type) for the compiled filter; undefined once `spend` refuses more work. */
export function typeFilterAccepts(
  filter: TypeFilter,
  type: string,
  spend: (amount: number) => boolean,
): boolean | undefined {
  if (!spend(1 + (type.length >> 4))) return undefined;
  if (filter.exact.has(type)) return true;
  for (const length of filter.lengths) {
    if (length > type.length) break;
    if (!spend(1 + (length >> 4))) return undefined;
    if (filter.prefixes.get(length)!.has(type.slice(0, length))) return true;
  }
  return false;
}
