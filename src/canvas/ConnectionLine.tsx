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

/** The dashed line while connecting, in the diagram's edge style; over empty canvas it ends in a "+". */
export function ConnectionLine({
  connectionLineType,
  fromX,
  fromY,
  toX,
  toY,
  fromPosition,
  toPosition,
  connectionStatus,
}: ConnectionLineComponentProps<FlowNode>) {
  const interaction = useInteraction();
  const snapshot = useSyncExternalStore(
    interaction?.subscribe ?? noSubscribe,
    interaction?.getSnapshot ?? emptySnapshot,
  );
  const preview = snapshot?.gesture?.preview;
  const target = preview?.kind === "connect" ? preview.target : null;
  const args = {
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: toX,
    targetY: toY,
    targetPosition: toPosition,
  };
  const [d] =
    connectionLineType === ConnectionLineType.Bezier
      ? getBezierPath(args)
      : connectionLineType === ConnectionLineType.Straight
        ? getStraightPath(args)
        : getSmoothStepPath(args);
  const adds = target === "canvas" && connectionStatus !== "valid";
  return (
    <g data-testid="connection-line" data-over={target ?? undefined}>
      <path d={d} fill="none" className="react-flow__connection-path" />
      {adds && (
        <g className="connect-add" transform={`translate(${toX} ${toY})`} data-testid="connection-add">
          <circle r={9} />
          <path d="M -4 0 H 4 M 0 -4 V 4" />
        </g>
      )}
    </g>
  );
}

const noSubscribe = () => () => {};
const emptySnapshot = () => null;
