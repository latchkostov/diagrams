// A lookup from identifying values (ARNs, ids, names, principals, hosts) to the resources that have them, for the
// Terraform reader. A value shared by more than `limit` resources identifies none: its key is saturated for good,
// and every lookup of it returns nothing, whatever order the resources came in. Never a partial set.

export class BoundedIndex<V> {
  private readonly map = new Map<string, Set<V> | null>();

  constructor(
    private readonly limit: number,
    /** Keys at most: past this, new keys are ignored (lookups for them find nothing). */
    private readonly maxKeys = 500_000,
  ) {}

  add(key: string, value: V): void {
    const set = this.map.get(key);
    if (set === null) return;
    if (set) {
      if (set.has(value)) return;
      if (set.size >= this.limit) this.map.set(key, null);
      else set.add(value);
    } else if (this.map.size < this.maxKeys) this.map.set(key, new Set([value]));
  }

  /** The resources this value identifies: none when it's unknown or shared by too many. */
  get(key: string): V[] {
    const set = this.map.get(key);
    return set ? [...set] : [];
  }

  /** Shared by more than `limit` resources. */
  saturated(key: string): boolean {
    return this.map.get(key) === null;
  }
}
