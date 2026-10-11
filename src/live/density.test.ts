import { describe, expect, it } from "vitest";
import { densityStride } from "./particleRenderer";

describe("particle thinning on crowded edges", () => {
  it("draws every particle while the edge has room", () => {
    expect(densityStride(3, 10, 7)).toBe(1);
    expect(densityStride(10, 400, 7)).toBe(1);
  });

  it("thins a crowded edge so dots stay apart instead of merging into a line", () => {
    // 400px of edge at 7px dots holds about 25 dots.
    const stride = densityStride(200, 400, 7);
    expect(stride).toBeGreaterThan(1);
    expect(200 / stride).toBeLessThanOrEqual(26);
  });

  it("is safe with degenerate input", () => {
    expect(densityStride(50, 0, 7)).toBe(1);
    expect(densityStride(50, 100, 0)).toBe(1);
  });
});
