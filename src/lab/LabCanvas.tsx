import { projectDependencies, useShowDependencies } from "../canvas/dependencyVisibility";
import { useContext, useEffect, useMemo, useRef, useState, type ContextType } from "react";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  type EdgeTypes,
  type NodeTypes,
} from "@xyflow/react";
import type { DiagramFile } from "../model/types";
import { useSettings } from "../harness/settings";
import { getStencil } from "../stencils/registry";
import { toFlow, withEditingOnTop } from "../canvas/convert";
import { DiagramContext, type EditTarget } from "../canvas/DiagramContext";
import { canvasNodeTypes } from "../canvas/nodes/nodeTypes";
import { EdgeMarkers, FlowEdge } from "../canvas/edges/FlowEdge";
import type { DiagramFlowEdge, DiagramFlowNode, FlowNode } from "../canvas/types";

/**
 * A lightweight stage for any DiagramFile, built from the canvas's own node / edge components
 * (imported, not forked) so the Lab always shows the current renderers. No autosave, no palette.
 * For the full editor, the Lab's "Open in editor" button hands the diagram to the Canvas view.
 */
const nodeTypes: NodeTypes = canvasNodeTypes;
const edgeTypes: EdgeTypes = { flow: FlowEdge };

interface Props {
  diagram: DiagramFile;
  minimap?: boolean;
  /** Called once every node has been measured, with ms since this stage mounted. */
  onRendered?: (ms: number) => void;
}

export function LabCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <Stage {...props} />
    </ReactFlowProvider>
  );
}

type Ui = ContextType<typeof DiagramContext>;

function Stage({ diagram, minimap = true, onRendered }: Props) {
  const { theme } = useSettings();
  const [start] = useState(() => performance.now());
  const flow = useMemo(() => toFlow(diagram), [diagram]);
  const [nodes, , onNodesChange] = useNodesState<FlowNode>(flow.nodes);
  const [edges, , onEdgesChange] = useEdgesState<DiagramFlowEdge>(flow.edges);
  const showDependencies = useShowDependencies();
  const visibleEdges = useMemo(() => projectDependencies(edges, showDependencies), [edges, showDependencies]);
  const initialized = useNodesInitialized();
  const reported = useRef(false);

  useEffect(() => {
    // useNodesInitialized stays false for an empty diagram, so report those straight away.
    if ((!initialized && flow.nodes.length > 0) || reported.current) return;
    reported.current = true;
    // Next frame: the browser has painted the measured layout.
    requestAnimationFrame(() => onRendered?.(Math.round(performance.now() - start)));
  }, [initialized, onRendered, start, flow.nodes.length]);

  // Inline editing (F2 / double-click) works like on the canvas; edits stay local to the Lab.
  const base = useContext(DiagramContext);
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const direction = flow.meta.direction ?? "LR";
  const ui = useMemo(() => ({ ...base, direction, editing, setEditing }) as Ui, [base, direction, editing]);
  const raised = useMemo(() => withEditingOnTop(nodes, editing), [nodes, editing]);

  return (
    <DiagramContext.Provider value={ui}>
      <div className="lab-canvas" data-testid="lab-canvas">
        <EdgeMarkers />
        <ReactFlow<FlowNode, DiagramFlowEdge>
          nodes={raised}
          edges={visibleEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          colorMode={theme}
          fitView
          fitViewOptions={{ padding: 0.12, maxZoom: 1.25 }}
          minZoom={0.05}
          maxZoom={2.5}
          snapToGrid
          snapGrid={[10, 10]}
          elevateNodesOnSelect={false}
          zoomOnDoubleClick={false}
          deleteKeyCode={null}
          nodesConnectable={false}
          // Nodes expose one handle per side, all of type source; Loose lets edges attach to any of them.
          connectionMode={ConnectionMode.Loose}
          attributionPosition="bottom-center"
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.3} color="var(--dot)" />
          <Controls showInteractive={false} position="bottom-left" />
          {minimap && (
            <MiniMap
              position="bottom-right"
              pannable
              zoomable
              nodeBorderRadius={6}
              nodeColor={(n) =>
                n.type === "diagram" ? getStencil((n as DiagramFlowNode).data.stencil).accent : "transparent"
              }
            />
          )}
        </ReactFlow>
      </div>
    </DiagramContext.Provider>
  );
}
