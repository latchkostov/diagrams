import { projectDependencies, useShowDependencies } from "../canvas/dependencyVisibility";
import { useContext, useMemo, useRef, useState, type ContextType } from "react";
import { useCaptionContrast } from "../canvas/useCaptionContrast";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useStore,
  ViewportPortal,
  type EdgeTypes,
  type NodeTypes,
  type ReactFlowState,
} from "@xyflow/react";
import type { DiagramFile } from "../model/types";
import { useSettings } from "../harness/settings";
import { toFlow } from "../canvas/convert";
import { DiagramContext } from "../canvas/DiagramContext";
import { canvasNodeTypes } from "../canvas/nodes/nodeTypes";
import { EdgeMarkers, FlowEdge } from "../canvas/edges/FlowEdge";
import {
  lastRoutingMs,
  routeInputFromStore,
  useAllRoutes,
  useRoutingOptions,
  type RouteOptions,
} from "../canvas/edges/useEdgeRoute";
import { auditLayout, countViolations, type Violation, type ViolationKind } from "../canvas/geometry/audit";
import type { DiagramFlowEdge, FlowNode } from "../canvas/types";

const nodeTypes: NodeTypes = canvasNodeTypes;
const edgeTypes: EdgeTypes = { flow: FlowEdge };

const KIND_LABEL: Record<ViolationKind, string> = {
  "node-node": "Node on node",
  "label-node": "Label on node",
  "label-label": "Label on label",
  "label-header": "Label on group header",
  "edge-node": "Edge through node",
  "header-node": "Group header on node",
  "edge-overlap": "Edges on one track",
};

/**
 * Renders a diagram on the real canvas components and outlines every overlap the geometry audit
 * (src/canvas/geometry/audit.ts) finds: nodes, label pills, routes and group headers.
 */
export function OverlapAudit({ diagram }: { diagram: DiagramFile }) {
  return (
    <ReactFlowProvider>
      <Stage diagram={diagram} />
    </ReactFlowProvider>
  );
}

type Ui = ContextType<typeof DiagramContext>;

function Stage({ diagram }: { diagram: DiagramFile }) {
  const { theme, edgeStyle, nodeVariant } = useSettings();
  const flow = useMemo(() => toFlow(diagram), [diagram]);
  const [nodes, , onNodesChange] = useNodesState<FlowNode>(flow.nodes);
  const wrapper = useRef<HTMLDivElement>(null);
  useCaptionContrast(wrapper, nodes, theme, flow.meta.color);
  const [edges, , onEdgesChange] = useEdgesState<DiagramFlowEdge>(flow.edges);
  const showDependencies = useShowDependencies();
  const visibleEdges = useMemo(() => projectDependencies(edges, showDependencies), [edges, showDependencies]);
  const base = useContext(DiagramContext);
  const [editing, setEditing] = useState<unknown>(null);
  const direction = flow.meta.direction ?? "LR";
  const ui = useMemo(
    () => ({ ...base, theme, direction, editing, setEditing }) as Ui,
    [base, theme, direction, editing],
  );
  const opts = { style: edgeStyle, direction, captions: nodeVariant === "iconOnly" } as const;

  return (
    <DiagramContext.Provider value={ui}>
      <div className="lab-canvas" data-testid="lab-canvas" ref={wrapper}>
        <EdgeMarkers />
        <ReactFlow<FlowNode, DiagramFlowEdge>
          nodes={nodes}
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
          connectionMode={ConnectionMode.Loose}
          attributionPosition="bottom-center"
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.3} color="var(--dot)" />
          <Controls showInteractive={false} position="bottom-left" />
          <AuditLayer opts={opts} />
        </ReactFlow>
      </div>
    </DiagramContext.Provider>
  );
}

function AuditLayer({ opts }: { opts: Pick<RouteOptions, "style" | "direction" | "captions"> }) {
  const routing = useRoutingOptions(opts);
  const routes = useAllRoutes(routing);
  const lookup = useStore((s: ReactFlowState) => s.nodeLookup);
  const sEdges = useStore((s: ReactFlowState) => s.edges as DiagramFlowEdge[]);
  const ms = useStore((s: ReactFlowState) => lastRoutingMs(s as never));
  // Recompute when routes change (they change whenever nodes or edges do).
  const violations = useMemo<Violation[]>(() => {
    const input = routeInputFromStore(lookup.values() as never, sEdges, routing);
    return auditLayout({
      nodes: input.nodes,
      groups: input.groups,
      edges: input.edges.flatMap((e) =>
        routes.get(e.id) ? [{ id: e.id, source: e.source, target: e.target, points: routes.get(e.id)!.points }] : [],
      ),
      labels: input.edges.flatMap((e) => {
        const l = routes.get(e.id)?.label;
        return l
          ? [{ id: e.id, rect: { x: l.x - l.width / 2, y: l.y - l.height / 2, width: l.width, height: l.height } }]
          : [];
      }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- routes identity covers node / edge changes
  }, [routes, sEdges]);
  const counts = countViolations(violations);
  const modes = [...routes.values()].reduce<Record<string, number>>((acc, r) => {
    if (r.label) acc[r.label.mode] = (acc[r.label.mode] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <ViewportPortal>
        {violations.map((v, i) => (
          <div
            key={i}
            className={`lab-audit-box is-${v.kind}`}
            title={`${KIND_LABEL[v.kind]}: ${v.a} / ${v.b}`}
            style={{
              transform: `translate(${v.at.x - 3}px, ${v.at.y - 3}px)`,
              width: v.at.width + 6,
              height: v.at.height + 6,
            }}
          />
        ))}
      </ViewportPortal>
      <div
        className="lab-audit-panel"
        data-testid="audit-summary"
        data-total={violations.length}
        data-routes={routes.size}
      >
        <strong>
          {violations.length ? `${violations.length} overlap${violations.length === 1 ? "" : "s"}` : "No overlaps"}
        </strong>
        <ul>
          {(Object.keys(KIND_LABEL) as ViolationKind[]).map((k) => (
            <li key={k} className={counts[k] ? "is-bad" : ""} data-testid={`audit-count-${k}`} data-count={counts[k]}>
              <span>{KIND_LABEL[k]}</span>
              <b>{counts[k]}</b>
            </li>
          ))}
        </ul>
        <div className="lab-audit-foot mono" data-testid="audit-routing-ms">
          Routing {ms.toFixed(1)} ms · labels{" "}
          {Object.entries(modes)
            .map(([m, n]) => `${n} ${m}`)
            .join(", ") || "none"}
        </div>
      </div>
    </>
  );
}
