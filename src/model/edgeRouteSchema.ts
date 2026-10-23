import { ROUTE_LIMITS } from "./edgeRoute";

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
