import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type Ref,
} from "react";
import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  ConnectionMode,
  ControlButton,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type EdgeMouseHandler,
  type NodeMouseHandler,
  type NodeTypes,
  type EdgeTypes,
  type OnNodeDrag,
  type FitViewOptions,
  type IsValidConnection,
} from "@xyflow/react";
import { getStencil } from "../stencils/registry";
import { useSettings } from "../harness/settings";
import { getNodeVariant } from "../harness/nodeVariants";
import { emptyDiagram, getAutosave, getOriginal, writeAutosave } from "../lib/diagramIO";
import type { DiagramFile } from "../model/types";
import { fromFlow, groupAt, toFlow, type DiagramMeta } from "./convert";
import { DiagramContext, type DiagramUi, type EditTarget } from "./DiagramContext";
import { DiagramNode } from "./nodes/DiagramNode";
import { GroupNode, toneColor } from "./nodes/GroupNode";
import { EdgeMarkers, FlowEdge } from "./edges/FlowEdge";
import { Palette, STENCIL_DND_MIME } from "./Palette";
import { Inspector } from "./Inspector";
import { Icon } from "../components/Icon";
import { ContextMenu } from "../components/ContextMenu";
import { ShortcutsDialog } from "../components/ShortcutsDialog";
import { actionRegistry, type ActionContext, type MenuNode } from "../editor/actions";
import { builtinActions, stencilMenu } from "../editor/builtinActions";
import { useEditorPrefs } from "../editor/prefs";
import { useHistory, type CanvasSnapshot } from "../editor/useHistory";
import { useEditor } from "../editor/useEditor";
import { useCanvasShortcuts } from "../editor/useCanvasShortcuts";
import { formatCombo, isEditableTarget, shortcutKeys } from "../editor/shortcuts";
import type { Selection } from "../editor/types";
import type { DiagramFlowEdge, DiagramFlowNode, FlowNode, GroupFlowNode } from "./types";
import { LiveView } from "../live/LiveView";
import { LIVE_BAR_SPACE } from "../live/layout";
import { safeStorage } from "../lib/storage";

const nodeTypes: NodeTypes = { diagram: DiagramNode, boundary: GroupNode };
const edgeTypes: EdgeTypes = { flow: FlowEdge };
// Pixel padding keeps the title card (top-left) from covering the diagram.
const FIT: FitViewOptions = { padding: { top: "110px", right: "48px", bottom: "48px", left: "48px" }, maxZoom: 1.25 };
// Live: keep the diagram clear of the floating control bar.
const FIT_LIVE: FitViewOptions = { padding: { top: "110px", right: "48px", bottom: `${48 + LIVE_BAR_SPACE}px`, left: "48px" }, maxZoom: 1.25 };
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
  /** Embed / viewer mode: pan and zoom only; no editing chrome, menus, shortcuts or autosave. */
  readOnly?: boolean;
  /** Show this diagram instead of the slug's stored one (embeds, share-link viewers). */
  initial?: DiagramFile;
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

const isDiagramNode = (n: FlowNode): n is DiagramFlowNode => n.type === "diagram";
const isGroupNode = (n: FlowNode): n is GroupFlowNode => n.type === "boundary";
const EMPTY: Selection = { nodeIds: [], edgeIds: [], groupIds: [] };

type MenuState = { x: number; y: number; items: MenuNode[]; label: string; searchable?: string; testId?: string };

// Built-in actions live for the app's lifetime; HMR re-registers them by id.
actionRegistry.register(builtinActions());

function CanvasInner({ slug, presenting, onExitPresent, ref, readOnly = false, initial }: Props) {
  const { theme, nodeVariant, edgeStyle } = useSettings();
  const { screenToFlowPosition, fitView } = useReactFlow<FlowNode, DiagramFlowEdge>();
  const wrapper = useRef<HTMLDivElement>(null);

  const [{ original, flow, originalJson }] = useState(() => {
    const original = initial ?? getOriginal(slug) ?? emptyDiagram();
    return { original, flow: toFlow((initial ? undefined : getAutosave(slug)) ?? original), originalJson: normalize(original) };
  });
  const [meta, setMeta] = useState<DiagramMeta>(flow.meta);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(flow.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<DiagramFlowEdge>(flow.edges);
  const [modified, setModified] = useState(false);
  const [paletteCollapsed, setPaletteCollapsed] = useState(() => {
    const saved = safeStorage.getItem(PALETTE_KEY);
    // Narrow windows always start with the canvas, not the stencil list.
    return saved && window.innerWidth >= 1280 ? saved === "1" : window.innerWidth < 1400;
  });
  useEffect(() => void safeStorage.setItem(PALETTE_KEY, paletteCollapsed ? "1" : "0"), [paletteCollapsed]);
  const [prefs, setPref] = useEditorPrefs();
  // Live mode and narrow windows fold the side panels away by default; opening one by hand wins.
  const [live, setLive] = useState(false);
  const [openedByHand, setOpenedByHand] = useState({ palette: false, inspector: false });
  useEffect(() => setOpenedByHand({ palette: false, inspector: false }), [live]);
  const [narrow, setNarrow] = useState(() => window.innerWidth < 1440);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 1440);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [inspectorFocus, setInspectorFocus] = useState<{ name: string; seq: number } | undefined>();

  const snapshot = useMemo<CanvasSnapshot>(() => ({ meta, nodes, edges }), [meta, nodes, edges]);
  const history = useHistory(snapshot, (s) => {
    setEditing(null);
    setMeta(s.meta);
    setNodes(s.nodes);
    setEdges(s.edges);
  });

  const fit = useCallback(() => void fitView({ ...FIT, duration: 300 }), [fitView]);
  const editor = useEditor({
    slug,
    meta,
    setMeta,
    setNodes,
    setEdges,
    history,
    prefs,
    setPref,
    setEditing,
    openInspector: (field) => {
      setPref("inspector", true);
      setOpenedByHand((o) => ({ ...o, inspector: true }));
      if (field) setInspectorFocus((f) => ({ name: field, seq: (f?.seq ?? 0) + 1 }));
    },
    showShortcuts: () => setShortcutsOpen(true),
    viewCenter: () => {
      const r = wrapper.current?.getBoundingClientRect();
      return r ? screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) : { x: 0, y: 0 };
    },
    fit,
    nodeSize: getNodeVariant(nodeVariant).size,
  });

  useCanvasShortcuts(editor, { enabled: !shortcutsOpen && !readOnly, onEscape: () => setMenu(null) });

  useImperativeHandle(ref, () => ({ getDiagram: () => fromFlow(meta, nodes, edges) }), [meta, nodes, edges]);

  // Autosave per example; drop the save again once the diagram matches the original.
  useEffect(() => {
    if (readOnly) return;
    const t = setTimeout(() => {
      const d = fromFlow(meta, nodes, edges);
      const mod = JSON.stringify(d) !== originalJson;
      writeAutosave(slug, mod ? d : null);
      setModified(mod);
    }, 300);
    return () => clearTimeout(t);
  }, [meta, nodes, edges, slug, originalJson, readOnly]);

  // Refit when chrome appears / disappears (presentation mode).
  useEffect(() => {
    // Wait for React Flow's ResizeObserver to pick up the new pane size first.
    const id = setTimeout(() => fitView({ ...(presenting ? FIT_PRESENT : live ? FIT_LIVE : FIT), duration: 350 }), 80);
    return () => clearTimeout(id);
  }, [presenting, live, fitView]);

  /** Reset is a normal (undoable) edit. */
  const reset = () => {
    const f = toFlow(original);
    setMeta(f.meta);
    setNodes(f.nodes);
    setEdges(f.edges);
    setTimeout(() => fitView({ ...FIT, duration: 350 }), 50);
  };

  // New edges float (sides picked from geometry); pin a side from the menu or inspector.
  const onConnect = useCallback((c: Connection) => void editor.connect(c.source, c.target), [editor]);
  const isValidConnection: IsValidConnection<DiagramFlowEdge> = useCallback((c) => c.source !== c.target, []);

  const onEdgeDoubleClick: EdgeMouseHandler<DiagramFlowEdge> = useCallback((_e, edge) => setEditing({ kind: "edge", id: edge.id }), []);

  // Groups aren't React Flow parents, so carry their member nodes along manually.
  const dragOrigin = useRef<{ x: number; y: number; members: Map<string, { x: number; y: number }> } | null>(null);
  const onNodeDragStart: OnNodeDrag<FlowNode> = useCallback(
    (_e, node) => {
      setMenu(null);
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

  // ---------------------------------------------------------------- context menus

  const openMenu = useCallback(
    (e: ReactMouseEvent | MouseEvent, ctx: Omit<ActionContext, "editor" | "point">) => {
      e.preventDefault();
      if (readOnly) return;
      const full: ActionContext = { ...ctx, editor, point: screenToFlowPosition({ x: e.clientX, y: e.clientY }) };
      const items = actionRegistry.build(full);
      setEditing(null);
      setMenu(items.length ? { x: e.clientX, y: e.clientY, items, label: `${ctx.target} menu` } : null);
    },
    [editor, screenToFlowPosition, readOnly],
  );

  const onPaneContextMenu = useCallback(
    (e: ReactMouseEvent | MouseEvent) => openMenu(e, { target: "canvas", selection: editor.getSelection() }),
    [openMenu, editor],
  );

  const onNodeContextMenu: NodeMouseHandler<FlowNode> = useCallback(
    (e, node) => {
      const sel = editor.getSelection();
      const count = sel.nodeIds.length + sel.groupIds.length + sel.edgeIds.length;
      if (node.selected && count > 1) return openMenu(e, { target: "selection", selection: sel });
      if (isGroupNode(node)) {
        const groupIds = [node.data.groupId];
        editor.select({ groupIds });
        return openMenu(e, { target: "group", groupId: node.data.groupId, selection: { ...EMPTY, groupIds } });
      }
      editor.select({ nodeIds: [node.id] });
      openMenu(e, { target: "node", nodeId: node.id, selection: { ...EMPTY, nodeIds: [node.id] } });
    },
    [editor, openMenu],
  );

  const openEdgeMenu = useCallback(
    (e: ReactMouseEvent | MouseEvent, edgeId: string) => {
      editor.select({ edgeIds: [edgeId] });
      openMenu(e, { target: "edge", edgeId, selection: { ...EMPTY, edgeIds: [edgeId] } });
    },
    [editor, openMenu],
  );
  const onEdgeContextMenu: EdgeMouseHandler<DiagramFlowEdge> = useCallback((e, edge) => openEdgeMenu(e, edge.id), [openEdgeMenu]);

  const onSelectionContextMenu = useCallback(
    (e: ReactMouseEvent) => openMenu(e, { target: "selection", selection: editor.getSelection() }),
    [openMenu, editor],
  );

  /** Double-click on empty canvas: stencil search at the cursor. */
  const onPaneDoubleClick = (e: ReactMouseEvent) => {
    if (readOnly) return;
    if (!(e.target instanceof Element) || !e.target.classList.contains("react-flow__pane")) return;
    const point = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    setMenu({
      x: e.clientX,
      y: e.clientY,
      label: "Add a node",
      testId: "quick-add",
      searchable: "Add a node…",
      items: stencilMenu("quick-add", (s) => ({ run: () => void editor.addNode(s.id, point) })),
    });
  };

  const onDrop = (e: DragEvent) => {
    const id = e.dataTransfer.getData(STENCIL_DND_MIME);
    if (!id) return;
    e.preventDefault();
    editor.addNode(id, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  };

  // ---------------------------------------------------------------- derived

  const direction = meta.direction ?? "LR";
  const ui = useMemo<DiagramUi>(
    () => ({ direction, editing, setEditing: readOnly ? () => {} : setEditing, openEdgeMenu }),
    [direction, editing, openEdgeMenu, readOnly],
  );
  // Read-only (embed) hides the same chrome as presenting, without the presentation sizing.
  const hideChrome = presenting || readOnly;
  const diagramNodes = useMemo(() => nodes.filter(isDiagramNode), [nodes]);
  const groupNodes = useMemo(() => nodes.filter(isGroupNode), [nodes]);
  const selectedNodes = useMemo(() => diagramNodes.filter((n) => n.selected), [diagramNodes]);
  const selectedGroups = useMemo(() => groupNodes.filter((n) => n.selected), [groupNodes]);
  const selectedEdges = useMemo(() => edges.filter((e) => e.selected), [edges]);
  const nothingSelected = !selectedNodes.length && !selectedGroups.length && !selectedEdges.length;
  const paletteHidden = paletteCollapsed || (live && !openedByHand.palette);
  const inspectorHidden = !prefs.inspector || ((live || (narrow && nothingSelected)) && !openedByHand.inspector);
  const labels = useMemo(() => new Map(diagramNodes.map((n) => [n.id, n.data.label || n.id])), [diagramNodes]);
  const nodeCount = diagramNodes.length;
  const undoTitle = `Undo (${formatCombo(shortcutKeys("undo"))})`;
  const redoTitle = `Redo (${formatCombo(shortcutKeys("redo"))})`;

  return (
    <DiagramContext.Provider value={ui}>
      <div
        className={`canvas-view${presenting ? " is-presenting" : ""}`}
        data-testid="canvas-view"
        onContextMenu={(e) => {
          // The app owns right-click; text fields keep the native menu (spellcheck, paste).
          if (!isEditableTarget(e.target)) e.preventDefault();
        }}
      >
        {!hideChrome && (
          <Palette
            collapsed={paletteHidden}
            onToggle={() => {
              setPaletteCollapsed(!paletteHidden);
              setOpenedByHand((o) => ({ ...o, palette: paletteHidden }));
            }}
            onAdd={(id) => void editor.addNode(id)}
          />
        )}
        <div
          className="canvas-wrap"
          data-testid="canvas-wrap"
          ref={wrapper}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(STENCIL_DND_MIME)) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }
          }}
          onDrop={onDrop}
        >
          <EdgeMarkers />
          <ReactFlow<FlowNode, DiagramFlowEdge>
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            connectionMode={ConnectionMode.Loose}
            connectionRadius={28}
            onEdgeDoubleClick={readOnly ? undefined : onEdgeDoubleClick}
            onNodeDragStart={onNodeDragStart}
            onNodeDrag={onNodeDrag}
            onNodeDragStop={onNodeDragStop}
            onPaneContextMenu={onPaneContextMenu}
            onNodeContextMenu={onNodeContextMenu}
            onEdgeContextMenu={onEdgeContextMenu}
            onSelectionContextMenu={onSelectionContextMenu}
            onDoubleClick={onPaneDoubleClick}
            onMoveStart={() => setMenu(null)}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            colorMode={theme}
            attributionPosition="bottom-center"
            fitView
            fitViewOptions={FIT}
            minZoom={0.15}
            maxZoom={2.5}
            snapToGrid={prefs.snap}
            snapGrid={[10, 10]}
            elevateNodesOnSelect={false}
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            elementsSelectable={!readOnly}
            // Embedded in a page: let the wheel scroll the page (pinch / Ctrl+wheel still zoom).
            zoomOnScroll={!readOnly}
            preventScrolling={!readOnly}
            zoomOnDoubleClick={false}
            deleteKeyCode={null}
            connectionLineType={edgeStyle === "bezier" ? ConnectionLineType.Bezier : edgeStyle === "straight" ? ConnectionLineType.Straight : ConnectionLineType.SmoothStep}
          >
            {prefs.grid && <Background variant={BackgroundVariant.Dots} gap={20} size={1.3} color="var(--dot)" />}
            {!hideChrome && (
              <Controls showInteractive={false} position="bottom-left">
                <ControlButton onClick={editor.undo} disabled={!history.canUndo} title={undoTitle} aria-label="Undo" data-testid="undo-button">
                  <Icon name="undo" size={14} />
                </ControlButton>
                <ControlButton onClick={editor.redo} disabled={!history.canRedo} title={redoTitle} aria-label="Redo" data-testid="redo-button">
                  <Icon name="redo" size={14} />
                </ControlButton>
                <ControlButton onClick={() => setShortcutsOpen(true)} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" data-testid="shortcuts-button">
                  <Icon name="keyboard" size={14} />
                </ControlButton>
              </Controls>
            )}
            {!hideChrome && prefs.minimap && (
              <MiniMap
                position="bottom-right"
                style={{ width: 168, height: 112 }}
                pannable
                zoomable
                nodeBorderRadius={6}
                nodeStrokeWidth={2}
                nodeColor={(n) => (n.type === "boundary" ? "transparent" : getStencil((n as DiagramFlowNode).data.stencil).accent)}
                nodeStrokeColor={(n) => (n.type === "boundary" ? toneColor[(n as GroupFlowNode).data.tone] : "transparent")}
              />
            )}
            <LiveView
              editor={readOnly ? undefined : editor}
              diagram={readOnly ? fromFlow(meta, nodes, edges) : undefined}
              presenting={presenting}
              simulations={meta.simulations}
              onLiveChange={setLive}
            />
          </ReactFlow>

          <div className={`diagram-card${presenting ? " is-large" : ""}`} data-testid="diagram-card">
            <h1 data-testid="diagram-title">{meta.title}</h1>
            {meta.description && <p>{meta.description}</p>}
            {!hideChrome && (
              <div className="diagram-card-meta">
                <span>
                  {nodeCount} nodes, {edges.length} edges
                </span>
                {modified && (
                  <button className="link-btn" onClick={reset} data-testid="reset-diagram" title="Discard your edits to this diagram (undoable)">
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

          {nodeCount === 0 && !hideChrome && (
            <div className="canvas-empty">
              <strong>This diagram is empty</strong>
              <span>Drag a stencil from the left, or double-click the canvas to add one.</span>
            </div>
          )}
        </div>
        {!hideChrome && (
          <Inspector
            editor={editor}
            meta={meta}
            selectedNodes={selectedNodes}
            selectedGroups={selectedGroups}
            selectedEdges={selectedEdges}
            groups={groupNodes}
            nodeLabel={(id) => labels.get(id) ?? id}
            counts={{ nodes: nodeCount, edges: edges.length, groups: groupNodes.length }}
            collapsed={inspectorHidden}
            onToggle={() => {
              setPref("inspector", inspectorHidden);
              setOpenedByHand((o) => ({ ...o, inspector: inspectorHidden }));
            }}
            focus={inspectorFocus}
          />
        )}
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          label={menu.label}
          searchable={menu.searchable}
          testId={menu.testId}
          onClose={() => setMenu(null)}
        />
      )}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
    </DiagramContext.Provider>
  );
}
