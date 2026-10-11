import { memo } from "react";
import {
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  useInternalNode,
  useReactFlow,
  useStore,
  type EdgeProps,
  type InternalNode,
  type Position,
} from "@xyflow/react";
import { useSettings } from "../../harness/settings";
import type { EdgeStyle } from "../../harness/edgeStyles";
import type { Side } from "../../model/types";
import { InlineInput } from "../../components/InlineInput";
import { useDiagram } from "../DiagramContext";
import type { DiagramFlowEdge, FlowNode } from "../types";
import { laneOffset, pickSides, sideCenter, sidePosition, type Rect, type XY } from "./routing";

export interface EdgeGeometry {
  sourceX: number;
  sourceY: number;
  sourcePosition: Position;
  targetX: number;
  targetY: number;
  targetPosition: Position;
}

/**
 * Single source of truth for edge geometry. The live view places particles along the rendered
 * `path.react-flow__edge-path` (one per edge) via getPointAtLength, so it always matches this.
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

function nodeRect(n: InternalNode<FlowNode>): Rect {
  return {
    x: n.internals.positionAbsolute.x,
    y: n.internals.positionAbsolute.y,
    width: n.measured.width ?? n.width ?? 0,
    height: n.measured.height ?? n.height ?? 0,
  };
}

/** Where an edge meets a side: the outer edge of that side's handle (matches React Flow), else the side centre. */
function anchor(n: InternalNode<FlowNode>, side: Side): XY {
  const h = n.internals.handleBounds?.source?.find((b) => b.id === side);
  if (!h) return sideCenter(nodeRect(n), side);
  const x = n.internals.positionAbsolute.x + h.x;
  const y = n.internals.positionAbsolute.y + h.y;
  switch (side) {
    case "top":
      return { x: x + h.width / 2, y };
    case "bottom":
      return { x: x + h.width / 2, y: y + h.height };
    case "left":
      return { x, y: y + h.height / 2 };
    case "right":
      return { x: x + h.width, y: y + h.height / 2 };
  }
}

/** Geometry for an edge between two measured nodes, picking unpinned sides automatically. */
export function floatingGeometry(
  source: InternalNode<FlowNode>,
  target: InternalNode<FlowNode>,
  opts: { direction: "LR" | "TB"; sourceSide?: Side; targetSide?: Side; twin?: boolean },
): EdgeGeometry & { sourceSide: Side; targetSide: Side } {
  const sides = pickSides(nodeRect(source), nodeRect(target), opts);
  const s = anchor(source, sides.sourceSide);
  const t = anchor(target, sides.targetSide);
  const o = opts.twin ? laneOffset(sides.sourceSide, sides.targetSide) : { x: 0, y: 0 };
  return {
    ...sides,
    sourceX: s.x + o.x,
    sourceY: s.y + o.y,
    sourcePosition: sidePosition[sides.sourceSide],
    targetX: t.x + o.x,
    targetY: t.y + o.y,
    targetPosition: sidePosition[sides.targetSide],
  };
}

/** Message / request flow between two nodes. async = dashed, sync = solid. */
function FlowEdgeImpl(props: EdgeProps<DiagramFlowEdge>) {
  const { id, source, target, data, selected } = props;
  const { edgeStyle } = useSettings();
  const { direction, editing, setEditing, openEdgeMenu } = useDiagram();
  const { updateEdgeData } = useReactFlow();
  const sourceNode = useInternalNode<FlowNode>(source);
  const targetNode = useInternalNode<FlowNode>(target);
  // A reverse edge between the same pair gets its own lane instead of overlapping this one.
  const twin = useStore((s) => s.edges.some((e) => e.source === target && e.target === source && e.id !== id));
  const kind = data?.kind ?? "async";
  const geometry =
    sourceNode && targetNode
      ? floatingGeometry(sourceNode, targetNode, { direction, sourceSide: data?.sourceSide, targetSide: data?.targetSide, twin })
      : props;
  const [path, labelX, labelY] = edgePath(edgeStyle, geometry);
  const isEditing = editing?.kind === "edge" && editing.id === id;

  return (
    <g className={`fe fe-${kind}${selected ? " is-selected" : ""}`} data-testid={`edge-${id}`}>
      <path d={path} className="fe-halo" />
      <path
        d={path}
        className="fe-path react-flow__edge-path"
        markerEnd={`url(#${selected ? "df-arrow-selected" : kind === "sync" ? "df-arrow-sync" : "df-arrow"})`}
      />
      <path d={path} className="react-flow__edge-interaction" fill="none" strokeOpacity={0} strokeWidth={22} />
      {(data?.label || isEditing) && (
        <EdgeLabelRenderer>
          <div
            className={`fe-label fe-label-${kind}${selected ? " is-selected" : ""}${isEditing ? " is-editing" : ""} nodrag nopan`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            data-testid={`edge-label-${id}`}
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
            ) : (
              data?.label
            )}
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
