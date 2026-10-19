import { useEdgeRoute, useRoutingOptions } from "../canvas/edges/useEdgeRoute";
import { pointAlong } from "../canvas/geometry/path";
import { t } from "../i18n";
import type { EdgeSimState } from "../sim/types";
export { ThreadMeter } from "./ThreadMeter";

export function CallPill({ id, calls }: { id: string; calls: NonNullable<EdgeSimState["calls"]> }) {
  const route = useEdgeRoute(id, useRoutingOptions());
  if (!route || (!calls.held && !calls.inFlight)) return null;
  const point = pointAlong(route.points, 0.4).point;
  return (
    <span className="lv-call-pill" style={{ left: point.x, top: point.y }} data-testid={`call-pill-${id}`}>
      {calls.held ? t("threads.pillHeld", { count: calls.held }) : t("threads.pillFlight", { count: calls.inFlight })}
    </span>
  );
}
