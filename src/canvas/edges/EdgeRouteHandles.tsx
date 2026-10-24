import { useLayoutEffect, useSyncExternalStore, type PointerEvent } from "react";
import { useReactFlow, useStore, useStoreApi, ViewportPortal } from "@xyflow/react";
import { useDiagram } from "../DiagramContext";
import { useInteraction } from "../interaction/useInteraction";
import { usePointerGesture } from "../interaction/usePointerGesture";
import { roundedPath } from "../geometry/path";
import type { EdgeRoute } from "../geometry/router";
import type { DiagramFlowEdge, FlowNode } from "../types";
import { t, useLocale } from "../../i18n";
import { EdgeEnds } from "./EdgeEnds";
import { useRoutingOptions } from "./useEdgeRoute";
import { hasSingleEdgeSelection } from "./singleEdgeSelection";
import { useSegmentKeyboard } from "./useSegmentKeyboard";
import { dragSegment, freezeRoute, normalizeWaypoints, portStub, routeSegments, snapSegment } from "./segments";
import "./routeHandles.css";

let reshapeSequence = 0;

export function EdgeRouteHandles({
  id,
  source,
  target,
  route,
}: {
  id: string;
  source: string;
  target: string;
  route: EdgeRoute;
}) {
  useLocale();
  const { reshape } = useDiagram();
  const interaction = useInteraction();
  const pointerGesture = usePointerGesture();
  const { style } = useRoutingOptions();
  const flow = useReactFlow<FlowNode, DiagramFlowEdge>();
  const store = useStoreApi<FlowNode, DiagramFlowEdge>();
  const zoom = useStore((s) => s.transform[2]);
  const alone = useStore(hasSingleEdgeSelection);
  const points = route.points;
  // Display samples (including collinear Bezier samples) are never editable route vertices.
  const segments = route.custom || style === "smoothstep" ? routeSegments(points) : [];
  const stubs = (): [number, number] => {
    const rectOf = (nodeId: string) => {
      const node = store.getState().nodeLookup.get(nodeId);
      return (
        node && {
          ...node.internals.positionAbsolute,
          width: node.measured.width ?? node.width ?? 0,
          height: node.measured.height ?? node.height ?? 0,
        }
      );
    };
    return [
      portStub(points[0], route.sourceSide, rectOf(source)),
      portStub(points[points.length - 1], route.targetSide, rectOf(target)),
    ];
  };
  const keyboardSegment = useSegmentKeyboard(id, route, segments, alone, stubs, () => store.getState().snapToGrid);
  const panHeld = useSyncExternalStore(interaction?.subscribe ?? noSubscribe, () => interaction?.panHeld ?? false);
  const active = useSyncExternalStore(interaction?.subscribe ?? noSubscribe, () => {
    const p = interaction?.gesture?.preview;
    return p?.kind === "edge.segment" && p.edge === id ? p : null;
  });
  const drag = active?.kind === "edge.segment" ? active : null;
  const reshaping = !!drag;
  useLayoutEffect(() => {
    const edge = document.querySelector(`[data-testid="edge-${CSS.escape(id)}"]`);
    edge?.classList.toggle("is-reshaping", reshaping);
    return () => edge?.classList.remove("is-reshaping");
  }, [id, reshaping]);
  if (!reshape) return null;
  if (!alone)
    return (
      <EdgeEnds
        id={id}
        source={source}
        target={target}
        start={route.points[0]}
        end={route.points[route.points.length - 1]}
      />
    );
  const begin = (k: number) => (event: PointerEvent) => {
    if (interaction?.panHeld) return;
    const segment = segments.find((s) => s.k === k);
    if (!segment) return;
    // Freeze the displayed route once. No routing or document mutation happens during the gesture.
    const frozen = [points[0], ...freezeRoute(points), points[points.length - 1]];
    const portStubs = stubs();
    const origin = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }, { snapToGrid: false });
    const cross = segment.axis === "h" ? "y" : "x";
    const along = segment.axis === "h" ? "x" : "y";
    const nodes = [...store.getState().nodeLookup.values()].filter((n) => {
      if (n.type === "boundary") return false;
      const start = n.internals.positionAbsolute[along];
      const size = (along === "x" ? n.measured.width : n.measured.height) ?? 0;
      const pad = 80 / zoom;
      return (
        start <= Math.max(segment.a[along], segment.b[along]) + pad &&
        start + size >= Math.min(segment.a[along], segment.b[along]) - pad
      );
    });
    const candidates = {
      ports: [points[0][cross], points[points.length - 1][cross]],
      segments: segments.filter((s) => s.k !== k && s.axis === segment.axis).map((s) => s.a[cross]),
      nodes: nodes.flatMap((n) => {
        const start = n.internals.positionAbsolute[cross];
        const size = (cross === "x" ? n.measured.width : n.measured.height) ?? 0;
        return [start, start + size / 2, start + size];
      }),
      from: Math.min(...points.map((p) => p[along])) - 40,
      to: Math.max(...points.map((p) => p[along])) + 40,
    };
    pointerGesture(event, {
      kind: "edge.segment",
      activationDistance: 3,
      preview(at, _screen, modifiers) {
        const value = segment.a[cross] + at[cross] - origin[cross];
        const snapped =
          store.getState().snapToGrid && !modifiers.ctrlKey && !modifiers.metaKey
            ? snapSegment(value, segment.axis, candidates, 6 / store.getState().transform[2])
            : { value };
        return {
          kind: "edge.segment",
          edge: id,
          segment: k,
          waypoints: dragSegment(frozen, k, snapped.value, portStubs),
          guide: snapped.guide,
        };
      },
      commit(preview) {
        if (preview.kind !== "edge.segment") return;
        const normalized = normalizeWaypoints(preview.waypoints);
        const original = normalizeWaypoints(frozen);
        if (
          normalized.length === original.length &&
          normalized.every((p, i) => p.x === original[i].x && p.y === original[i].y)
        )
          return;
        const waypoints = normalized.slice(1, -1);
        if (waypoints.length > 64) return;
        // A click without motion never freezes an automatic route.
        reshape(id, { waypoints: waypoints.length ? waypoints : undefined }, { merge: `reshape:${++reshapeSequence}` });
      },
    });
  };
  return (
    <>
      <EdgeEnds id={id} source={source} target={target} start={points[0]} end={points[points.length - 1]} />
      <ViewportPortal>
        {segments.map((s) => {
          const current = s.k === keyboardSegment;
          let keyboardOnly = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) * zoom < 28;
          if (!current && keyboardOnly) return null;
          let x = (s.a.x + s.b.x) / 2,
            y = (s.a.y + s.b.y) / 2;
          const label = route.label;
          if (label) {
            const horizontal = s.axis === "h";
            const mid = horizontal ? x : y;
            const centre = horizontal ? label.x : label.y;
            const size = (horizontal ? label.width : label.height) / 2 + 14 / zoom;
            const across = horizontal
              ? Math.abs(y - label.y) < label.height / 2 + 12 / zoom
              : Math.abs(x - label.x) < label.width / 2 + 12 / zoom;
            if (across && Math.abs(mid - centre) < size) {
              const lo = Math.min(horizontal ? s.a.x : s.a.y, horizontal ? s.b.x : s.b.y);
              const hi = Math.max(horizontal ? s.a.x : s.a.y, horizontal ? s.b.x : s.b.y);
              const left = Math.max(0, centre - size - lo),
                right = Math.max(0, hi - centre - size);
              const cramped = Math.max(left, right) * zoom < 28;
              if (!current && cramped) return null;
              keyboardOnly ||= cramped;
              const at = left >= right ? lo + left / 2 : hi - right / 2;
              if (horizontal) x = at;
              else y = at;
            }
          }
          return (
            <div
              key={s.k}
              className={`edge-seg edge-seg-${s.axis} nodrag${panHeld ? "" : " nopan"}${current ? " is-active" : ""}`}
              style={{ transform: `translate(${x}px, ${y}px)` }}
              title={t("edge.shape.drag")}
              data-testid={`route-segment-${id}-${s.k}`}
              data-keyboard-only={keyboardOnly || undefined}
              aria-hidden={keyboardOnly || undefined}
              onPointerDown={begin(s.k)}
            />
          );
        })}
        {drag && (
          <svg className="edge-route-preview" data-testid="route-preview" aria-hidden>
            <path d={roundedPath(drag.waypoints, 10)} />
            {drag.guide && (
              <line
                data-testid="route-guide"
                x1={drag.guide.axis === "x" ? drag.guide.at : drag.guide.from}
                x2={drag.guide.axis === "x" ? drag.guide.at : drag.guide.to}
                y1={drag.guide.axis === "y" ? drag.guide.at : drag.guide.from}
                y2={drag.guide.axis === "y" ? drag.guide.at : drag.guide.to}
              />
            )}
          </svg>
        )}
      </ViewportPortal>
    </>
  );
}
const noSubscribe = () => () => {};
