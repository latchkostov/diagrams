import { memo, type CSSProperties } from "react";
import { EdgeLabelRenderer, useReactFlow, type EdgeProps } from "@xyflow/react";
import { useSettings } from "../../harness/settings";
import { InlineInput } from "../../components/InlineInput";
import { useDiagram } from "../DiagramContext";
import type { DiagramFlowEdge } from "../types";
import { pointAlong } from "../geometry/path";
import type { LabelPlacement } from "../geometry/labels";
import { useEdgeRoute } from "./useEdgeRoute";

/**
 * Message / request flow between two nodes. async = dashed, sync = solid.
 *
 * Geometry comes from the canvas-wide router (src/canvas/geometry/router.ts via useEdgeRoute):
 * obstacle-avoiding orthogonal routes, spread ports, nudged parallel tracks and collision-free
 * label spots. Exactly one `path.react-flow__edge-path` per edge: the live view places particles
 * along it with getPointAtLength, so it always matches what's drawn.
 */
function FlowEdgeImpl(props: EdgeProps<DiagramFlowEdge>) {
  const { id, data, selected } = props;
  const { edgeStyle, nodeVariant } = useSettings();
  const { direction, editing, setEditing, openEdgeMenu } = useDiagram();
  const { updateEdgeData } = useReactFlow();
  const route = useEdgeRoute(id, { style: edgeStyle, direction, captions: nodeVariant === "iconOnly" });
  const kind = data?.kind ?? "async";
  const isEditing = editing?.kind === "edge" && editing.id === id;
  if (!route) return null;
  const { path, label } = route;
  const mid = label ?? pointAlong(route.points, 0.5).point;

  return (
    <g className={`fe fe-${kind}${selected ? " is-selected" : ""}`} data-testid={`edge-${id}`}>
      <path d={path} className="fe-halo" />
      <path
        d={path}
        className="fe-path react-flow__edge-path"
        markerEnd={`url(#${selected ? "df-arrow-selected" : kind === "sync" ? "df-arrow-sync" : "df-arrow"})`}
      />
      <path d={path} className="react-flow__edge-interaction" fill="none" strokeOpacity={0} strokeWidth={22} />
      {(label || isEditing) && (
        <EdgeLabelRenderer>
          <div
            className={`fe-label fe-label-${kind} is-${isEditing ? "editing" : label!.mode}${selected ? " is-selected" : ""} nodrag nopan`}
            style={labelStyle(mid.x, mid.y, isEditing ? null : label)}
            data-testid={`edge-label-${id}`}
            title={label && label.mode !== "full" && label.mode !== "wrap" ? label.text : undefined}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditing({ kind: "edge", id });
            }}
            onContextMenu={(e) => openEdgeMenu(e, id)}
          >
            {isEditing ? (
              <InlineInput
                value={data?.label ?? ""}
                placeholder="Edge label"
                testId="edge-label-input"
                onDone={(next) => {
                  setEditing(null);
                  if (next !== null) updateEdgeData(id, { label: next.trim() || undefined });
                }}
              />
            ) : label!.mode === "dot" ? (
              <>
                <span className="fe-dot-num" aria-hidden>
                  {label!.dot}
                </span>
                <span className="fe-dot-tip">{label!.text}</span>
              </>
            ) : (
              label!.lines.join("\n")
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </g>
  );
}

/** Placement is computed in flow px with the pill's exact metrics, so the box is set explicitly. */
function labelStyle(x: number, y: number, label: LabelPlacement | null): CSSProperties {
  const base: CSSProperties = { transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` };
  if (!label) return base;
  return { ...base, "--fe-w": `${label.width}px`, "--fe-h": `${label.height}px` } as CSSProperties;
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
