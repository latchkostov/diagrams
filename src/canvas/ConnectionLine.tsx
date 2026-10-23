import { useSyncExternalStore } from "react";
import {
  ConnectionLineType,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  type ConnectionLineComponentProps,
} from "@xyflow/react";
import { useInteraction } from "./interaction/useInteraction";
import type { FlowNode } from "./types";
import { sidePosition } from "./edges/routing";

/** The dashed line while connecting, in the diagram's edge style; over empty canvas it ends in a "+". */
export function ConnectionLine({
  connectionLineType,
  fromX,
  fromY,
  toX,
  toY,
  fromPosition,
  toPosition,
}: ConnectionLineComponentProps<FlowNode>) {
  const interaction = useInteraction();
  const preview = useSyncExternalStore(
    interaction?.subscribe ?? noSubscribe,
    interaction?.getConnectPreview ?? emptySnapshot,
  );
  const target = preview?.kind === "connect" ? preview.target : null;
  const args = {
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: preview?.at?.x ?? toX,
    targetY: preview?.at?.y ?? toY,
    targetPosition: preview?.over?.side ? sidePosition[preview.over.side] : toPosition,
  };
  const [d] =
    connectionLineType === ConnectionLineType.Bezier
      ? getBezierPath(args)
      : connectionLineType === ConnectionLineType.Straight
        ? getStraightPath(args)
        : getSmoothStepPath(args);
  const adds = target === "canvas";
  return (
    <g data-testid="connection-line" data-over={target ?? undefined}>
      <path d={d} fill="none" className="react-flow__connection-path" />
      {adds && (
        <g
          className="connect-add"
          transform={`translate(${args.targetX} ${args.targetY})`}
          data-testid="connection-add"
        >
          <circle r={9} />
          <path d="M -4 0 H 4 M 0 -4 V 4" />
        </g>
      )}
    </g>
  );
}

const noSubscribe = () => () => {};
const emptySnapshot = () => null;
