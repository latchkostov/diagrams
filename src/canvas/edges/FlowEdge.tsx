import { memo } from "react";
import {
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  type EdgeProps,
  type Position,
} from "@xyflow/react";
import { useSettings } from "../../harness/settings";
import type { EdgeStyle } from "../../harness/edgeStyles";
import type { DiagramFlowEdge } from "../types";

export interface EdgeGeometry {
  sourceX: number;
  sourceY: number;
  sourcePosition: Position;
  targetX: number;
  targetY: number;
  targetPosition: Position;
}

/**
 * Single source of truth for edge geometry. The future live view should call this too
 * (or read the rendered `path.fe-path` via getPointAtLength) to move particles along edges.
 */
export function edgePath(style: EdgeStyle, g: EdgeGeometry): [path: string, labelX: number, labelY: number] {
  if (style === "straight") {
    const [p, x, y] = getStraightPath(g);
    return [p, x, y];
  }
  if (style === "bezier") {
    const [p, x, y] = getBezierPath(g);
    return [p, x, y];
  }
  const [p, x, y] = getSmoothStepPath({ ...g, borderRadius: 14, offset: 24 });
  return [p, x, y];
}

/** Message / request flow between two nodes. async = dashed, sync = solid. */
function FlowEdgeImpl(props: EdgeProps<DiagramFlowEdge>) {
  const { id, data, selected } = props;
  const { edgeStyle } = useSettings();
  const kind = data?.kind ?? "async";
  const [path, labelX, labelY] = edgePath(edgeStyle, props);

  return (
    <g className={`fe fe-${kind}${selected ? " is-selected" : ""}`} data-testid={`edge-${id}`}>
      <path d={path} className="fe-halo" />
      <path
        d={path}
        className="fe-path"
        markerEnd={`url(#${selected ? "df-arrow-selected" : kind === "sync" ? "df-arrow-sync" : "df-arrow"})`}
      />
      <path d={path} className="react-flow__edge-interaction" fill="none" strokeOpacity={0} strokeWidth={22} />
      {data?.label && (
        <EdgeLabelRenderer>
          <div
            className={`fe-label fe-label-${kind}${selected ? " is-selected" : ""} nodrag nopan`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            data-testid={`edge-label-${id}`}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </g>
  );
}

export const FlowEdge = memo(FlowEdgeImpl);

/** Arrowhead markers referenced by FlowEdge. Render once per canvas. */
export function EdgeMarkers() {
  const arrow = "M1.5 1.5 L10.5 6 L1.5 10.5 L4 6 Z";
  return (
    <svg className="df-defs" aria-hidden width="0" height="0">
      <defs>
        {[
          ["df-arrow", "m-async"],
          ["df-arrow-sync", "m-sync"],
          ["df-arrow-selected", "m-selected"],
        ].map(([markerId, cls]) => (
          <marker
            key={markerId}
            id={markerId}
            viewBox="0 0 12 12"
            refX="10"
            refY="6"
            markerWidth="12"
            markerHeight="12"
            markerUnits="userSpaceOnUse"
            orient="auto-start-reverse"
          >
            <path d={arrow} className={cls} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}
