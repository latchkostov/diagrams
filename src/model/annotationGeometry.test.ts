import { expect, it } from "vitest";
import { annotationGeometryReason, annotationGeometryError } from "./annotations";
import { annotationGeometryMessage } from "../editor/editMessages";

it.each([
  [{ x: Infinity, y: 0, width: 1, height: 1 }, "finite", "its geometry must be finite."],
  [
    { x: 1000001, y: 0, width: 1, height: 1 },
    "coordinate-budget",
    "it's outside the coordinate budget. Move the selection closer to the origin.",
  ],
  [
    { x: 0, y: 0, width: 20001, height: 1 },
    "size",
    "its size must be between 1 and 20000 pixels. Choose a smaller selection.",
  ],
] as const)("classifies %j with typed recovery guidance", (geometry, reason, diagnostic) => {
  expect(annotationGeometryReason(geometry)).toBe(reason);
  expect(annotationGeometryError(geometry)).toBe(diagnostic);
  expect(annotationGeometryMessage(reason)).toBe(diagnostic);
});
