import { expect, it, vi } from "vitest";
import { cacheFixture } from "../lab/cacheFixture";
import { analyzeCapacity } from "./capacity";
import * as math from "./cache/cacheMath";
import { GROWTH_FACTOR } from "../test/complexity";

it("unchanged cache inputs do not repeat popularity math as an unrelated path settles", () => {
  const measure = (length: number) => {
    const d = cacheFixture();
    d.nodes.push({
      id: "other",
      stencil: "client.browser",
      label: "Other readers",
      x: 0,
      y: 500,
      props: { ratePerSec: 10 },
    });
    for (let i = 0; i < length; i++) {
      d.nodes.push({ id: `stage-${i}`, stencil: "generic.service", label: `Stage ${i}`, x: (i + 1) * 300, y: 500 });
      d.edges.push({ id: `path-${i}`, from: i ? `stage-${i - 1}` : "other", to: `stage-${i}`, kind: "async" });
    }
    const spy = vi.spyOn(math, "cacheHitShare");
    try {
      const result = analyzeCapacity(d);
      return { calls: spy.mock.calls.length, hit: result.cacheDemand!.cache[""].hitRatio, converged: result.converged };
    } finally {
      spy.mockRestore();
    }
  };
  const short = measure(16),
    long = measure(16 * GROWTH_FACTOR);
  expect(short.converged && long.converged).toBe(true);
  expect(short.hit).toBe(long.hit);
  expect(long.calls).toBeLessThanOrEqual(short.calls * 2);
});
