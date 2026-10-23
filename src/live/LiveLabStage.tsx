import { projectDependencies, useShowDependencies } from "../canvas/dependencyVisibility";
import { useContext, useMemo, useState, type ContextType } from "react";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type EdgeTypes,
  type NodeTypes,
} from "@xyflow/react";
import type { DiagramFile } from "../model/types";
import { useSettings } from "../harness/settings";
import { toFlow } from "../canvas/convert";
import { DiagramContext, type InlineEdit } from "../canvas/DiagramContext";
import { DiagramNode } from "../canvas/nodes/DiagramNode";
import { GroupNode } from "../canvas/nodes/GroupNode";
import { EdgeMarkers, FlowEdge } from "../canvas/edges/FlowEdge";
import { EdgeMessages } from "../canvas/edges/lazyEdgeMessages";
import type { DiagramFlowEdge, FlowNode } from "../canvas/types";
import { CameraContext } from "../canvas/camera";
import { useStandaloneCamera } from "../canvas/camera/useStandaloneCamera";
import { LiveView, type LiveViewProps } from "./LiveView";

const nodeTypes: NodeTypes = { diagram: DiagramNode, boundary: GroupNode };
const edgeTypes: EdgeTypes = { flow: FlowEdge };

export interface LiveLabStageProps {
  diagram: DiagramFile;
  initial?: LiveViewProps["initial"];
  presenting?: boolean;
  /** Keyboard lifecycle preview: allow leaving live while its host rerenders. */
  alwaysOn?: boolean;
}

/** A Lab stage: the real canvas renderers with the live view always on (no editor, no saving). */
export function LiveLabStage(props: LiveLabStageProps) {
  return (
    <div className="lv-lab" data-testid="live-lab-stage">
      <ReactFlowProvider>
        <Stage {...props} />
      </ReactFlowProvider>
    </div>
  );
}

type Ui = ContextType<typeof DiagramContext>;

function Stage({ diagram, initial, presenting = false, alwaysOn = true }: LiveLabStageProps) {
  const { theme } = useSettings();
  const flow = useMemo(() => toFlow(diagram), [diagram]);
  const [nodes, , onNodesChange] = useNodesState<FlowNode>(flow.nodes);
  const [edges, , onEdgesChange] = useEdgesState<DiagramFlowEdge>(flow.edges);
  const showDependencies = useShowDependencies();
  const visibleEdges = useMemo(() => projectDependencies(edges, showDependencies), [edges, showDependencies]);
  const base = useContext(DiagramContext);
  // Live's camera moves go through a controller here too (no canvas camera in the Lab).
  const camera = useStandaloneCamera();
  const [editing, setEditing] = useState<InlineEdit | null>(null);
  const ui = useMemo(
    () => ({ ...base, theme, direction: flow.meta.direction ?? "LR", editing, setEditing }) as Ui,
    [base, theme, flow.meta.direction, editing],
  );

  return (
    <DiagramContext.Provider value={ui}>
      <div className={`lab-canvas${presenting ? " is-presenting" : ""}`}>
        <EdgeMarkers />
        <ReactFlow<FlowNode, DiagramFlowEdge>
          nodes={nodes}
          edges={visibleEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onMoveStart={camera.onMoveStart}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          colorMode={theme}
          fitView
          fitViewOptions={{ padding: { top: "60px", right: "60px", bottom: "150px", left: "60px" }, maxZoom: 1.2 }}
          minZoom={0.05}
          maxZoom={2.5}
          elevateNodesOnSelect={false}
          zoomOnDoubleClick={false}
          deleteKeyCode={null}
          nodesConnectable={false}
          connectionMode={ConnectionMode.Loose}
          attributionPosition="bottom-center"
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.3} color="var(--dot)" />
          <EdgeMessages meta={flow.meta} />
          <Controls showInteractive={false} position="bottom-left" />
          <CameraContext.Provider value={camera.controller}>
            <LiveView diagram={diagram} presenting={presenting} initial={initial} alwaysOn={alwaysOn} />
          </CameraContext.Provider>
        </ReactFlow>
      </div>
    </DiagramContext.Provider>
  );
}
