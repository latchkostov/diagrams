import type { Point } from "./types";

/** Shared authoring/import budgets for saved line geometry. */
export const ROUTE_LIMITS = { maxPoints: 64, maxCoordinate: 1_000_000 } as const;
export function validWaypoints(value: unknown): value is Point[] {
  return (
    Array.isArray(value) &&
    value.length <= ROUTE_LIMITS.maxPoints &&
    value.findIndex((p: unknown) => {
      if (!p || typeof p !== "object" || Array.isArray(p)) return true;
      const point = p as Record<string, unknown>;
      return [point.x, point.y].some((v) => !Number.isFinite(v) || Math.abs(v as number) > ROUTE_LIMITS.maxCoordinate);
    }) < 0
  );
}
