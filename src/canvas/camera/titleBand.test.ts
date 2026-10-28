import { expect, it } from "vitest";
import { titleBand } from "./frameEdges";
import { intersects } from "../geometry/rect";

it("reserves bands outside nested boundaries, clear of cards, edges and other titles", () => {
  const obstacles = [
    { x: 0, y: 20, width: 220, height: 72 },
    { x: 110, y: -24, width: 4, height: 100 },
    { x: -50, y: -50, width: 400, height: 4 },
  ];
  for (const region of [
    { x: 0, y: 0, width: 300, height: 200 },
    { x: 20, y: 12, width: 240, height: 160 },
  ]) {
    const title = titleBand(region, { width: 160, height: 18 }, obstacles);
    expect(title.y + title.height).toBeLessThanOrEqual(region.y - 4);
    expect(title.x + title.width).toBeGreaterThanOrEqual(region.x);
    expect(title.x).toBeLessThanOrEqual(region.x + region.width);
    expect(obstacles.some((r) => intersects(title, r))).toBe(false);
    obstacles.push(title);
  }
});
