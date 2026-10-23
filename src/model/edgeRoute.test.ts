import { expect, it } from "vitest";
import { validWaypoints } from "./edgeRoute";

it("rejects sparse waypoint arrays before routing", () => {
  expect(validWaypoints(new Array<unknown>(2))).toBe(false);
  const points = [
    { x: 0, y: 0 },
    { x: 20, y: 20 },
  ];
  delete points[1];
  expect(validWaypoints(points)).toBe(false);
});
