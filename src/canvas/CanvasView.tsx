import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type DragEvent, type Ref } from "react";
import {
  addEdge,
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type EdgeMouseHandler,
  type NodeTypes,
  type EdgeTypes,
  type OnNodeDrag,
  type FitViewOptions,
} from "@xyflow/react";
import { getStencil } from "../stencils/registry";
import { useSettings } from "../harness/settings";
import { getNodeVariant } from "../harness/nodeVariants";
import { emptyDiagram, getAutosave, getOriginal, writeAutosave } from "../lib/diagramIO";
import type { DiagramFile } from "../model/types";
import { fromFlow, groupAt, toFlow } from "./convert";
import { DiagramContext } from "./DiagramContext";
import { DiagramNode } from "./nodes/DiagramNode";
import { GroupNode, toneColor } from "./nodes/GroupNode";
import { EdgeMarkers, FlowEdge } from "./edges/FlowEdge";
import { Palette, STENCIL_DND_MIME } from "./Palette";
import { Icon } from "../components/Icon";
import type { DiagramFlowEdge, DiagramFlowNode, FlowNode } from "./types";

const nodeTypes: NodeTypes = { diagram: DiagramNode, boundary: GroupNode };
const edgeTypes: EdgeTypes = { flow: FlowEdge };
// Pixel padding keeps the title card (top-left) from covering the diagram.
const FIT: FitViewOptions = { padding: { top: "150px", right: "48px", bottom: "48px", left: "48px" }, maxZoom: 1.25 };
const FIT_PRESENT: FitViewOptions = { padding: { top: "190px", right: "64px", bottom: "64px", left: "64px" }, maxZoom: 1.6 };

const PALETTE_KEY = "diagrams.paletteCollapsed.v1";

export interface CanvasHandle {
  /** Current canvas as a diagrams/v1 file. */
  getDiagram: () => DiagramFile;
}

interface Props {
  slug: string;
  presenting: boolean;
  onExitPresent: () => void;
  ref?: Ref<CanvasHandle>;
}

export function CanvasView(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

const normalize = (d: DiagramFile) => {
  const f = toFlow(d);
  return JSON.stringify(fromFlow(f.meta, f.nodes, f.edges));
};

function uniqueId(base: string, taken: Set<string>) {
  let i = 1;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

function CanvasInner({ slug, presenting, onExitPresent, ref }: Props) {
  const { theme, nodeVariant, edgeStyle } = useSettings();
  const { screenToFlowPosition, fitView } = useReactFlow<FlowNode, DiagramFlowEdge>();
  const wrapper = useRef<HTMLDivElement>(null);

  const [{ original, flow, originalJson }] = useState(() => {
    const original = getOriginal(slug) ?? emptyDiagram();
    return { original, flow: toFlow(getAutosave(slug) ?? original), originalJson: normalize(original) };
  });
  const meta = flow.meta;
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(flow.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<DiagramFlowEdge>(flow.edges);
  const [modified, setModified] = useState(false);
  const [paletteCollapsed, setPaletteCollapsed] = useState(() => {
    const saved = localStorage.getItem(PALETTE_KEY);
    return saved ? saved === "1" : window.innerWidth < 1400;
  });
  useEffect(() => localStorage.setItem(PALETTE_KEY, paletteCollapsed ? "1" : "0"), [paletteCollapsed]);

  useImperativeHandle(ref, () => ({ getDiagram: () => fromFlow(meta, nodes, edges) }), [meta, nodes, edges]);

  // Autosave per example; drop the save again once the diagram matches the original.
  useEffect(() => {
    const t = setTimeout(() => {
      const d = fromFlow(meta, nodes, edges);
      const mod = JSON.stringify(d) !== originalJson;
      writeAutosave(slug, mod ? d : null);
      setModified(mod);
    }, 300);
    return () => clearTimeout(t);
  }, [meta, nodes, edges, slug, originalJson]);

  // Refit when chrome appears / disappears (presentation mode).
  useEffect(() => {
    // Wait for React Flow's ResizeObserver to pick up the new pane size first.
    const id = setTimeout(() => fitView({ ...(presenting ? FIT_PRESENT : FIT), duration: 350 }), 80);
    return () => clearTimeout(id);
  }, [presenting, fitView]);

  const reset = () => {
    const f = toFlow(original);
    setNodes(f.nodes);
    setEdges(f.edges);
    setTimeout(() => fitView({ ...FIT, duration: 350 }), 50);
  };

  const onConnect = useCallback(
    (c: Connection) =>
      setEdges((es) =>
        addEdge<DiagramFlowEdge>(
          { ...c, id: uniqueId("e", new Set(es.map((e) => e.id))), type: "flow", data: { kind: "async" } },
          es,
        ),
      ),
    [setEdges],
  );

  const onEdgeDoubleClick: EdgeMouseHandler<DiagramFlowEdge> = useCallback(
    (_e, edge) =>
      setEdges((es) =>
        es.map((e) =>
          e.id === edge.id
            ? { ...e, data: { ...e.data, kind: e.data?.kind === "sync" ? "async" : "sync" } as DiagramFlowEdge["data"] }
            : e,
        ),
      ),
    [setEdges],
  );

  // Groups aren't React Flow parents, so carry their member nodes along manually.
  const dragOrigin = useRef<{ x: number; y: number; members: Map<string, { x: number; y: number }> } | null>(null);
  const onNodeDragStart: OnNodeDrag<FlowNode> = useCallback(
    (_e, node) => {
      if (node.type !== "boundary") return;
      const members = new Map<string, { x: number; y: number }>();
      for (const n of nodes) if (n.type === "diagram" && n.data.group === node.data.groupId) members.set(n.id, { ...n.position });
      dragOrigin.current = { x: node.position.x, y: node.position.y, members };
    },
    [nodes],
  );
  const onNodeDrag: OnNodeDrag<FlowNode> = useCallback(
    (_e, node) => {
      const o = dragOrigin.current;
      if (node.type !== "boundary" || !o) return;
      const dx = node.position.x - o.x;
      const dy = node.position.y - o.y;
      setNodes((ns) =>
        ns.map((n) => {
          const p = o.members.get(n.id);
          return p ? { ...n, position: { x: p.x + dx, y: p.y + dy } } : n;
        }),
      );
    },
    [setNodes],
  );
  const onNodeDragStop: OnNodeDrag<FlowNode> = useCallback(
    (_e, _node, dragged) => {
      dragOrigin.current = null;
      const ids = new Set(dragged.filter((n) => n.type === "diagram").map((n) => n.id));
      if (!ids.size) return;
      setNodes((ns) =>
        ns.map((n) => {
          if (!ids.has(n.id) || n.type !== "diagram") return n;
          const w = n.measured?.width ?? 0;
          const h = n.measured?.height ?? 0;
          const group = groupAt(ns, n.position.x + w / 2, n.position.y + h / 2);
          return group === n.data.group ? n : { ...n, data: { ...n.data, group } };
        }),
      );
    },
    [setNodes],
  );

  const addStencilAt = useCallback(
    (stencilId: string, screen: { x: number; y: number }) => {
      const s = getStencil(stencilId);
      const { width, height } = getNodeVariant(nodeVariant).size;
      const p = screenToFlowPosition(screen);
      const position = { x: Math.round((p.x - width / 2) / 10) * 10, y: Math.round((p.y - height / 2) / 10) * 10 };
      setNodes((ns) => {
        const base = s.id.split(".").slice(-1)[0].replace(/[^a-z0-9-]/gi, "") || "node";
        const node: DiagramFlowNode = {
          id: uniqueId(base, new Set(ns.map((n) => n.id))),
          type: "diagram",
          position,
          selected: true,
          data: {
            stencil: stencilId,
            label: s.label,
            sublabel: s.defaultSublabel,
            group: groupAt(ns, p.x, p.y),
          },
        };
        return [...ns.map((n) => (n.selected ? { ...n, selected: false } : n)), node];
      });
    },
    [nodeVariant, screenToFlowPosition, setNodes],
  );

  const onDrop = (e: DragEvent) => {
    const id = e.dataTransfer.getData(STENCIL_DND_MIME);
    if (!id) return;
    e.preventDefault();
    addStencilAt(id, { x: e.clientX, y: e.clientY });
  };

  const addAtCenter = (id: string) => {
    const r = wrapper.current?.getBoundingClientRect();
    if (r) addStencilAt(id, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
  };

  const direction = meta.direction ?? "LR";
  const ctx = useMemo(() => ({ direction }), [direction]);
  const nodeCount = nodes.filter((n) => n.type === "diagram").length;

  return (
    <DiagramContext.Provider value={ctx}>
      <div className={`canvas-view${presenting ? " is-presenting" : ""}`} data-testid="canvas-view">
        {!presenting && (
          <Palette collapsed={paletteCollapsed} onToggle={() => setPaletteCollapsed((c) => !c)} onAdd={addAtCenter} />
        )}
        <div className="canvas-wrap" ref={wrapper} onDragOver={(e) => {
          if (e.dataTransfer.types.includes(STENCIL_DND_MIME)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }
        }} onDrop={onDrop}>
          <EdgeMarkers />
          <ReactFlow<FlowNode, DiagramFlowEdge>
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onEdgeDoubleClick={onEdgeDoubleClick}
            onNodeDragStart={onNodeDragStart}
            onNodeDrag={onNodeDrag}
            onNodeDragStop={onNodeDragStop}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            colorMode={theme}
            attributionPosition="bottom-center"
            fitView
            fitViewOptions={FIT}
            minZoom={0.15}
            maxZoom={2.5}
            snapToGrid
            snapGrid={[10, 10]}
            elevateNodesOnSelect={false}
            zoomOnDoubleClick={false}
            deleteKeyCode={["Backspace", "Delete"]}
            connectionLineType={edgeStyle === "bezier" ? ConnectionLineType.Bezier : edgeStyle === "straight" ? ConnectionLineType.Straight : ConnectionLineType.SmoothStep}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1.3} color="var(--dot)" />
            {!presenting && <Controls showInteractive={false} position="bottom-left" />}
            {!presenting && (
              <MiniMap
                position="bottom-right"
                pannable
                zoomable
                nodeBorderRadius={6}
                nodeStrokeWidth={2}
                nodeColor={(n) => (n.type === "boundary" ? "transparent" : getStencil((n as DiagramFlowNode).data.stencil).accent)}
                nodeStrokeColor={(n) => (n.type === "boundary" ? toneColor[(n as FlowNode & { type: "boundary" }).data.tone] : "transparent")}
              />
            )}
          </ReactFlow>

          <div className={`diagram-card${presenting ? " is-large" : ""}`} data-testid="diagram-card">
            <h1 data-testid="diagram-title">{meta.title}</h1>
            {meta.description && <p>{meta.description}</p>}
            {!presenting && (
              <div className="diagram-card-meta">
                <span>
                  {nodeCount} nodes, {edges.length} edges
                </span>
                {modified && (
                  <button className="link-btn" onClick={reset} data-testid="reset-diagram" title="Discard your edits to this diagram">
                    <Icon name="reset" size={13} /> Edited, reset
                  </button>
                )}
              </div>
            )}
          </div>

          {presenting && (
            <button className="present-exit" onClick={onExitPresent} data-testid="present-exit">
              <Icon name="close" size={14} /> Exit presentation <kbd>Esc</kbd>
            </button>
          )}

          {nodeCount === 0 && !presenting && (
            <div className="canvas-empty">
              <strong>This diagram is empty</strong>
              <span>Drag a stencil from the left to add the first node.</span>
            </div>
          )}
        </div>
      </div>
    </DiagramContext.Provider>
  );
}
