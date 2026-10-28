import { expect, it } from "vitest";
import { pinAnchor } from "./frameEdges";

it("keeps a below-frame neighbour below its subject even when its route detours above", () => {
  const frame = { x: 28, y: 28, width: 1200, height: 600 };
  expect(pinAnchor({ x: 1228, y: 40 }, "right", { x: 3000, y: 1500 }, frame)).toEqual({
    side: "bottom",
    point: { x: 1228, y: 628 },
  });
  expect(pinAnchor({ x: 28, y: 600 }, "left", { x: -3000, y: -1500 }, frame)).toEqual({
    side: "top",
    point: { x: 28, y: 28 },
  });
});

it("keeps horizontal pin rows aligned with the endpoint, clamped to the frame", () => {
  const frame = { x: 28, y: 28, width: 1200, height: 600 };
  expect(pinAnchor({ x: 800, y: 628 }, "bottom", { x: 400, y: 1500 }, frame)).toEqual({
    side: "bottom",
    point: { x: 400, y: 628 },
  });
  expect(pinAnchor({ x: 800, y: 28 }, "top", { x: 3000, y: -1500 }, frame)).toEqual({
    side: "top",
    point: { x: 1228, y: 28 },
  });
});
