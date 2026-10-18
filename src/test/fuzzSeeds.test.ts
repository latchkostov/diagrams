import { expect, it } from "vitest";
import { fuzzSeeds } from "./fuzzSeeds";

it.each([140, 200, 5000])("partitions %i seeds without losing or duplicating any replay", (count) => {
  const whole = fuzzSeeds(count, undefined, undefined, [505, 1724]);
  const shards = [1, 2, 3, 4].map((i) => fuzzSeeds(count, undefined, `${i}/4`, [505, 1724]));
  expect(shards.flat().sort((a, b) => a - b)).toEqual(whole.sort((a, b) => a - b));
  expect(new Set(shards.flat()).size).toBe(whole.length);
  for (const shard of shards) expect(shard.length).toBeLessThanOrEqual(Math.ceil(count / 4) + 2);
});

it("a requested replay runs even when it belongs to another shard", () => {
  expect(fuzzSeeds(5000, "61", "2/4")).toEqual([61]);
  expect(fuzzSeeds(5000, "0", "2/4")).toEqual([0]);
  expect(fuzzSeeds(5000, "-1", "2/4")).toEqual([-1]);
  expect(fuzzSeeds(3, "")).toEqual([1, 2, 3]);
});

it.each(["0/4", "5/4", "1/0", "1", "2/3.5", "1/Infinity"])("rejects an invalid shard %s", (shard) => {
  expect(() => fuzzSeeds(20, undefined, shard)).toThrow();
});
