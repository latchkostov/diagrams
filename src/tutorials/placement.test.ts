import { expect, it } from "vitest";
import { clearPanes, intersect, intersects } from "./placement";

it("clips intersection dimensions to zero when boxes are apart", () => {
  expect(intersect({ x: 0, y: 0, width: 20, height: 20 }, { x: 50, y: 60, width: 10, height: 10 })).toEqual({
    x: 50,
    y: 60,
    width: 0,
    height: 0,
  });
});
it("clears rail, dock, transport and narration at visual viewport offsets", () => {
  const area = { x: 40, y: 130, width: 350, height: 500 };
  const obstacles = [
    { x: 40, y: 500, width: 350, height: 130 },
    { x: 40, y: 130, width: 40, height: 370 },
    { x: 150, y: 430, width: 180, height: 60 },
    { x: 100, y: 130, width: 200, height: 90 },
  ];
  const panes = clearPanes(area, obstacles);
  expect(panes.length).toBeGreaterThan(0);
  for (const pane of panes) for (const obstacle of obstacles) expect(intersects(pane, obstacle)).toBe(false);
});
