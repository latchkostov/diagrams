import { describe, expect, it, vi } from "vitest";
import { chipMeasurer, fitChip, layoutChips } from "./chipLayout";
import { chipEdges } from "./chipEdges";
import { opGrowth } from "../test/opCounter";

const measure = (s: string, px: number) => s.length * px * 0.5;
describe("settled chips", () => {
  it("wraps full names before shortening and never inserts an ellipsis or cuts a word", () => {
    expect(fitChip("Continue watching", [70, 80], false, measure).lines).toBe("Continue\nwatching");
    expect(fitChip("Notification router", [65], true, measure).lines).toBe("Notif\nrouter");
    expect(fitChip("Status projector", [35], true, measure).lines).toBe("Status");
    expect(fitChip("Recommendations and the API", [55], false, measure).lines).not.toMatch(/…/);
    expect(fitChip("Unbreakableword", [20], true, measure).lines).toBe("Unbreakableword");
  });
  it("shares measured widths across nodes and layouts", () => {
    const raw = vi.fn(measure),
      cached = chipMeasurer(raw);
    for (let i = 0; i < 24; i++) fitChip("Continue watching", [70, 100], false, cached);
    const calls = raw.mock.calls.length;
    fitChip("Continue watching", [70, 100], false, cached);
    expect(raw).toHaveBeenCalledTimes(calls);
    expect(calls).toBeLessThan(12);
  });
  it.each([0.4, 0.25])("keeps natural routing boxes and grows only into free gaps at %s", (zoom) => {
    const input = [
      { id: "a", label: "Continue watching", x: 0, y: 0, width: 200, height: 72 },
      { id: "b", label: "Feature server", x: 360, y: 0, width: 200, height: 72 },
    ];
    const chips = layoutChips(input, zoom, measure);
    const a = chips.get("a")!,
      b = chips.get("b")!;
    expect(a.natural.width).toBe(200);
    expect(a.font * zoom).toBeGreaterThanOrEqual(10.5);
    expect(a.x + a.width).toBeLessThan(360 + b.x);
    expect(a.lines).not.toMatch(/…/);
  });
  it("merges nearby parallel lanes and adds a subtle direction mark to a single path", () => {
    const routes = new Map([
      [
        "a",
        {
          points: [
            { x: 0, y: 0 },
            { x: 200, y: 0 },
          ],
        },
      ],
      [
        "b",
        {
          points: [
            { x: 0, y: 10 },
            { x: 200, y: 10 },
          ],
        },
      ],
    ]);
    const { paths, lanes } = chipEdges(routes, 0.4);
    expect(paths.get("a")).toBe(paths.get("b"));
    expect(paths.get("a")).toContain(" M");
    expect(lanes.get("a")).toBe(lanes.get("b"));
    expect(routes.get("a")!.points[0].y).toBe(0);
  });
  it("merges a whole chain once rather than resnapping the middle lane", () => {
    const routes = new Map(
      [0, 10, 20].map((y, i) => [
        String(i),
        {
          points: [
            { x: 0, y },
            { x: 200, y },
          ],
        },
      ]),
    );
    const { paths } = chipEdges(routes, 0.4);
    expect(new Set(paths.values()).size).toBe(1);
  });
  it("indexes coincident lanes with linear membership storage and subquadratic work", () => {
    const routes = (n: number) =>
      new Map(
        Array.from({ length: n }, (_, i) => [
          String(i),
          {
            points: [
              { x: 0, y: 0 },
              { x: 200, y: 0 },
            ],
          },
        ]),
      );
    const small = routes(250),
      large = routes(2000);
    expect(
      opGrowth(
        () => chipEdges(small, 0.4),
        () => chipEdges(large, 0.4),
      ),
    ).toBeLessThanOrEqual(24);
    const { lanes } = chipEdges(large, 0.4);
    expect(lanes.size).toBe(large.size);
    expect([...lanes.values()].every((group) => typeof group === "string")).toBe(true);
    expect(new Set(lanes.values()).size).toBe(1);
  });
  it("keeps disjoint and perpendicular lanes separate, including touching intervals", () => {
    const { lanes } = chipEdges(
      new Map([
        [
          "a",
          {
            points: [
              { x: 0, y: 0 },
              { x: 100, y: 0 },
            ],
          },
        ],
        [
          "b",
          {
            points: [
              { x: 100, y: 0 },
              { x: 200, y: 0 },
            ],
          },
        ],
        [
          "c",
          {
            points: [
              { x: 0, y: 20 },
              { x: 100, y: 20 },
            ],
          },
        ],
        [
          "d",
          {
            points: [
              { x: 50, y: -50 },
              { x: 50, y: 50 },
            ],
          },
        ],
      ]),
      0.4,
    );
    expect(new Set(lanes.values()).size).toBe(4);
  });
});
