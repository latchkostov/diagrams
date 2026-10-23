import { describe, expect, it } from "vitest";
import { shareOut } from "./brokerDelivery";

describe("shareOut: max-min fair parts of a dot", () => {
  it("gives equal parts when every consumer has room", () => {
    expect(shareOut(9, [10, 10, 10])).toEqual({ parts: [3, 3, 3], left: 0 });
  });

  it("gives what a capped consumer can't take to the others equally, whatever the order", () => {
    // 100 real requests over windows of 151, 3 and 151: 3 to the narrow one, 48.5 to each wide one.
    const caps = [151, 3, 151];
    for (const order of [
      [0, 1, 2],
      [1, 0, 2],
      [0, 2, 1],
      [2, 1, 0],
    ]) {
      const { parts, left } = shareOut(
        100,
        order.map((i) => caps[i]),
      );
      expect(left).toBe(0);
      order.forEach((i, k) => expect(parts[k]).toBeCloseTo([48.5, 3, 48.5][i], 9));
    }
  });

  it("leaves what no window holds", () => {
    expect(shareOut(10, [2, 3])).toEqual({ parts: [2, 3], left: 5 });
  });

  it("keeps a whole request per part: at most ⌊total⌋ consumers, the earliest in turn, each with room for one", () => {
    expect(shareOut(2.5, [5, 5, 5])).toEqual({ parts: [1.25, 1.25, 0], left: 0 });
    expect(shareOut(4, [0.5, 5, 5])).toEqual({ parts: [0, 2, 2], left: 0 });
    for (const part of shareOut(7.3, [1, 9, 2.2, 4]).parts) expect(part === 0 || part >= 1).toBe(true);
  });
});
