import { memo, useMemo } from "react";
import { useStore, type InternalNode } from "@xyflow/react";
import { routeInputFromStore, useAllRoutes, useRoutingOptions } from "../canvas/edges/useEdgeRoute";
import type { FlowNode } from "../canvas/types";
import { pointAlong } from "../canvas/geometry/path";
import { inflate, intersects, type Rect } from "../canvas/geometry/rect";
import { t, useLocale } from "../i18n";
export { ThreadMeter } from "./ThreadMeter";

export interface ActiveCall {
  id: string;
  held: number;
  inFlight: number;
}

/** One shared placement pass: inactive connections never mount routing consumers. */
export const CallPills = memo(
  function CallPills({ calls }: { calls: ActiveCall[] }) {
    useLocale();
    const options = useRoutingOptions();
    const routes = useAllRoutes(options);
    const nodes = useStore((s) => s.nodeLookup as Map<string, InternalNode<FlowNode>>);
    const { style, direction, captions, hideDependencies } = options;
    const obstacles = useMemo(() => {
      const input = routeInputFromStore(nodes.values(), [], { style, direction, captions, hideDependencies });
      return [
        ...input.nodes.flatMap((n) => [n.rect, ...(n.extra ? [n.extra] : [])]),
        ...(input.groups ?? []).map((g) => g.header),
        ...[...routes.values()].flatMap((r) =>
          r.label
            ? [
                {
                  x: r.label.x - r.label.width / 2,
                  y: r.label.y - r.label.height / 2,
                  width: r.label.width,
                  height: r.label.height,
                },
              ]
            : [],
        ),
      ];
    }, [nodes, routes, style, direction, captions, hideDependencies]);
    const occupied = [...obstacles];
    return calls.map(({ id, held, inFlight }) => {
      const route = routes.get(id);
      if (!route) return null;
      const text = held ? t("threads.pillHeld", { count: held }) : t("threads.pillFlight", { count: inFlight });
      // Conservative text bounds cover every digit and the glyph without per-frame DOM measurement.
      const width = text.length * 7 + 16,
        height = 20;
      let box: Rect | undefined;
      for (const distance of [16, 40, 64]) {
        for (const fraction of [0.4, 0.6, 0.2, 0.8, 0.5]) {
          const { point, segment } = pointAlong(route.points, fraction);
          const a = route.points[segment],
            b = route.points[segment + 1] ?? a;
          const tangent = { x: b.x - a.x, y: b.y - a.y };
          const length = Math.hypot(tangent.x, tangent.y) || 1;
          for (const side of [1, -1]) {
            const candidate = {
              x: point.x - ((side * tangent.y) / length) * distance - width / 2,
              y: point.y + ((side * tangent.x) / length) * distance - height / 2,
              width,
              height,
            };
            if (!occupied.some((r) => intersects(inflate(r, 4), candidate))) {
              box = candidate;
              break;
            }
          }
          if (box) break;
        }
        if (box) break;
      }
      // Dense drawings wait for room instead of covering their labels.
      if (!box) return null;
      occupied.push(box);
      return (
        <span key={id} className="lv-call-pill" style={{ left: box.x, top: box.y }} data-testid={`call-pill-${id}`}>
          {text}
        </span>
      );
    });
  },
  (a, b) =>
    a.calls.length === b.calls.length &&
    a.calls.every((c, i) => c.id === b.calls[i].id && c.held === b.calls[i].held && c.inFlight === b.calls[i].inFlight),
);
