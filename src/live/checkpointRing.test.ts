import { expect, it } from "vitest";
import { CHECKPOINT_BYTES, trimCheckpoints } from "./checkpointRing";

const entry = (time: number, bytes = 1) => ({ cp: { time }, bytes });

it("bounds growing snapshots by bytes rather than their count", () => {
  let ring: ReturnType<typeof entry>[] = [];
  for (let time = 0; time <= 300_000; time += 5000) {
    ring.push(entry(time, 1024 * (1024 + time / 50)));
    ring = trimCheckpoints(ring);
    expect(ring.reduce((sum, e) => sum + e.bytes, 0)).toBeLessThanOrEqual(CHECKPOINT_BYTES);
    expect(ring.at(-1)!.cp.time).toBe(time);
  }
  expect(ring[0].cp.time).toBe(0);
  expect(ring[1].cp.time).toBeLessThan(180_000);
});

it("keeps recent samples dense and old history sparse across logarithmic ages", () => {
  let ring: ReturnType<typeof entry>[] = [];
  for (let time = 0; time <= 600_000; time += 5000) {
    ring.push(entry(time));
    ring = trimCheckpoints(ring, 16);
  }
  expect(ring).toHaveLength(16);
  expect(ring[0].cp.time).toBe(0);
  expect(ring.at(-1)!.cp.time).toBe(600_000);
  expect(ring[1].cp.time - ring[0].cp.time).toBeGreaterThan(5000);
  expect(ring[1].cp.time).toBeLessThan(300_000);
  expect(ring.at(-1)!.cp.time - ring.at(-2)!.cp.time).toBe(5000);
  expect(ring.filter((e) => e.cp.time >= 480_000).length).toBeGreaterThan(6);
});

it("lets neither the origin nor a single oversized snapshot override the cap", () => {
  let ring = [entry(0, 5), entry(5000, 8), entry(10000, 11)];
  ring = trimCheckpoints(ring, 10);
  expect(ring).toEqual([entry(5000, 8)]);
  ring = trimCheckpoints(ring, 0);
  expect(ring).toEqual([]);
});
