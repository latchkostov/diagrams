/** Partition independent seeds, retaining exact coverage and stable replay numbers. */
export function fuzzSeeds(count: number, replay?: string, shard?: string, pinned: number[] = []): number[] {
  if (replay) {
    const seed = Number(replay);
    if (!Number.isSafeInteger(seed)) throw new Error("Replay seed must be an integer");
    return [seed];
  }
  const seeds = [...new Set([...Array.from({ length: count }, (_, i) => i + 1), ...pinned])];
  if (shard === undefined) return seeds;
  if (!/^[1-9]\d*\/[1-9]\d*$/.test(shard)) throw new Error("RESOURCE_FUZZ_SHARD requires i/n (one-based)");
  const [current, total] = shard.split("/").map(Number);
  if (!Number.isSafeInteger(total) || current > total) throw new Error("Invalid RESOURCE_FUZZ_SHARD range");
  return seeds.filter((seed) => (seed - 1) % total === current - 1);
}
