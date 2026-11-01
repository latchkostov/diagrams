import { expect, it } from "vitest";
import { placeNodeTip } from "./nodeTipPlacement";

const area = { x: 0, y: 0, width: 1440, height: 900 };
const size = { width: 320, height: 200 };
const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

it("does not clamp a tall editing card over its own node near either viewport edge", () => {
  for (const y of [4, 400, 840]) {
    const node = { x: 400, y, width: 200, height: 60 };
    const tip = placeNodeTip(node, size, area);
    expect(tip).not.toBeNull();
    expect(overlap(tip!, node)).toBe(false);
    expect(tip!.y).toBeGreaterThanOrEqual(8);
    expect(tip!.y + tip!.height).toBeLessThanOrEqual(892);
  }
});

it("moves away from the coach as well as the node", () => {
  const node = { x: 500, y: 500, width: 220, height: 80 };
  const coach = { x: 450, y: 280, width: 360, height: 210 };
  const tip = placeNodeTip(node, size, area, [coach]);
  expect(tip).not.toBeNull();
  expect(overlap(tip!, node)).toBe(false);
  expect(overlap(tip!, coach)).toBe(false);
});

it("suppresses a card rather than covering its subject when no space remains", () => {
  expect(
    placeNodeTip({ x: 0, y: 0, width: 390, height: 350 }, size, { x: 0, y: 0, width: 390, height: 350 }),
  ).toBeNull();
});
