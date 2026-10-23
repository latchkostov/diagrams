import { describe, expect, it } from "vitest";
import { orthogonalize, shapedRoute } from "./shaped";
import { routedPort } from "./ports";
import { sideNormal, type Point } from "./rect";
import type { Side } from "../../model/types";

const s = { x: 0, y: 0, width: 220, height: 72 };
const t = { x: 600, y: 300, width: 220, height: 72 };
const sides: Side[] = ["top", "right", "bottom", "left"];
const orthogonal = (p: Point[]) => {
  for (let i = 1; i < p.length; i++) expect(p[i].x === p[i - 1].x || p[i].y === p[i - 1].y).toBe(true);
};
describe("hand-shaped routes", () => {
  it("orthogonalizes alternating diagonals and drops duplicate input without mutating it", () => {
    const w = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 40, y: 50 },
      { x: 80, y: 90 },
    ];
    expect(orthogonalize(w)).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 50 },
      { x: 80, y: 50 },
      { x: 80, y: 90 },
    ]);
    expect(w).toHaveLength(4);
    expect(
      orthogonalize([
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 80, y: 50 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 50 },
      { x: 80, y: 50 },
    ]);
  });
  for (const sourceSide of sides)
    for (const targetSide of sides) {
      it(`joins ${sourceSide} to ${targetSide}, including bends behind ports and single corners`, () => {
        for (const w of [
          [{ x: -100, y: -100 }],
          [
            { x: 350, y: 80 },
            { x: 350, y: 200 },
          ],
          [
            { x: 1000, y: 600 },
            { x: -100, y: 600 },
          ],
        ]) {
          const before = structuredClone(w);
          const sp = routedPort(s, sourceSide),
            tp = routedPort(t, targetSide);
          const p = shapedRoute(sp, sourceSide, tp, targetSide, w, s, t);
          orthogonal(p);
          expect(p[0]).toEqual(sp.attachment);
          expect(p.at(-1)).toEqual(tp.attachment);
          const n = sideNormal[sourceSide],
            m = sideNormal[targetSide];
          expect((p[1].x - p[0].x) * n.x + (p[1].y - p[0].y) * n.y).toBeGreaterThanOrEqual(16);
          const a = p.at(-2)!,
            b = p.at(-1)!;
          expect((a.x - b.x) * m.x + (a.y - b.y) * m.y).toBeGreaterThanOrEqual(16);
          expect(w).toEqual(before);
        }
      });
    }
  it("slides the first and last bends onto their port lines without tiny doglegs", () => {
    const w = [
      { x: 350, y: 20 },
      { x: 350, y: 350 },
    ];
    const p = shapedRoute(routedPort(s, "right"), "right", routedPort(t, "left"), "left", w, s, t);
    expect(p).toEqual([
      { x: 220, y: 36 },
      { x: 350, y: 36 },
      { x: 350, y: 336 },
      { x: 600, y: 336 },
    ]);
  });
  it("takes the nearer box edge for a detour behind a pinned port", () => {
    const p = shapedRoute(routedPort(s, "right"), "right", routedPort(t, "left"), "left", [{ x: -80, y: 120 }], s, t);
    expect(p).toContainEqual({ x: 236, y: 88 });
    expect(p).toContainEqual({ x: -80, y: 88 });
  });
});
