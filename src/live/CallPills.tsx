import { memo, useMemo } from "react";
import { useStore, type InternalNode } from "@xyflow/react";
import { routeInputFromStore, useAllRoutes, useRoutingOptions } from "../canvas/edges/useEdgeRoute";
import type { FlowNode } from "../canvas/types";
import { callPillObstacles, placeCallPills, type PillSize } from "./callPillPlacement";
import { t, useLocale } from "../i18n";
export { ThreadMeter } from "./ThreadMeter";

export interface ActiveCall {
  id: string;
  held: number;
  inFlight: number;
}

/** One shared placement pass: inactive connections never mount routing consumers. */
export const CallPills = memo(
  function CallPills({
    calls,
    readoutScale = 1,
    presenting = false,
  }: {
    calls: ActiveCall[];
    readoutScale?: number;
    presenting?: boolean;
  }) {
    useLocale();
    const options = useRoutingOptions();
    const routes = useAllRoutes(options);
    const nodes = useStore((s) => s.nodeLookup as Map<string, InternalNode<FlowNode>>);
    const [tx, ty, zoom] = useStore((s) => s.transform);
    const viewWidth = useStore((s) => s.width);
    const viewHeight = useStore((s) => s.height);
    const { style, direction, captions, hideDependencies } = options;
    const obstacles = useMemo(() => {
      const input = routeInputFromStore(nodes.values(), [], { style, direction, captions, hideDependencies });
      return callPillObstacles([
        ...input.nodes.flatMap((n) => [
          n.rect,
          ...(n.extra ? [n.extra] : []),
          // Reserve the live busy-thread / in-flight strips, including their counter-scaling.
          {
            x: n.rect.x,
            y: n.rect.y + n.rect.height + 7,
            width: Math.max(320, n.rect.width) * readoutScale,
            height: (presenting ? 26 : 21) * readoutScale,
          },
        ]),
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
      ]);
    }, [nodes, routes, style, direction, captions, hideDependencies, readoutScale, presenting]);
    const labels = calls.map(({ id, held, inFlight }) => ({
      id,
      text: held ? t("threads.pillHeld", { count: held }) : t("threads.pillFlight", { count: inFlight }),
    }));
    // Count changes of the same text dimensions reuse the entire placement pass.
    const dimensions = JSON.stringify(labels.map(({ id, text }) => ({ id, width: text.length * 7 + 16, height: 20 })));
    const placements = useMemo(
      () =>
        placeCallPills(JSON.parse(dimensions) as PillSize[], routes, obstacles, {
          x: -tx / zoom,
          y: -ty / zoom,
          width: viewWidth / zoom,
          height: viewHeight / zoom,
        }),
      [dimensions, routes, obstacles, tx, ty, zoom, viewWidth, viewHeight],
    );
    return labels.map(({ id, text }) => {
      const box = placements.get(id);
      if (!box) return null;
      return (
        <span key={id} className="lv-call-pill" style={{ left: box.x, top: box.y }} data-testid={`call-pill-${id}`}>
          {text}
        </span>
      );
    });
  },
  (a, b) =>
    a.readoutScale === b.readoutScale &&
    a.presenting === b.presenting &&
    a.calls.length === b.calls.length &&
    a.calls.every((c, i) => c.id === b.calls[i].id && c.held === b.calls[i].held && c.inFlight === b.calls[i].inFlight),
);
