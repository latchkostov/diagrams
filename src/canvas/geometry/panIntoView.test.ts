import { describe, expect, it } from "vitest";
import { panIntoView } from "./fit";

const view = { x: 40, y: 72, width: 800, height: 600 };

describe("panIntoView (keep the selection in view when the inspector narrows the canvas)", () => {
  it("does nothing when everything is already visible", () => {
    const r = { x: 100, y: 100, width: 200, height: 80 };
    expect(panIntoView(r, r, { x: 0, y: 0, zoom: 1 }, view)).toBeNull();
  });

  it("pans just enough to bring a selection that's off to the right back in, keeping the zoom", () => {
    const r = { x: 900, y: 100, width: 200, height: 80 };
    const v = panIntoView(r, r, { x: 0, y: 0, zoom: 1 }, view)!;
    expect(v.zoom).toBe(1);
    expect(v.x).toBe(840 - 1100);
    expect(v.y).toBe(0);
  });

  it("works in screen space at any zoom", () => {
    const r = { x: 900, y: 300, width: 200, height: 80 };
    const v = panIntoView(r, r, { x: 10, y: 0, zoom: 0.5 }, view);
    // Right edge on screen: 1100 * 0.5 + 10 = 560, already inside 840: nothing to do.
    expect(v).toBeNull();
  });

  it("keeps the selection itself when its edges don't fit too", () => {
    const want = { x: -2000, y: 100, width: 4000, height: 80 };
    const must = { x: 900, y: 100, width: 200, height: 80 };
    const v = panIntoView(want, must, { x: 0, y: 0, zoom: 1 }, view)!;
    expect(v.x + 900).toBeGreaterThanOrEqual(view.x);
    expect(v.x + 1100).toBeLessThanOrEqual(view.x + view.width);
  });

  it("centres a selection that's bigger than the view", () => {
    const must = { x: 0, y: 0, width: 2000, height: 80 };
    const v = panIntoView(must, must, { x: 0, y: 200, zoom: 1 }, view)!;
    expect(v.x + 1000).toBeCloseTo(view.x + view.width / 2);
  });
});
