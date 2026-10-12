/**
 * Hands out ids not in `taken`, adding each: `base` while it's free, else `base-2`, `base-3`…, skipping ids in
 * `avoid` too (ids a file uses for elements not claimed yet). One counter per base: a base repeated n times costs
 * O(n), not O(n²), however a hostile file repeats it.
 */
export function idClaimer(taken: Set<string> = new Set(), avoid?: ReadonlySet<string>) {
  const next = new Map<string, number>();
  return (base: string): string => {
    let id = base;
    for (let k = next.get(base) ?? 2; taken.has(id) || (id !== base && !!avoid?.has(id)); k++) {
      id = `${base}-${k}`;
      next.set(base, k + 1);
    }
    taken.add(id);
    return id;
  };
}
