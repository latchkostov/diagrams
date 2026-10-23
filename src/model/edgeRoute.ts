import type { Point } from "./types";

/** Shared authoring/import budgets for saved line geometry. */
export const ROUTE_LIMITS = { maxPoints: 64, maxCoordinate: 1_000_000 } as const;
const coordinate = { type: "number", minimum: -ROUTE_LIMITS.maxCoordinate, maximum: ROUTE_LIMITS.maxCoordinate };
export const waypointsSchema = {
  type: "array",
  maxItems: ROUTE_LIMITS.maxPoints,
  description:
    "A line shaped by hand: its inner corners, source to target, in canvas pixels (read as an orthogonal route). Omitted = routed automatically.",
  items: {
    type: "object",
    required: ["x", "y"],
    additionalProperties: false,
    properties: { x: coordinate, y: coordinate },
  },
};
export function validWaypoints(value: unknown): value is Point[] {
  return (
    Array.isArray(value) &&
    value.length <= ROUTE_LIMITS.maxPoints &&
    value.every((p: unknown) => {
      if (!p || typeof p !== "object" || Array.isArray(p)) return false;
      const point = p as Record<string, unknown>;
      return [point.x, point.y].every(
        (v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= ROUTE_LIMITS.maxCoordinate,
      );
    })
  );
}
