import { isDependency } from "../model/relations";
import { dependencyVisibility, projectDependencies, useShowDependencies } from "./dependencyVisibility";
import { edgeMarks } from "./edgeMarks";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
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
  useNodesInitialized,
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
import {
  DRAFT_SLUG,
  emptyDiagram,
  getAutosave,
  getDiagramIdentity,
  getOriginal,
  isLibrarySlug,
  isLocalOnlySource,
  UNTITLED,
  writeAutosave,
} from "../lib/diagramIO";
import type { AnnotationKind, AnnotationShape, DiagramFile } from "../model/types";
import { fromFlow, groupAt, toFlow, withEdgeAria, withEditingOnTop, withNodeAria, type DiagramMeta } from "./convert";
import { DiagramContext, type DiagramUi, type EditTarget } from "./DiagramContext";
import { useCovered, useKeepSelectionInView, useOverlayFit, useOverlayTestIds } from "./useOverlayFit";
import { canvasNodeTypes } from "./nodes/nodeTypes";
import {
  ANNOTATION_COLORS,
  ANNOTATION_DND_MIME,
  annotationColor,
  annotationTitle,
  parseAnnotationDrag,
} from "./annotations";
import { toneColor } from "./groupTones";
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
import type { Selection, XYBox } from "../editor/types";
import type { AnnotationFlowNode, DiagramFlowEdge, DiagramFlowNode, FlowNode, GroupFlowNode } from "./types";
import { LiveView } from "../live/LiveView";
import { LIVE_BAR_SPACE } from "../live/layout";
import { safeStorage } from "../lib/storage";
import { StartCard, type StartOptions } from "./StartCard";
import { useAiDock } from "../ai/ui/dock";
import { motionMs } from "../lib/motion";
import { NodeTooltip } from "./NodeTooltip";
import { useNodeTipKeyboard, useNodeTooltip } from "./useNodeTooltip";
import { FirstRunHint } from "./FirstRunHint";
import { notify } from "../interop/ui/toast";
import { useCanvasHost } from "../palette/canvasHost";

const nodeTypes: NodeTypes = canvasNodeTypes;
const edgeTypes: EdgeTypes = { flow: FlowEdge };
// Pixel padding keeps the title card (top-left) from covering the diagram.
/** A fit's viewport transition starts within this long (a frame, or a few under load). */
const FIT_MOVE_MS = 250;
const FIT: FitViewOptions = { padding: { top: "110px", right: "48px", bottom: "48px", left: "48px" }, maxZoom: 1.25 };
const FIT_PRESENT: FitViewOptions = {
  padding: { top: "190px", right: "64px", bottom: "64px", left: "64px" },
  maxZoom: 1.6,
};

const PALETTE_KEY = "diagrams.paletteCollapsed.v1";
const HINT_KEY = "diagrams.firstRunHint.v1";
/** Below this width the inspector waits for a selection: two open side panels leave too little canvas. */
const ROOMY = 1680;
const CRAMPED = 1280;

export interface CanvasHandle {
  /** Current canvas as a diagrams/v1 file. */
  getDiagram: () => DiagramFile;
  /** Writes pending edits to storage now (before reading or replacing this diagram's stored copy). */
  flush: () => void;
  /** Renames the diagram as a normal, undoable edit. */
  setTitle: (title: string) => void;
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
  /** Ways in for a blank diagram (the start card). Absent: a plain hint. */
  start?: StartOptions;
  /** Told the title as it's edited (the picker follows it without waiting for the autosave). */
  onTitleChange?: (title: string) => void;
}

/** Minimap: notes show their tint; zones, text and shapes are outlines. */
function annotationMinimapFill(n: AnnotationFlowNode): string {
  return n.data.kind === "note" ? ANNOTATION_COLORS[annotationColor(n.data)].hex : "transparent";
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
const isAnnotationNode = (n: FlowNode): n is AnnotationFlowNode => n.type === "annotation";
const EMPTY: Selection = { nodeIds: [], edgeIds: [], groupIds: [] };

type MenuState = { x: number; y: number; items: MenuNode[]; label: string; searchable?: string; testId?: string };

// Built-in actions live for the app's lifetime; HMR re-registers them by id.
actionRegistry.register(builtinActions());

function CanvasInner({ slug, presenting, onExitPresent, ref, readOnly = false, initial, start, onTitleChange }: Props) {
  const { theme, nodeVariant, edgeStyle } = useSettings();
  const { screenToFlowPosition, fitView, getNodes, getNodesBounds, getViewport, setCenter } = useReactFlow<
    FlowNode,
    DiagramFlowEdge
  >();
  const wrapper = useRef<HTMLDivElement>(null);
  /** The pointer over the canvas (client coords), for "T adds text here". */
  const pointer = useRef<{ x: number; y: number } | null>(null);

  const [{ original, flow, originalJson, loadedJson, identity }] = useState(() => {
    const original = initial ?? getOriginal(slug) ?? emptyDiagram();
    const flow = toFlow((initial ? undefined : getAutosave(slug)) ?? original);
    return {
      original,
      flow,
      originalJson: normalize(original),
      loadedJson: JSON.stringify(fromFlow(flow.meta, flow.nodes, flow.edges)),
      // The document this canvas loaded: late writes (an unmount flush) never land on a replacement.
      identity: initial ? undefined : getDiagramIdentity(slug),
    };
  });
  const [meta, setMeta] = useState<DiagramMeta>(flow.meta);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(flow.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<DiagramFlowEdge>(flow.edges);
  const [modified, setModified] = useState(loadedJson !== originalJson);
  const [paletteCollapsed, setPaletteCollapsed] = useState(() => {
    const saved = safeStorage.getItem(PALETTE_KEY);
    // Narrow windows always start with the canvas, not the stencil list.
    return saved && window.innerWidth >= 1280 ? saved === "1" : window.innerWidth < 1400;
  });
  useEffect(() => void safeStorage.setItem(PALETTE_KEY, paletteCollapsed ? "1" : "0"), [paletteCollapsed]);
  const [prefs, setPref] = useEditorPrefs();
  // Live mode and narrow windows fold the side panels away by default; opening one by hand wins.
  const [live, setLive] = useState(false);
  const [livePanelOpen, setLivePanelOpen] = useState(false);
  const [openedByHand, setOpenedByHand] = useState({ live, palette: false, inspector: false });
  if (openedByHand.live !== live) setOpenedByHand({ live, palette: false, inspector: false });
  const [narrow, setNarrow] = useState(() => window.innerWidth < ROOMY);
  // Below CRAMPED, an open Ask AI dock keeps the inspector folded to its rail until opened by hand.
  const [cramped, setCramped] = useState(() => window.innerWidth < CRAMPED);
  const aiDock = useAiDock();
  const aiDockOpen = aiDock.open;
  useEffect(() => {
    const onResize = () => {
      setNarrow(window.innerWidth < ROOMY);
      setCramped(window.innerWidth < CRAMPED);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [inspectorFocus, setInspectorFocus] = useState<{ name: string; seq: number } | undefined>();
  const [startDismissed, setStartDismissed] = useState(false);
  const [hintSeen, setHintSeen] = useState(() => readOnly || safeStorage.getItem(HINT_KEY) === "1");
  const dismissHint = useCallback(() => {
    setHintSeen(true);
    safeStorage.setItem(HINT_KEY, "1");
  }, []);
  // Going live counts as having found the live view (so the first-run hint retires).
  const onLiveChange = useCallback(
    (on: boolean) => {
      setLive(on);
      if (on) dismissHint();
    },
    [dismissHint],
  );
  const { tip: nodeTip, show: showTip, hide: hideTip } = useNodeTooltip(!live && !readOnly && !presenting && !editing);
  useNodeTipKeyboard(
    wrapper,
    (id) => {
      const n = nodes.find((x) => x.id === id);
      return n?.type === "diagram"
        ? { nodeId: n.id, label: n.data.label || n.id, sublabel: n.data.sublabel, stencil: n.data.stencil }
        : null;
    },
    nodeTip,
    showTip,
    hideTip,
  );

  const snapshot = useMemo<CanvasSnapshot>(() => ({ meta, nodes, edges }), [meta, nodes, edges]);
  const history = useHistory(snapshot, (s) => {
    setEditing(null);
    setMeta(s.meta);
    setNodes(s.nodes);
    setEdges(s.edges);
  });

  // Fit-view keeps content out from under the title card, minimap, controls and live bar.
  const fitView_ = useOverlayFit(wrapper, { style: edgeStyle, direction: meta.direction ?? "LR" });
  /** True while the view is a fit (the whole diagram in view), false once the user pans or zooms. */
  const showingAll = useRef(true);
  /** When the last whole-diagram fit started: its viewport move isn't the user's. */
  const fitAt = useRef(0);
  const overlayFit = useCallback(
    (o?: Parameters<typeof fitView_>[0]) => {
      showingAll.current = true;
      fitAt.current = performance.now();
      fitView_(o);
    },
    [fitView_],
  );
  const fit = useCallback(() => overlayFit({ maxZoom: 1.25, duration: 300 }), [overlayFit]);
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
    pointer: () => (pointer.current ? screenToFlowPosition(pointer.current) : undefined),
    edgeMarks: () => edgeMarks(wrapper.current),
    fit,
    nodeSize: getNodeVariant(nodeVariant).size,
  });

  useCanvasShortcuts(editor, { enabled: !shortcutsOpen && !readOnly, onEscape: () => setMenu(null), live });
  // The command palette (Ctrl/Cmd+K) acts on this canvas while it's mounted and editable.
  const hostRevision = useMemo(() => ({ nodes, edges, meta }), [nodes, edges, meta]);
  useCanvasHost(editor, {
    live,
    enabled: !readOnly,
    localOnly: isLocalOnlySource(slug, fromFlow(meta, nodes, edges)),
    documentId: getDiagramIdentity(slug),
    revision: hostRevision,
  });

  // ---------------------------------------------------------------- autosave
  // Debounced while editing, and flushed whenever the canvas could go away before the timer fires:
  // on unmount (switching diagrams), on page hide (reload, close, navigation) and when the tab is
  // hidden (mobile browsers may discard it). Writes the latest state, never a stale closure, and
  // drops the save again once the diagram matches the original.
  const latest = useRef({ meta, nodes, edges, slug });
  useLayoutEffect(() => {
    latest.current = { meta, nodes, edges, slug };
  });
  const lastSaved = useRef(loadedJson);
  /** Returns whether the diagram differs from its original, or undefined when there was nothing to write. */
  const flushSave = useCallback((): boolean | undefined => {
    if (readOnly) return undefined;
    const { meta, nodes, edges, slug } = latest.current;
    const d = fromFlow(meta, nodes, edges);
    const json = JSON.stringify(d);
    if (json === lastSaved.current) return undefined;
    const mod = json !== originalJson;
    if (writeAutosave(slug, mod ? d : null, identity)) lastSaved.current = json;
    return mod;
  }, [readOnly, originalJson, identity]);
  useEffect(() => {
    if (readOnly) return;
    const t = setTimeout(() => {
      const mod = flushSave();
      if (mod !== undefined) setModified(mod);
    }, 300);
    return () => clearTimeout(t);
  }, [meta, nodes, edges, readOnly, flushSave]);
  useEffect(() => {
    if (readOnly) return;
    const onPageHide = () => void flushSave();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushSave();
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
      flushSave();
    };
  }, [readOnly, flushSave]);

  useImperativeHandle(
    ref,
    () => ({
      getDiagram: () => fromFlow(meta, nodes, edges),
      flush: () => {
        const mod = flushSave();
        if (mod !== undefined) setModified(mod);
      },
      setTitle: (title: string) => editor.updateMeta({ title }),
    }),
    [meta, nodes, edges, flushSave, editor],
  );

  useEffect(() => onTitleChange?.(meta.title), [meta.title, onTitleChange]);

  // Refit when chrome appears / disappears (presentation mode).
  useEffect(() => {
    // Wait for React Flow's ResizeObserver to pick up the new pane size first.
    const id = setTimeout(
      () =>
        overlayFit({
          maxZoom: (presenting ? FIT_PRESENT : FIT).maxZoom,
          margin: presenting ? 64 : 40,
          insets: live ? { bottom: LIVE_BAR_SPACE } : undefined,
          duration: 350,
        }),
      80,
    );
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refit on mode changes only
  }, [presenting, live, fitView]);
  // First fit once every node is measured (React Flow's own fit can't see the overlays).
  const nodesReady = useNodesInitialized();
  const firstFit = useRef(false);
  useEffect(() => {
    if (!nodesReady || firstFit.current) return;
    firstFit.current = true;
    overlayFit({ maxZoom: (presenting ? FIT_PRESENT : FIT).maxZoom, margin: presenting ? 64 : 40 });
  }, [nodesReady, overlayFit, presenting]);
  // The title card folds to a chip while nodes sit under it, so it never hides the diagram.
  const card = useRef<HTMLDivElement>(null);
  const cardCovers = useCovered(card, wrapper);
  useOverlayTestIds(wrapper);

  // Your own diagrams have no "original" worth going back to: the edits are the diagram (and undo
  // covers mistakes). Examples and shared diagrams keep "Edited, reset".
  const ownDiagram = isLibrarySlug(slug) || slug === DRAFT_SLUG;
  /** Reset is a normal (undoable) edit. */
  const reset = () => {
    const f = toFlow(original);
    setMeta(f.meta);
    setNodes(f.nodes);
    setEdges(f.edges);
    setTimeout(() => overlayFit({ maxZoom: FIT.maxZoom, duration: 350 }), 50);
  };

  // New edges float (sides picked from geometry); pin a side from the menu or inspector.
  const onConnect = useCallback((c: Connection) => void editor.connect(c.source, c.target), [editor]);
  const isValidConnection: IsValidConnection<DiagramFlowEdge> = useCallback((c) => c.source !== c.target, []);

  const onEdgeDoubleClick: EdgeMouseHandler<DiagramFlowEdge> = useCallback(
    (_e, edge) => setEditing({ kind: "edge", id: edge.id }),
    [],
  );

  // Groups aren't React Flow parents, so carry their member nodes along manually.
  const dragOrigin = useRef<{ x: number; y: number; members: Map<string, { x: number; y: number }> } | null>(null);
  const onNodeDragStart: OnNodeDrag<FlowNode> = useCallback(
    (_e, node) => {
      setMenu(null);
      hideTip();
      if (node.type !== "boundary") return;
      const members = new Map<string, { x: number; y: number }>();
      for (const n of nodes)
        if (n.type === "diagram" && n.data.group === node.data.groupId) members.set(n.id, { ...n.position });
      dragOrigin.current = { x: node.position.x, y: node.position.y, members };
    },
    [nodes, hideTip],
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
      const full: ActionContext = {
        ...ctx,
        editor,
        mode: live ? "live" : "edit",
        point: screenToFlowPosition({ x: e.clientX, y: e.clientY }),
      };
      const items = actionRegistry.build(full);
      setEditing(null);
      hideTip();
      if (!hintSeen) dismissHint();
      setMenu(items.length ? { x: e.clientX, y: e.clientY, items, label: `${ctx.target} menu` } : null);
    },
    [editor, screenToFlowPosition, readOnly, live, hideTip, hintSeen, dismissHint],
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
      if (isAnnotationNode(node)) {
        editor.select({ nodeIds: [node.id] });
        return openMenu(e, { target: "annotation", nodeId: node.id, selection: { ...EMPTY, nodeIds: [node.id] } });
      }
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
  const onEdgeContextMenu: EdgeMouseHandler<DiagramFlowEdge> = useCallback(
    (e, edge) => openEdgeMenu(e, edge.id),
    [openEdgeMenu],
  );

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
    const note = parseAnnotationDrag(e.dataTransfer.getData(ANNOTATION_DND_MIME));
    if (note) {
      e.preventDefault();
      editor.addAnnotation(note.kind, {
        shape: note.shape,
        at: screenToFlowPosition({ x: e.clientX, y: e.clientY }),
        aroundSelection: false,
      });
      return;
    }
    const id = e.dataTransfer.getData(STENCIL_DND_MIME);
    if (!id) return;
    e.preventDefault();
    editor.addNode(id, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  };

  // ---------------------------------------------------------------- derived

  const direction = meta.direction ?? "LR";
  /** Text isn't a routing obstacle: one that grew over a node or edge moves clear (undoable, said so). */
  const settleText = useCallback(
    (id: string, before: XYBox) => {
      // Once the edit (and any growth it caused) has rendered.
      setTimeout(() => {
        const hit = editor.keepTextClear(id, before);
        if (hit)
          notify(`Moved the text off ${hit === "node" ? "a node" : "an edge"}.`, {
            action: { label: "Undo", run: editor.undo, testId: "text-moved-undo" },
          });
      }, 60);
    },
    [editor],
  );
  const ui = useMemo<DiagramUi>(
    () => ({
      direction,
      editing,
      setEditing: readOnly ? () => {} : setEditing,
      openEdgeMenu,
      settleText: readOnly ? undefined : settleText,
    }),
    [direction, editing, openEdgeMenu, readOnly, settleText],
  );
  // Read-only (embed) hides the same chrome as presenting, without the presentation sizing.
  const hideChrome = presenting || readOnly;
  const diagramNodes = useMemo(() => nodes.filter(isDiagramNode), [nodes]);
  const groupNodes = useMemo(() => nodes.filter(isGroupNode), [nodes]);
  const annotationNodes = useMemo(() => nodes.filter(isAnnotationNode), [nodes]);
  const selectedNodes = useMemo(() => diagramNodes.filter((n) => n.selected), [diagramNodes]);
  const selectedAnnotations = useMemo(() => annotationNodes.filter((n) => n.selected), [annotationNodes]);
  const selectedGroups = useMemo(() => groupNodes.filter((n) => n.selected), [groupNodes]);
  const selectedEdges = useMemo(() => edges.filter((e) => e.selected), [edges]);
  const nothingSelected =
    !selectedNodes.length && !selectedGroups.length && !selectedEdges.length && !selectedAnnotations.length;
  const paletteHidden = paletteCollapsed || (live && !openedByHand.palette);
  const inspectorHidden =
    livePanelOpen ||
    !prefs.inspector ||
    ((live || (narrow && nothingSelected) || (cramped && aiDockOpen)) && !openedByHand.inspector);
  // Below ROOMY the inspector opens with a selection and narrows the canvas: keep the selection
  // and its edges in view (a pan, never a zoom), once the pane has its new size.
  const keepSelectionInView = useKeepSelectionInView(wrapper, { style: edgeStyle, direction: meta.direction ?? "LR" });
  // A right-click that selected (and so opened the inspector) waits for its menu to close: moving
  // the view would close the menu under the pointer.
  const inspectorWasHidden = useRef(inspectorHidden);
  const keepPending = useRef(false);
  useEffect(() => {
    const opened = inspectorWasHidden.current && !inspectorHidden;
    inspectorWasHidden.current = inspectorHidden;
    if (opened && !readOnly && !nothingSelected) keepPending.current = true;
    if (inspectorHidden) keepPending.current = false;
    if (!keepPending.current || menu) return;
    const id = requestAnimationFrame(() => {
      keepPending.current = false;
      keepSelectionInView();
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the inspector opens or a menu closes
  }, [inspectorHidden, menu]);
  // A side panel opened or closed while the whole diagram was in view refits it to the new pane,
  // so nothing ends up under the panel or its rail. A view the user panned or zoomed stays put.
  const panelsKey = `${paletteHidden}:${inspectorHidden}`;
  const lastPanels = useRef(panelsKey);
  useEffect(() => {
    if (lastPanels.current === panelsKey) return;
    lastPanels.current = panelsKey;
    if (!showingAll.current || live || presenting || !nothingSelected) return;
    // After React Flow's ResizeObserver has the new pane size.
    const id = setTimeout(() => overlayFit({ maxZoom: FIT.maxZoom, margin: 40, duration: 250 }), 80);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when a side panel opens or closes
  }, [panelsKey]);
  // The Ask AI dock opened, closed or was resized by more than a little: the pane changed size at its
  // right edge. A fit is refitted to the new pane; a view the user panned or zoomed keeps the selection
  // (or, with none, the diagram's centre) in view with a pan.
  const dockKey = `${aiDock.open}:${aiDock.open ? Math.round(aiDock.width / 40) : 0}`;
  const lastDock = useRef(dockKey);
  useEffect(() => {
    if (lastDock.current === dockKey) return;
    lastDock.current = dockKey;
    if (presenting) return;
    // After React Flow's ResizeObserver has the new pane size, and once a drag on the dock's edge settles.
    const id = setTimeout(() => {
      if (showingAll.current) return overlayFit({ maxZoom: FIT.maxZoom, margin: 40, duration: 250 });
      if (keepSelectionInView()) return;
      const pane = wrapper.current?.getBoundingClientRect();
      const nodes = getNodes().filter((n) => !n.hidden);
      if (!pane || !nodes.length) return;
      const b = getNodesBounds(nodes);
      const { x, y, zoom } = getViewport();
      const cx = (b.x + b.width / 2) * zoom + x;
      const cy = (b.y + b.height / 2) * zoom + y;
      if (cx < 40 || cx > pane.width - 40 || cy < 40 || cy > pane.height - 40)
        void setCenter(b.x + b.width / 2, b.y + b.height / 2, { zoom, duration: motionMs(250) });
    }, 150);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the dock changes the pane
  }, [dockKey]);
  // Stable, so the memoized stencil rail skips the canvas's frequent renders (drag, select, zoom).
  const togglePalette = useCallback(() => {
    setPaletteCollapsed(!paletteHidden);
    setOpenedByHand((o) => ({ ...o, palette: paletteHidden }));
  }, [paletteHidden]);
  const addFromPalette = useCallback((id: string) => void editor.addNode(id), [editor]);
  const annotateFromPalette = useCallback(
    (kind: AnnotationKind, shape?: AnnotationShape) => void editor.addAnnotation(kind, { shape }),
    [editor],
  );
  const labels = useMemo(
    () =>
      new Map([
        ...annotationNodes.map((n): [string, string] => [n.id, annotationTitle(n.data)]),
        ...diagramNodes.map((n): [string, string] => [n.id, n.data.label || n.id]),
      ]),
    [diagramNodes, annotationNodes],
  );
  // Accessible names follow renames (React Flow names focusable nodes / edges from ariaLabel), and a
  // card being edited inline draws above everything else (its editor hangs below the card).
  const ariaNodes = useMemo(() => withEditingOnTop(withNodeAria(nodes), editing), [nodes, editing]);
  const showDependencies = useShowDependencies();
  useEffect(
    () =>
      dependencyVisibility.subscribe(() => {
        if (dependencyVisibility.get()) return;
        if (document.activeElement?.closest('[data-dependency="true"]')) wrapper.current?.focus();
        setEdges((es) => es.map((e) => (e.selected && isDependency(e.data) ? { ...e, selected: false } : e)));
      }),
    [setEdges],
  );
  const ariaEdges = useMemo(
    () =>
      projectDependencies(
        withEdgeAria(edges, (id) => labels.get(id) ?? id),
        showDependencies,
      ),
    [edges, labels, showDependencies],
  );
  const nodeCount = diagramNodes.length;
  /** Anything drawn: an annotations-only canvas isn't "empty", though there's nothing to simulate. */
  const contentCount = nodeCount + annotationNodes.length;
  const undoTitle = `Undo (${formatCombo(shortcutKeys("undo"))})`;
  const redoTitle = `Redo (${formatCombo(shortcutKeys("redo"))})`;

  return (
    <DiagramContext.Provider value={ui}>
      <div
        className={`canvas-view${presenting ? " is-presenting" : ""}${live ? " is-live" : ""}`}
        data-testid="canvas-view"
        onContextMenu={(e) => {
          // The app owns right-click; text fields keep the native menu (spellcheck, paste).
          if (!isEditableTarget(e.target)) e.preventDefault();
        }}
      >
        {!hideChrome && (
          <Palette
            collapsed={paletteHidden}
            onToggle={togglePalette}
            onAdd={addFromPalette}
            onAnnotate={annotateFromPalette}
          />
        )}
        <div
          className="canvas-wrap"
          data-testid="canvas-wrap"
          tabIndex={-1}
          ref={wrapper}
          onPointerMove={(e) => (pointer.current = { x: e.clientX, y: e.clientY })}
          onPointerLeave={() => (pointer.current = null)}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(STENCIL_DND_MIME) || e.dataTransfer.types.includes(ANNOTATION_DND_MIME)) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }
          }}
          onDrop={onDrop}
        >
          <EdgeMarkers />
          <ReactFlow<FlowNode, DiagramFlowEdge>
            nodes={ariaNodes}
            edges={ariaEdges}
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
            onMoveStart={(e) => {
              setMenu(null);
              hideTip();
              // A pan or zoom by hand (an event), or by a command such as Shift+0 (no event, and not
              // our own fit starting), means the view is the user's now, not a fit.
              if (e || performance.now() - fitAt.current > FIT_MOVE_MS) showingAll.current = false;
            }}
            onNodeMouseEnter={(e, node) => {
              if (node.type === "diagram" && !editing)
                showTip(e.currentTarget as Element, {
                  nodeId: node.id,
                  label: node.data.label || node.id,
                  sublabel: node.data.sublabel,
                  stencil: node.data.stencil,
                });
            }}
            onNodeMouseLeave={hideTip}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            colorMode={theme}
            // Bottom-right, lifted above the minimap (canvas.css): never under the live bar or the hint.
            attributionPosition="bottom-right"
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
            connectionLineType={
              edgeStyle === "bezier"
                ? ConnectionLineType.Bezier
                : edgeStyle === "straight"
                  ? ConnectionLineType.Straight
                  : ConnectionLineType.SmoothStep
            }
          >
            {prefs.grid && <Background variant={BackgroundVariant.Dots} gap={20} size={1.3} color="var(--dot)" />}
            {!hideChrome && (
              <Controls
                showInteractive={false}
                showFitView={false}
                position="bottom-left"
                onZoomIn={() => (showingAll.current = false)}
                onZoomOut={() => (showingAll.current = false)}
              >
                {/* Our fit keeps content clear of the title card, minimap and live bar. */}
                <ControlButton
                  onClick={fit}
                  title={`Fit view (${formatCombo(shortcutKeys("fit-view"))})`}
                  aria-label="Fit view"
                  data-testid="fit-view-button"
                >
                  <Icon name="fit" size={14} />
                </ControlButton>
                <ControlButton
                  onClick={editor.undo}
                  disabled={!history.canUndo}
                  title={undoTitle}
                  aria-label="Undo"
                  data-testid="undo-button"
                >
                  <Icon name="undo" size={14} />
                </ControlButton>
                <ControlButton
                  onClick={editor.redo}
                  disabled={!history.canRedo}
                  title={redoTitle}
                  aria-label="Redo"
                  data-testid="redo-button"
                >
                  <Icon name="redo" size={14} />
                </ControlButton>
                <ControlButton
                  onClick={() => setShortcutsOpen(true)}
                  title="Keyboard shortcuts (?)"
                  aria-label="Keyboard shortcuts"
                  data-testid="shortcuts-button"
                >
                  <Icon name="keyboard" size={14} />
                </ControlButton>
              </Controls>
            )}
            {!hideChrome && prefs.minimap && contentCount > 0 && (
              <MiniMap
                position="bottom-right"
                style={{ width: 168, height: 112 }}
                pannable
                zoomable
                nodeBorderRadius={6}
                nodeStrokeWidth={2}
                nodeColor={(n) =>
                  n.type === "boundary"
                    ? "transparent"
                    : n.type === "annotation"
                      ? annotationMinimapFill(n as AnnotationFlowNode)
                      : getStencil((n as DiagramFlowNode).data.stencil).accent
                }
                nodeStrokeColor={(n) =>
                  n.type === "boundary"
                    ? toneColor[(n as GroupFlowNode).data.tone]
                    : n.type === "annotation" && (n as AnnotationFlowNode).data.kind !== "note"
                      ? ANNOTATION_COLORS[annotationColor((n as AnnotationFlowNode).data)].hex
                      : "transparent"
                }
              />
            )}
            {/* Nothing to simulate on a blank canvas: the Live toggle appears with the first node. */}
            {(nodeCount > 0 || live) && (
              <LiveView
                readOnly={readOnly}
                editor={readOnly ? undefined : editor}
                diagram={readOnly ? fromFlow(meta, nodes, edges) : undefined}
                presenting={presenting}
                simulations={meta.simulations}
                onLiveChange={onLiveChange}
                onPanelChange={setLivePanelOpen}
                onSaveDiagram={
                  readOnly
                    ? undefined
                    : (diagram) => {
                        const mod = JSON.stringify(diagram) !== originalJson;
                        writeAutosave(slug, mod ? diagram : null, identity);
                        setModified(mod);
                      }
                }
              />
            )}
          </ReactFlow>

          <div
            ref={card}
            className={`diagram-card${presenting ? " is-large" : ""}${cardCovers ? " is-compact" : ""}`}
            data-testid="diagram-card"
            data-canvas-overlay
            data-collapsed={cardCovers ? "1" : undefined}
            // A blank, untitled diagram is already named in the picker: the card waits for the first node.
            hidden={nodeCount === 0 && !presenting && (meta.title || UNTITLED) === UNTITLED && !meta.description}
          >
            <h1 data-testid="diagram-title">{meta.title}</h1>
            {meta.description && <p>{meta.description}</p>}
            {/* Node and edge counts live in the inspector's diagram panel, not here too. */}
            {!hideChrome && modified && !ownDiagram && (
              <div className="diagram-card-meta">
                <button
                  className="link-btn"
                  onClick={reset}
                  data-testid="reset-diagram"
                  title="Discard your edits to this diagram (undoable)"
                >
                  <Icon name="reset" size={13} /> Edited, reset
                </button>
              </div>
            )}
          </div>

          {presenting && (
            <button className="present-exit" onClick={onExitPresent} data-testid="present-exit">
              <Icon name="close" size={14} /> Exit presentation <kbd>Esc</kbd>
            </button>
          )}

          {contentCount === 0 && !hideChrome && !live && start && !startDismissed ? (
            <StartCard
              start={start}
              onBlank={() => {
                setStartDismissed(true);
                // A blank canvas starts from the stencil list: open it and put the cursor in its search.
                setPaletteCollapsed(false);
                setOpenedByHand((o) => ({ ...o, palette: true }));
                requestAnimationFrame(() =>
                  wrapper.current?.parentElement
                    ?.querySelector<HTMLInputElement>('[data-testid="palette-search"]')
                    ?.focus(),
                );
              }}
            />
          ) : (
            contentCount === 0 &&
            !hideChrome && (
              <div className="canvas-empty" data-testid="canvas-empty">
                <strong>This diagram is empty</strong>
                <span>
                  {paletteHidden
                    ? "Double-click the canvas to add a node, or open the stencil panel on the left."
                    : "Drag a stencil from the left, or double-click the canvas to add one."}
                </span>
              </div>
            )
          )}

          {nodeCount > 0 && !hideChrome && !live && !hintSeen && (
            <FirstRunHint simulations={meta.simulations?.length ?? 0} onDismiss={dismissHint} />
          )}
        </div>
        {!hideChrome && (
          <Inspector
            editor={editor}
            meta={meta}
            selectedNodes={selectedNodes}
            selectedGroups={selectedGroups}
            selectedEdges={selectedEdges}
            selectedAnnotations={selectedAnnotations}
            groups={groupNodes}
            nodeLabel={(id) => labels.get(id) ?? id}
            counts={{ nodes: nodeCount, edges: edges.length, groups: groupNodes.length }}
            collapsed={inspectorHidden}
            onTextSettled={settleText}
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
      {nodeTip && !menu && <NodeTooltip tip={nodeTip} />}
    </DiagramContext.Provider>
  );
}
