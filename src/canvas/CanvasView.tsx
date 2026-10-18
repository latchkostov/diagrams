import {
  useCanvasNaming,
  usePlacementSettling,
  useAddFromPalette,
  useAnnotateFromPalette,
} from "./placement/useCanvasEditCommands";
import { isAnnotationNode, isDiagramNode, isGroupNode } from "./types";
import { useBoxSelection } from "./selection/useBoxSelection";
import { useCanvasNavigation, useSelectionSummary, usePanKeys } from "./selection/useCanvasNavigation";
import { useSettledSelection } from "./selection/useSettledSelection";
import { CanvasControls, CanvasMinimap, DotGrid, ZoomVar } from "./chrome/CanvasControls";
import { CanvasOverlays, useChromeHint, useChromeOverlays } from "./chrome/CanvasOverlays";
import {
  useAutosave,
  useDocumentHandle,
  useDocumentLoad,
  useDocumentSave,
  type CanvasHandle,
} from "./document/useCanvasDocument";
import { useCaptionContrast } from "./useCaptionContrast";
import { ConnectedQuickAddMenu } from "./ConnectedQuickAddMenu";
import { connectedMenuPlacement, type ConnectedMenuAnchor } from "./geometry/connectedMenuPlacement";
import { dependencyVisibility } from "./dependencyVisibility";
import { edgeMarks } from "./edgeMarks";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type Ref,
} from "react";
import {
  ConnectionLineType,
  ConnectionMode,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useStoreApi,
  type Connection,
  type EdgeChange,
  type EdgeMouseHandler,
  type NodeChange,
  type NodeMouseHandler,
  type NodeTypes,
  type EdgeTypes,
  type OnConnectEnd,
  type OnConnectStart,
  type OnNodeDrag,
  type IsValidConnection,
} from "@xyflow/react";
import { useSettings } from "../harness/settings";
import { getNodeVariant } from "../harness/nodeVariants";
import { DRAFT_SLUG, getDiagramIdentity, isLibrarySlug, setDiagramPrivate, setOnDeviceAllowed } from "../lib/diagramIO";
import { privacyOf } from "../lib/localOnly";
import { usePrivacyFlags } from "../lib/usePrivacy";
import type { DiagramFile } from "../model/types";
import { memberBoxes } from "./memberBoxes";
import { expandGroupIds } from "../model/groupHierarchy";
import { fromFlow, toFlow, type DiagramMeta } from "./convert";
import { previewMembership, type GroupRect, type MemberBox } from "./membership";
import { DiagramContext, type DiagramUi, type InlineEdit, type RenameTarget } from "./DiagramContext";
import { canvasNodeTypes } from "./nodes/nodeTypes";
import { ANNOTATION_DND_MIME, resolveAnnotationColor, annotationTitle, parseAnnotationDrag } from "./annotations";
import { EdgeMarkers, FlowEdge } from "./edges/FlowEdge";
import { Palette, STENCIL_DND_MIME } from "./Palette";
import { Inspector } from "./Inspector";
import { ContextMenu } from "../components/ContextMenu";
import { ShortcutsDialog } from "../components/ShortcutsDialog";
import { actionRegistry, type ActionContext, type MenuNode } from "../editor/actions";
import { builtinActions, quickAddMenu } from "../editor/builtinActions";
import { useEditorPrefs } from "../editor/prefs";
import { useHistory, type CanvasSnapshot } from "../editor/useHistory";
import type { FlowSelection } from "../editor/historySelection";
import { useEditor } from "../editor/useEditor";
import { useCanvasShortcuts, type NavStep } from "../editor/useCanvasShortcuts";
import { isEditableTarget } from "../editor/shortcuts";
import type { Selection } from "../editor/types";
import type { AnnotationFlowNode, DiagramFlowEdge, DiagramFlowNode, FlowNode } from "./types";

import { LiveView, type LiveHandle, type LiveViewProps } from "../live/LiveView";
import { CanvasFitContext } from "./canvasFit";
import { safeStorage } from "../lib/storage";
import type { StartOptions } from "./StartCard";
import { useAiDock } from "../ai/ui/dock";
import { NodeTipLayer } from "./NodeTooltip";
import { useNodeTipKeyboard, useNodeTooltip } from "./useNodeTooltip";
import { notify, toast } from "../interop/ui/toast";
import { useCanvasHost } from "../palette/canvasHost";
import { useNoCanvasTextSelection } from "./useNoCanvasTextSelection";
import { getRecentStencils, pushRecentStencil } from "../lib/recentStencils";
import { connectHitAt, connectOver, connectTarget } from "./gestures";
import { ConnectionLine } from "./ConnectionLine";

import { useSmartGuides } from "./useSmartGuides";
import { GROUP_PREFIX } from "./types";
import { towardOf, type Toward } from "./placement";
import { insertLine, landing } from "./landing";
import { LandingOutline } from "./LandingOutline";
import { edgeHover, nearestEdge, type EdgeHover } from "./edgeHover";
import { selectRoutes } from "./edges/useEdgeRoute";
import { isConnectable } from "./annotations";
import { railAnchor } from "./railAnchor";
import { checksPanel, useChecksPanel } from "./checks/checksPanel";
import { useChecks } from "./checks/useChecks";
import { ChecksMarkersView, SelectionFindings } from "./checks/ChecksViews";
import { t as tr, useLocale } from "../i18n";
import { CopyNotice } from "./CopyNotice";
import {
  CameraContext,
  FIT,
  FIT_PRESENT,
  panForConnectedMenu,
  useCameraCore,
  useModeFit,
  useMoveHandlers,
  usePaneCamera,
  useRevealIds,
  useRevealSelection,
} from "./camera";
import type { EditorRoom } from "../editor/room";
import { remoteTargetRemoved } from "../editor/remoteSnapshot";

const nodeTypes: NodeTypes = canvasNodeTypes;
const edgeTypes: EdgeTypes = { flow: FlowEdge };

/** Editing: Shift+click and Ctrl/Cmd+click both toggle an item in the selection, as in other tools. */
const MULTI_SELECT_KEYS = ["Shift", "Control", "Meta"];
/** Editing: a plain drag on empty canvas draws the selection box, so only the middle button pans. */
const PAN_MIDDLE = [1];
/**
 * React Flow copies a prop that changes identity into its store, and a node handler that does re-renders every node's
 * wrapper: everything handed to <ReactFlow> keeps its identity across the canvas's renders.
 */
const SNAP_GRID: [number, number] = [10, 10];
const PALETTE_KEY = "diagrams.paletteCollapsed.v1";
/** Below this width the inspector waits for a selection: two open side panels leave too little canvas. */
const ROOMY = 1680;
const CRAMPED = 1280;

export type { CanvasHandle } from "./document/useCanvasDocument";

interface Props {
  /** Lab-only room mount, with its own document identity and encrypted recovery. Stable for this canvas's life. */
  room?: EditorRoom;
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
  onExampleCopy?: (source: string, copy: string, title: string) => void;
  copyNotice?: string;
  /** A gallery selection hands keyboard focus to this canvas once it is ready. */
  focusRequest?: number;
  /** The exported HTML viewer (src/export/viewer): read-only, plus the options below. */
  viewer?: CanvasViewerOptions;
}

/** What the exported HTML viewer adds to a read-only canvas. */
export interface CanvasViewerOptions {
  /** Live view is offered (the Live toggle), starting as given: a simulation playing, or off. */
  live: NonNullable<LiveViewProps["initial"]>;
  /** The wheel pans and Ctrl+wheel zooms, as in the app (a page of its own, not a frame in someone's page). */
  wheel: boolean;
  /**
   * Its own controls, rendered inside the canvas, so they can use React Flow's hooks and the canvas's own
   * overlay-aware Fit view (useCanvasFit).
   */
  controls?: ReactNode;
  /** Told how to drive live view from outside (the host-supplied embed's play, pause, speed and simulation). */
  onLive?: (handle: LiveHandle) => void;
}

export function CanvasView(props: Props) {
  useLocale();
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

const EMPTY: Selection = { nodeIds: [], edgeIds: [], groupIds: [] };

type MenuState = {
  connected?: ConnectedMenuAnchor;
  x: number;
  y: number;
  flipX?: number;
  items: () => MenuNode[];
  alignment?: "physical-left";
  label: string;
  searchable?: string;
  testId?: string;
};
/** About how wide quick-add is (its CSS keeps it 224–320 px): room kept for it beside the outline. */
const QUICK_ADD_W = 300;

// Built-in actions live for the app's lifetime; HMR re-registers them by id.
actionRegistry.register(builtinActions());

function CanvasInner({
  slug,
  presenting,
  onExitPresent,
  ref,
  readOnly = false,
  initial,
  start,
  onTitleChange,
  onExampleCopy,
  copyNotice,
  focusRequest,
  viewer,
  room,
}: Props) {
  const locale = useLocale();
  const { theme, nodeVariant, edgeStyle } = useSettings();
  const { screenToFlowPosition, getNode, getNodes } = useReactFlow<FlowNode, DiagramFlowEdge>();
  const store = useStoreApi<FlowNode, DiagramFlowEdge>();
  const wrapper = useRef<HTMLDivElement>(null);
  useNoCanvasTextSelection(wrapper);
  /** The pointer over the canvas (client coords), for "T adds text here" and Ctrl+V. */
  const pointer = useRef<{ x: number; y: number } | null>(null);
  /** The node under the pointer (Shift+2 with nothing selected zooms to it). */
  const hovered = useRef<string | undefined>(undefined);

  const { original, flow, originalJson, loadedJson, identity } = useDocumentLoad(initial, slug);
  const [meta, setMeta] = useState<DiagramMeta>(flow.meta);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(flow.nodes);
  useCaptionContrast(wrapper, nodes, theme, meta.color);
  const [edges, setEdges, onEdgesChange] = useEdgesState<DiagramFlowEdge>(flow.edges);
  const [modified, setModified] = useState(loadedJson !== originalJson);
  const [bootstrapFit] = useState(() => flow.nodes.some((n) => !n.hidden));
  const [paletteCollapsed, setPaletteCollapsed] = useState(() => {
    const saved = safeStorage.getItem(PALETTE_KEY);
    // Narrow windows always start with the canvas, not the stencil list.
    return saved && window.innerWidth >= 1280 ? saved === "1" : window.innerWidth < 1400;
  });
  useEffect(() => void safeStorage.setItem(PALETTE_KEY, paletteCollapsed ? "1" : "0"), [paletteCollapsed]);
  const [prefs, setPref] = useEditorPrefs();
  const [sheetResize, setSheetResize] = useState(0);
  // Live mode and narrow windows fold the side panels away by default; opening one by hand wins.
  const [live, setLive] = useState(false);
  const [livePanelOpen, setLivePanelOpen] = useState(false);
  const canOpenInspector = !readOnly && !presenting && !viewer;
  const liveHandle = useRef<LiveHandle | null>(null);
  const onViewerLive = viewer?.onLive;
  const receiveLiveHandle = useCallback(
    (handle: LiveHandle) => {
      liveHandle.current = handle;
      onViewerLive?.(handle);
    },
    [onViewerLive],
  );
  const [openedByHand, setOpenedByHand] = useState({ live, palette: false, inspector: false });
  if (openedByHand.live !== live) setOpenedByHand({ live, palette: false, inspector: false });
  const [narrow, setNarrow] = useState(() => window.innerWidth < ROOMY);
  // Below CRAMPED, an open AI panel keeps the inspector folded to its rail until opened by hand.
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
  const [editing, setEditing] = useState<InlineEdit | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- factories resolve translated metadata from the locale store
  const menuItems = useMemo(() => menu?.items() ?? [], [menu, locale]);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [inspectorFocus, setInspectorFocus] = useState<
    { name: string; seq: number; caret?: "end"; target?: string } | undefined
  >();
  const inspectorFocusDone = useRef(0);
  const takeInspectorFocus = useCallback((seq: number) => {
    if (inspectorFocusDone.current === seq) return false;
    inspectorFocusDone.current = seq;
    setInspectorFocus((f) => (f?.seq === seq && f.name === "autoscaling-upgrade-preview" ? { ...f, name: "" } : f));
    return true;
  }, []);
  const [inspectorRequest, requestInspector] = useState(0);
  const openInspector = useCallback(
    (field?: string, caret?: "end", target?: string) => {
      requestInspector((revision) => revision + 1);
      liveHandle.current?.session?.closePanel();
      setPref("inspector", true);
      setOpenedByHand((o) => ({ ...o, inspector: true }));
      if (field) setInspectorFocus((f) => ({ name: field, seq: (f?.seq ?? 0) + 1, caret, target }));
    },
    [setPref],
  );
  /** A node just made connected, while it's being named: the inspector names its connection too. */
  const [naming, setNaming] = useState<{ node: string; edge: string } | null>(null);
  /** Names a node, connection or boundary in the inspector (set below, once the editor exists). */
  const rename = useRef<(t: RenameTarget) => void>(() => {});
  const { startDismissed, setStartDismissed, hintSeen, dismissHint } = useChromeHint(readOnly);
  // Going live counts as having found the live view (so the first-run hint retires).
  const onLiveChange = useCallback(
    (on: boolean) => {
      setLive(on);
      if (on) {
        setEditing(null);
        dismissHint();
      }
    },
    [dismissHint],
  );
  const tipsEnabled = !live && !readOnly && !presenting && !editing;
  const { tips: nodeTips, show: showTip, hide: hideTip } = useNodeTooltip(tipsEnabled);
  useNodeTipKeyboard(
    wrapper,
    (id) => {
      const n = nodes.find((x) => x.id === id);
      return n?.type === "diagram"
        ? { nodeId: n.id, label: n.data.label || n.id, sublabel: n.data.sublabel, stencil: n.data.stencil }
        : null;
    },
    showTip,
    hideTip,
  );

  const [announcement, setAnnouncement] = useState({ text: "", seq: 0 });
  const remoteFocusFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(remoteFocusFrame.current), []);
  const snapshot = useMemo<CanvasSnapshot>(() => ({ meta, nodes, edges }), [meta, nodes, edges]);
  const libraryPrivacy = usePrivacyFlags(slug);
  const [roomPrivate, setRoomPrivate] = useState(false);
  const privacyFlags = useMemo(
    () => ({ ...libraryPrivacy, private: libraryPrivacy.private || roomPrivate }),
    [libraryPrivacy, roomPrivate],
  );
  /** Undo and Redo chose a selection: keyboard focus follows it (set up with the keyboard selection, below). */
  const onHistoryStep = useRef((_direction: "undo" | "redo", _selection: FlowSelection) => {});
  const history = useHistory(
    snapshot,
    (s, remote) => {
      const active = document.activeElement;
      const root = wrapper.current?.closest('[data-testid="canvas-view"]');
      const originatedHere = remote && active && root?.contains(active);
      const removed =
        originatedHere &&
        remoteTargetRemoved(snapshot, s, {
          inspector: !!active.closest('[data-testid="inspector"]'),
          id:
            active.closest("[data-id]")?.getAttribute("data-id") ??
            active.closest('[data-testid="inspector"]')?.getAttribute("data-inspector-target") ??
            undefined,
        });
      if (originatedHere) {
        cancelAnimationFrame(remoteFocusFrame.current);
        remoteFocusFrame.current = requestAnimationFrame(() => {
          if (active.isConnected || (document.activeElement !== document.body && document.activeElement !== null))
            return;
          wrapper.current?.focus({ preventScroll: true });
          setAnnouncement((a) => ({
            text: removed ? tr("collab.targetRemoved") : tr("collab.controlRemoved"),
            seq: a.seq + 1,
          }));
        });
      }
      if (!remote) setEditing(null);
      else setEditing((current) => (current && !s.nodes.some((n) => n.id === current.id) ? null : current));
      setMeta(s.meta);
      setNodes(s.nodes);
      setEdges(s.edges);
    },
    (direction, selection) => onHistoryStep.current(direction, selection),
    room,
    privacyFlags,
  );
  const { beginGesture, endGesture } = history;

  const { latest, exampleCopyFailed, flushSave } = useDocumentSave({
    meta,
    nodes,
    edges,
    slug,
    saveRevision: history.stateKey,
    loadedJson,
    originalJson,
    onExampleCopy,
    readOnly,
    room,
    identity,
    renameHistoryTitle: history.renameTitle,
    original,
    setMeta,
  });
  const firstExampleEdit = onExampleCopy !== undefined;
  const saveRevision = history.stateKey;

  const {
    whenReady,
    openingFitDone,
    camera,
    controller,
    interruptFit,
    fit,
    reset: resetView,
    zoom100,
    zoomToSelection,
    zoomedByButton,
    dragStarted,
  } = useCameraCore(wrapper, nodes, edges, `${theme}:${nodeVariant}:${locale}`, {
    style: edgeStyle,
    direction: meta.direction ?? "LR",
  });
  // Privacy: the diagram's provenance (Private switch, local-only example), re-read when the library changes.
  const privacyNow = () => privacyOf({ ...privacyFlags, editor: { getDiagram: () => fromFlow(meta, nodes, edges) } });
  const documentId = getDiagramIdentity(slug);
  const editor = useEditor({
    newId: room ? (base) => room.newId(base) : undefined,
    getNodes: () => nodes,
    getEdges: () => edges,
    slug,
    isPrivate: () => privacyNow() !== null,
    documentKey: history.stateKey,
    documentId,
    makePrivate: () => {
      if (room || setDiagramPrivate(slug, true)) {
        if (room) setRoomPrivate(true);
        notify(tr("chrome.pastedFromAPrivateDiagramSoThisOneIsPrivate"), {
          kind: "info",
        });
        return true;
      }
      notify(tr("chrome.thatCameFromAPrivateDiagramPasteItIntoOne"), {
        kind: "error",
      });
      return false;
    },
    meta,
    setMeta,
    setNodes,
    setEdges,
    // An Undo toast offers to reverse one change: once anything else undoes or redoes, it would reverse another.
    history: {
      ...history,
      undo: () => {
        toast.dismissUndo();
        history.undo();
      },
      redo: () => {
        toast.dismissUndo();
        history.redo();
      },
    },
    prefs,
    setPref,
    setEditing: (target) => {
      if (!readOnly && !live && !presenting) setEditing(target);
    },
    rename: (t) => rename.current(t),
    openInspector,
    showShortcuts: () => setShortcutsOpen(true),
    viewCenter: () => {
      const r = wrapper.current?.getBoundingClientRect();
      return r ? screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) : { x: 0, y: 0 };
    },
    pointer: () => (pointer.current ? screenToFlowPosition(pointer.current) : undefined),
    edgeMarks: () => edgeMarks(wrapper.current),
    fit,
    zoom100,
    afterMeasured: whenReady,
    nodeSize: getNodeVariant(nodeVariant).size,
    zoomTo: zoomToSelection,
    hovered: () => hovered.current,
    reveal: () => revealSelection(),
    nameNew: (make, fallback) => nameNew.current(make, fallback),
    flushSave: (diagram) => {
      const mod = flushSave(diagram);
      if (mod !== undefined) setModified(mod);
    },
  });

  /** Alt+arrow and Alt+Shift+arrow (set below, once the flows they open are defined). */
  const grow = useRef<(from: string, toward: Toward, clone: boolean) => void>(() => {});
  /** Tab, Shift+Tab, Ctrl+Alt+arrows and Ctrl+Alt+] / [ (set below). */
  const navigate = useRef<(step: NavStep, from: EventTarget | null) => boolean>(() => false);
  /**
   * The node a step just went to, until the frame that focuses it: a second Tab in the same frame (two presses
   * queued behind a busy moment) goes on from there, not from the node the key event still targets.
   */
  const stepping = useRef<string | undefined>(undefined);
  /** Stops Run simulations, if it's playing (set once the checks are, below): true if it was. */
  const stopSimulations = useRef<() => boolean>(() => false);
  useCanvasShortcuts(editor, {
    enabled: !shortcutsOpen && !readOnly,
    canRename: canOpenInspector,
    canRenameEnter: () => !liveHandle.current?.session?.controller.getState().run?.waiting,
    onEscape: () => {
      // Esc backs out one level: a menu, the selection, then simulations playing, then the Checks card.
      const sel = editor.getSelection();
      // Inside the card, the card handles Esc itself (a finding's options first, then the card).
      const inCard = !!document.activeElement?.closest('[data-testid="checks-card"]');
      if (
        !inCard &&
        !menuOpen.current &&
        checksPanel.isOpen() &&
        !sel.nodeIds.length &&
        !sel.edgeIds.length &&
        !sel.groupIds.length &&
        !stopSimulations.current()
      )
        checksPanel.close();
      setMenu(null);
    },
    live,
    onGrow: (from, toward, clone) => grow.current(from, toward, clone),
    onNavigate: (step, from) => navigate.current(step, from),
  });
  // The command palette (Ctrl/Cmd+K) acts on this canvas while it's mounted and editable.
  const hostRevision = useMemo(() => ({ nodes, edges, meta }), [nodes, edges, meta]);
  const readInspectorDiagram = useCallback(() => fromFlow(meta, nodes, edges), [meta, nodes, edges]);

  // ---------------------------------------------------------------- architecture checks
  // They run after edits pause, in idle time, off the main thread (checks/useChecks.ts). Editing only: no count
  // and no card in live view, presenting, an embed or the exported HTML viewer (read-only, and its build stubs the
  // checks out: scripts/interactive-viewer.ts). Private diagrams are checked like any other (it's local).
  const checksOn = !readOnly && !viewer && !presenting && !live;
  useEffect(() => {
    checksPanel.setAvailable(checksOn);
    return () => checksPanel.setAvailable(false);
  }, [checksOn]);
  const checksCard = useChecksPanel().open;
  const checks = useChecks({
    enabled: checksOn,
    revision: hostRevision,
    read: () => editor.getDiagram(),
    nodeCount: nodes.length,
    cardOpen: checksCard,
    content: hostRevision,
  });
  useEffect(() => {
    stopSimulations.current = checks.stopSimulations;
  }, [checks]);
  const menuOpen = useRef(false);
  useEffect(() => {
    menuOpen.current = !!menu;
  });
  const allowOnDevice = useCallback((on: boolean) => void setOnDeviceAllowed(slug, on), [slug]);
  // Only development builds read content for privacy (privacyOf); production reads provenance alone.
  const privacy = privacyOf({
    ...privacyFlags,
    ...(import.meta.env.DEV ? { diagram: fromFlow(meta, nodes, edges) } : {}),
  });
  useCanvasHost(editor, {
    live,
    enabled: !readOnly,
    localOnly: privacy === "local-only",
    private: !!privacyFlags.private,
    onDevice: !!privacyFlags.onDevice,
    allowOnDevice,
    documentId,
    revision: hostRevision,
    goTo: controller.goTo,
  });

  useAutosave({
    saveRevision,
    readOnly,
    flushSave,
    firstExampleEdit,
    exampleCopyFailed,
    latest,
    conversationIdentity: initial ? undefined : documentId,
    setModified,
  });

  useDocumentHandle({ ref, meta, nodes, edges, flushSave, editor, room, privacy, setModified, onTitleChange });

  useEffect(() => {
    if (focusRequest === undefined) return;
    // Dialog teardown first restores its opener; move to the destination after that cleanup.
    const frame = requestAnimationFrame(() => wrapper.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [focusRequest]);

  // Presenting hides the button that started it: focus goes to the canvas, not the page, so the keys (Esc, L,
  // Space) and the next Tab start from there.
  useEffect(() => {
    if (!presenting) return;
    const el = document.activeElement;
    if (!el || el === document.body || !el.isConnected) wrapper.current?.focus({ preventScroll: true });
  }, [presenting]);

  useModeFit(controller, presenting, live);
  const { card, cardCovers, checksTop } = useChromeOverlays(wrapper, checksOn && checksCard);

  // Your own diagrams have no "original" worth going back to: the edits are the diagram (and undo
  // covers mistakes). Examples and shared diagrams keep "Edited, reset".
  const ownDiagram = isLibrarySlug(slug) || slug === DRAFT_SLUG;
  /** Reset is a normal (undoable) edit. */
  const reset = () => {
    const f = toFlow(original);
    setMeta(f.meta);
    setNodes(f.nodes);
    setEdges(f.edges);
    resetView();
  };

  // Editing gestures (D4, D5): a drag on empty canvas draws the selection box, the wheel pans, and
  // Space+drag or the middle button pan. Live view, presentation and embeds keep drag-to-pan.
  const editGestures = !readOnly && !live && !presenting;
  // Live's property sheet remains editable; its other gesture gates stay separate.

  // New edges float (sides picked from geometry); pin a side from the menu or inspector.
  const onConnect = useCallback((c: Connection) => void editor.connect(c.source, c.target), [editor]);
  const isValidConnection: IsValidConnection<DiagramFlowEdge> = useCallback((c) => c.source !== c.target, []);

  const { revealSelection } = useRevealSelection(controller);

  const { renameIn, pickNamed, nameNew } = useCanvasNaming({
    canOpenInspector,
    editor,
    openInspector,
    setEditing,
    setNaming,
    rename,
    history,
    controller,
    revealSelection,
  });

  // ---------------------------------------------------------------- the next node (D3)
  // Alt+arrow and the "+" on a selected node: quick-add opens under an outline of where the node will land,
  // and the pick arrives there, connected (→ and ↓ from the node, ← and ↑ into it), ready to name.
  // Alt+Shift+arrow skips the menu: a copy of the node lands there, connected the same way.
  const growTo = useCallback(
    (fromId: string, toward?: Toward) => {
      if (readOnly || live || presenting) return;
      const dir = toward ?? towardOf(meta.direction === "TB" ? "TB" : "LR");
      const spot = editor.nextSpot(fromId, dir);
      const from = getNode(fromId);
      const wrap = wrapper.current;
      if (!spot || !from || !wrap) return;
      hideTip();
      setEditing(null);
      // Quick-add opens beside the outline of where the node will land (left of it when growing left, so it
      // never covers the node it grows from). First the view pans, if it must, to show the node, the outline
      // and the menu's room; the menu opens where the outline will be.
      const [tx, ty, k] = store.getState().transform;
      const r = wrap.getBoundingClientRect();
      const menuLeft = dir === "left";
      const card = {
        x: from.position.x,
        y: from.position.y,
        width: from.measured?.width ?? spot.width,
        height: from.measured?.height ?? spot.height,
      };
      const connected = { spot, card, left: menuLeft, width: QUICK_ADD_W };
      const view = { x: tx, y: ty, zoom: k };
      const next = panForConnectedMenu(controller, connected, view, r);
      const { position } = connectedMenuPlacement(connected, next ?? view, r);
      landing.set(spot);
      setMenu({
        connected,
        alignment: "physical-left",
        ...position,
        get label() {
          return tr("canvas.addAConnectedNode");
        },
        testId: "quick-add",
        get searchable() {
          return tr("canvas.addANode");
        },
        items: () =>
          quickAddMenu((s) => {
            pickNamed(() => editor.createConnected({ from: fromId, stencil: s.id, toward: dir }), s.label);
            pushRecentStencil(s.id);
          }, getRecentStencils()),
      });
    },
    [readOnly, live, presenting, meta.direction, editor, getNode, hideTip, store, controller, pickNamed],
  );
  const cloneTo = useCallback(
    (fromId: string, toward: Toward) => {
      if (readOnly || live || presenting) return;
      setMenu(null);
      hideTip();
      pickNamed(
        () => editor.createConnected({ from: fromId, clone: true, toward }),
        editor.getNode(fromId)?.label ?? "",
      );
    },
    [readOnly, live, presenting, editor, hideTip, pickNamed],
  );
  // The outline goes with its menu.
  useEffect(() => {
    if (!menu) landing.set(null);
  }, [menu]);
  useEffect(() => () => landing.set(null), []);
  const growFromChip = useCallback((id: string) => growTo(id), [growTo]);
  const revealIds = useRevealIds(controller, editor);
  const checksHost = useMemo(
    () => ({
      editor,
      reveal: revealIds,
      choose: growFromChip,
      hover: checks.setHot,
      open: () => checksPanel.open(),
      returnFocus: () => (checksPanel.opener() ?? wrapper.current)?.focus(),
    }),
    [editor, revealIds, growFromChip, checks],
  );
  useLayoutEffect(() => {
    grow.current = (from, toward, clone) => (clone ? cloneTo(from, toward) : growTo(from, toward));
  });

  // ---------------------------------------------------------------- connecting (D1, D2)
  // While a connection is drawn: a crosshair throughout, the node a drop would connect to lit up (a
  // drop anywhere on it connects), not-allowed over things that take no edges, and a "+" at the end
  // of the line over empty canvas, where a drop opens quick-add for the next node.
  const connecting = useRef<{ from: string; over: Element | null; stop: () => void } | null>(null);
  const annotationKindOf = useCallback(
    (id: string) => {
      const n = getNode(id);
      return n?.type === "annotation" ? (n as AnnotationFlowNode).data.kind : undefined;
    },
    [getNode],
  );
  const endConnecting = useCallback(() => {
    const c = connecting.current;
    connecting.current = null;
    c?.stop();
    connectOver.set(null);
  }, []);
  useEffect(() => endConnecting, [endConnecting]);
  const onConnectStart: OnConnectStart = useCallback(
    (_e, { nodeId }) => {
      endConnecting();
      if (!nodeId) return;
      setMenu(null);
      hideTip();
      const wrap = wrapper.current;
      wrap?.classList.add("is-connecting");
      const state = { from: nodeId, over: null as Element | null, stop: () => {} };
      const mark = (el: Element | null, on: boolean) => el?.classList.toggle("is-connect-target", on);
      const onMove = (e: PointerEvent) => {
        const el = e.target instanceof Element ? e.target : null;
        const t = connectTarget(connectHitAt(el, annotationKindOf), nodeId);
        const node = t.kind === "node" ? (el?.closest(".react-flow__node") ?? null) : null;
        if (node !== state.over) {
          mark(state.over, false);
          mark(node, true);
          state.over = node;
        }
        wrap?.classList.toggle("is-connect-invalid", t.kind === "invalid");
        connectOver.set(t.kind);
      };
      document.addEventListener("pointermove", onMove, true);
      state.stop = () => {
        document.removeEventListener("pointermove", onMove, true);
        mark(state.over, false);
        wrap?.classList.remove("is-connecting", "is-connect-invalid");
      };
      connecting.current = state;
    },
    [endConnecting, hideTip, annotationKindOf],
  );
  const onConnectEnd: OnConnectEnd = useCallback(
    (event, state) => {
      const from = connecting.current?.from;
      endConnecting();
      // A drop on a handle (or near one) already connected in onConnect.
      if (!from || state.isValid || readOnly) return;
      const pt = "changedTouches" in event ? event.changedTouches[0] : event;
      if (!pt) return;
      const el = document.elementFromPoint(pt.clientX, pt.clientY);
      const t = connectTarget(connectHitAt(el, annotationKindOf), from);
      if (t.kind === "node") {
        editor.connect(from, t.id);
        return;
      }
      if (t.kind !== "canvas" || live) return;
      // Empty canvas: quick-add there; the pick lands on the drop point, connected, ready to name.
      const point = screenToFlowPosition({ x: pt.clientX, y: pt.clientY });
      setMenu({
        alignment: "physical-left",
        x: pt.clientX,
        y: pt.clientY,
        get label() {
          return tr("canvas.addAConnectedNode");
        },
        testId: "quick-add",
        get searchable() {
          return tr("canvas.addANode");
        },
        items: () =>
          quickAddMenu((s) => {
            pickNamed(() => editor.createConnected({ from, stencil: s.id, at: point }), s.label);
            pushRecentStencil(s.id);
          }, getRecentStencils()),
      });
    },
    [endConnecting, readOnly, annotationKindOf, editor, live, screenToFlowPosition, pickNamed],
  );

  const { contain: containRef, boxBase: boxBaseRef } = useBoxSelection({ editGestures, store, setNodes, setEdges });

  // ---------------------------------------------------------------- Alt-drag duplicates (D9), smart guides (D6)
  /** While an Alt-drag runs: original flow id → its copy. The drag moves the copies; the originals stay. */
  const altCopies = useRef<Map<string, string> | null>(null);
  /** The guides' overlay: one layer over the flow, drawn only during a drag. */
  const guideLayer = useRef<SVGSVGElement>(null);
  const guides = useSmartGuides({
    store,
    snap: prefs.snap,
    guides: editGestures,
    layer: guideLayer,
    apply: onNodesChange,
  });
  const handleNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      if (changes.some((c) => c.type === "dimensions" && c.resizing)) beginGesture();
      if (changes.some((c) => c.type === "dimensions" && c.resizing === false)) {
        // Boundary adoption also runs in this frame; close only after both have rendered.
        requestAnimationFrame(endGesture);
      }
      let next = changes;
      if (store.getState().userSelectionActive) next = next.filter((c) => c.type !== "select");
      const copies = altCopies.current;
      if (copies)
        next = next.map((c) => (c.type === "position" && copies.has(c.id) ? { ...c, id: copies.get(c.id)! } : c));
      // While dragging: snapped to guides, equal gaps or the grid, with boundary members following.
      next = guides.filter(next);
      if (next.length) onNodesChange(next);
    },
    [store, onNodesChange, guides, beginGesture, endGesture],
  );
  const handleEdgesChange = useCallback(
    (changes: EdgeChange<DiagramFlowEdge>[]) => {
      const next = store.getState().userSelectionActive ? changes.filter((c) => c.type !== "select") : changes;
      if (next.length) onEdgesChange(next);
    },
    [store, onEdgesChange],
  );

  const onEdgeDoubleClick: EdgeMouseHandler<DiagramFlowEdge> = useCallback(
    (_e, edge) => rename.current({ kind: "edge", id: edge.id }),
    [],
  );

  // One lifecycle for every drag: a node, a selection (by a node or by its frame) and an Alt-drag. React
  // Flow calls onNodeDragStart / onNodeDragStop for all of them, the selection frame included (it calls
  // onSelectionDragStart as well, which is why that one isn't registered). `dragActive` makes a second
  // start or stop for the same gesture a no-op, so copies are made exactly once.
  const dragActive = useRef(false);
  /**
   * Insert on drop (D8): a single node with no edges, held over an edge for a moment, lights the edge up;
   * dropped there (without Ctrl/Cmd) it goes in between: A→B becomes A→N→B, in the drag's undo step.
   */
  const insertWatch = useRef<{ node: string; hover: EdgeHover; stop: () => void } | null>(null);
  /** Edge hover for an insert, against the routes as drawn now (edges step aside from a node over them). */
  const insertHover = useCallback(() => {
    const s = store.getState();
    const routes = selectRoutes(s, {
      style: edgeStyle,
      direction: meta.direction ?? "LR",
      captions: nodeVariant === "iconOnly",
      hideDependencies: !dependencyVisibility.get(),
    });
    const lines = [...routes].map(([id, r]) => ({ id, points: r.points }));
    return edgeHover(
      // Within 10 px on screen of the line.
      (x, y) => nearestEdge(lines, screenToFlowPosition({ x, y }), 10 / store.getState().transform[2]),
      (id) => wrapper.current?.querySelector(`[data-testid="edge-${CSS.escape(id)}"]`) ?? null,
      undefined,
      // The line it will split, where it ran before the node came over it.
      (id) => insertLine.set(lines.find((l) => l.id === id)?.points ?? null),
    );
  }, [store, edgeStyle, meta.direction, nodeVariant, screenToFlowPosition]);
  const watchInsert = useCallback(
    (nodeId: string) => {
      const hover = insertHover();
      const onMove = (e: PointerEvent) => hover.at(e.clientX, e.clientY, e.ctrlKey || e.metaKey);
      document.addEventListener("pointermove", onMove, true);
      insertWatch.current = {
        node: nodeId,
        hover,
        stop: () => {
          document.removeEventListener("pointermove", onMove, true);
          hover.clear();
        },
      };
    },
    [insertHover],
  );
  useEffect(() => () => insertWatch.current?.stop(), []);
  /**
   * Boundaries that keep up (D12): while nodes are dragged, the boundary that will hold them on drop shows its
   * outline in its tone (`data-membership` "join" or "hold"), and one they'd leave shows dashed ("leave"), as
   * does one that can't grow to hold a member poking out ("blocked"). The node's centre decides. Painted on
   * the boundaries' elements once a frame, so a drag re-renders nothing.
   */
  const membershipWatch = useRef<{ stop: () => void } | null>(null);
  /**
   * The dragged nodes whose membership a drop decides (their copies' ids, for an Alt-drag): all of them but the
   * members of a boundary dragged with them, which it carries.
   */
  const droppedNodes = useCallback(
    (dragged: FlowNode[], copies: Map<string, string> | null) => {
      const carriers = expandGroupIds(
        dragged.filter(isGroupNode).map((g) => g.data.groupId),
        store
          .getState()
          .nodes.filter(isGroupNode)
          .map((g) => ({ id: g.data.groupId, group: g.data.group })),
      );
      const carried = (n: FlowNode) => {
        // An Alt-drag's copy belongs to the copy of its boundary, the original's to the original.
        const g = n.data.group;
        return !!g && carriers.has(g);
      };
      return dragged
        .filter(
          (n): n is DiagramFlowNode | AnnotationFlowNode => (isDiagramNode(n) || isAnnotationNode(n)) && !carried(n),
        )
        .map((n) => copies?.get(n.id) ?? n.id);
    },
    [store],
  );
  const watchMembership = useCallback(
    (dragged: FlowNode[], copies: Map<string, string> | null) => {
      const s = store.getState();
      const ids = droppedNodes(dragged, copies);
      const groupsOf = (ns: readonly FlowNode[]): GroupRect[] =>
        ns.filter(isGroupNode).map((g) => ({
          id: g.data.groupId,
          x: g.position.x,
          y: g.position.y,
          width: g.width ?? g.measured?.width ?? 0,
          height: g.height ?? g.measured?.height ?? 0,
        }));
      const moving = new Set([...ids, ...dragged.map((n) => n.id)]);
      const othersOf = (ns: readonly FlowNode[]): MemberBox[] => memberBoxes(ns.filter((n) => !moving.has(n.id)));
      // Boundaries dragged along (with their members) move under the nodes: read them each frame then. Otherwise
      // the rest holds still, so it's read once.
      const live = dragged.some(isGroupNode);
      let groups = groupsOf(s.nodes);
      let others = othersOf(s.nodes);
      if (!ids.length || !groups.length) return;
      const marked = new Map<string, Element>();
      let frame = 0;
      const paint = () => {
        frame = 0;
        const st = store.getState();
        if (live) {
          groups = groupsOf(st.nodes);
          others = othersOf(st.nodes);
        }
        const now: MemberBox[] = [];
        for (const id of ids) {
          const n = st.nodeLookup.get(id);
          const u = n?.internals.userNode;
          if (!n || !u) continue;
          now.push(...memberBoxes([{ ...u, position: n.internals.positionAbsolute }]));
        }
        const preview = previewMembership(now, groups, others);
        for (const [id, el] of marked)
          if (!preview.has(id)) {
            el.removeAttribute("data-membership");
            marked.delete(id);
          }
        for (const [id, m] of preview) {
          const el =
            marked.get(id) ?? wrapper.current?.querySelector(`[data-testid="group-${CSS.escape(id)}"]`) ?? null;
          if (!el) continue;
          marked.set(id, el);
          if (el.getAttribute("data-membership") !== m) el.setAttribute("data-membership", m);
        }
      };
      const onMove = () => {
        if (!frame) frame = requestAnimationFrame(paint);
      };
      document.addEventListener("pointermove", onMove, true);
      membershipWatch.current = {
        stop: () => {
          document.removeEventListener("pointermove", onMove, true);
          cancelAnimationFrame(frame);
          for (const el of marked.values()) el.removeAttribute("data-membership");
        },
      };
    },
    [store, droppedNodes],
  );
  useEffect(() => () => membershipWatch.current?.stop(), []);
  /** Members dropped outside their boundary left it: say so, with Undo (D12: leaving is never silent). */
  const sayLeft = useCallback(
    (left: Map<string, string[]>) => {
      const [first] = left;
      if (!first) return;
      const [groupId, ids] = first;
      const count = [...left.values()].reduce((n, l) => n + l.length, 0);
      const group = editor.getGroup(groupId)?.label || tr("chrome.itsBoundary");
      const one = count === 1 ? editor.getNode(ids[0])?.label || ids[0] : null;
      const where = left.size > 1 ? tr("chrome.theirBoundaries") : group;
      notify(
        one
          ? tr("chrome.valueLeftValue", { name: one, boundary: where })
          : tr("chrome.valueNodesLeftValueOtherValueNodesLeftValue", { count, boundary: where }),
        {
          action: {
            get label() {
              return tr("ai.undo");
            },
            run: editor.undo,
            testId: "membership-undo",
            undoes: true,
          },
        },
      );
    },
    [editor],
  );
  const onNodeDragStart: OnNodeDrag<FlowNode> = useCallback(
    (e, _node, dragged) => {
      if (dragActive.current) return;
      beginGesture();
      dragActive.current = true;
      dragStarted();
      setMenu(null);
      hideTip();
      const only = dragged.length === 1 ? dragged[0] : undefined;
      if (editGestures && !e.altKey && only?.type === "diagram") {
        const linked = store.getState().edges.some((x) => x.source === only.id || x.target === only.id);
        if (!linked) watchInsert(only.id);
      }
      // Alt-drag: copies take the originals' place and move with the pointer; the originals stay.
      if (editGestures && e.altKey) {
        const made = editor.duplicateInPlace({
          nodeIds: dragged.filter((n) => n.type !== "boundary").map((n) => n.id),
          groupIds: dragged.filter(isGroupNode).map((n) => n.data.groupId),
        });
        if (made.size) altCopies.current = made;
      }
      guides.start(e, dragged, altCopies.current);
      if (editGestures) watchMembership(dragged, altCopies.current);
    },
    [hideTip, editGestures, editor, guides, store, watchInsert, watchMembership, dragStarted, beginGesture],
  );
  const onNodeDragStop: OnNodeDrag<FlowNode> = useCallback(
    (e, _node, dragged) => {
      if (!dragActive.current) return;
      dragActive.current = false;
      guides.stop();
      const watch = insertWatch.current;
      insertWatch.current = null;
      const into = watch?.hover.lit();
      watch?.stop();
      if (watch && into && !(e.ctrlKey || e.metaKey)) editor.insertIntoEdge(into, watch.node);
      membershipWatch.current?.stop();
      membershipWatch.current = null;
      const copies = altCopies.current;
      altCopies.current = null;
      // Members a dragged boundary carries stay in it; every other dropped node settles where it landed.
      const draggedGroups = dragged.filter(isGroupNode);
      const ids = droppedNodes(dragged, copies);
      // Once the drop has rendered: a copy dropped onto something moves to the nearest free place (nothing
      // overlaps by default), then the dropped nodes settle into the boundaries around them, which grow to hold
      // a member poking out (D12), in the drop's undo step. A member that left its boundary says so.
      requestAnimationFrame(() => {
        endGesture();
        if (copies) {
          const made = [...copies.values()];
          editor.keepClear({
            nodeIds: made.filter((id) => !id.startsWith(GROUP_PREFIX)),
            groupIds: made.filter((id) => id.startsWith(GROUP_PREFIX)).map((id) => id.slice(GROUP_PREFIX.length)),
          });
        }
        if (!ids.length && !draggedGroups.length) return;
        if (ids.length) {
          const left = editor.settleMembership(ids);
          if (!copies && editGestures) sayLeft(left);
        }
        if (draggedGroups.length) {
          const targetFlowIds = draggedGroups.map((g) => copies?.get(g.id) ?? g.id);
          editor.settleBoundaryMembership(targetFlowIds.map((id) => id.slice(GROUP_PREFIX.length)));
        }
      });
    },
    [editor, guides, editGestures, sayLeft, droppedNodes, endGesture],
  );

  const spaceHeld = usePanKeys(wrapper, editGestures);

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
      setMenu(
        items.length
          ? {
              x: e.clientX,
              y: e.clientY,
              items: () => actionRegistry.build(full),
              get label() {
                return tr("menu.valueNodeValueEdgeValueGroupValueSelectionValueAnnotation", { target: ctx.target });
              },
            }
          : null,
      );
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

  // The handlers below keep their identity across renders (see SNAP_GRID): a new node handler re-renders every node.
  const { onMoveStart, onMove } = useMoveHandlers(controller, hideTip, setMenu);
  /** The inline edit as of the last render, for the hover handler (which keeps its identity). */
  const editingNow = useRef(editing);
  useLayoutEffect(() => {
    editingNow.current = editing;
  });
  const onNodeMouseEnter: NodeMouseHandler<FlowNode> = useCallback(
    (e, node) => {
      hovered.current = node.type === "boundary" ? undefined : node.id;
      if (node.type === "diagram" && !editingNow.current)
        showTip(e.currentTarget as Element, {
          nodeId: node.id,
          label: node.data.label || node.id,
          sublabel: node.data.sublabel,
          stencil: node.data.stencil,
        });
    },
    [showTip],
  );
  const onNodeMouseLeave: NodeMouseHandler<FlowNode> = useCallback(() => {
    hovered.current = undefined;
    hideTip();
  }, [hideTip]);

  /** Double-click on empty canvas: stencil search at the cursor. */
  const onPaneDoubleClick = (e: ReactMouseEvent) => {
    if (readOnly) return;
    if (!(e.target instanceof Element) || !e.target.classList.contains("react-flow__pane")) return;
    const point = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    setMenu({
      alignment: "physical-left",
      x: e.clientX,
      y: e.clientY,
      get label() {
        return tr("canvas.addANodeText");
      },
      testId: "quick-add",
      get searchable() {
        return tr("canvas.addANode");
      },
      // Quick-add opens the new node's name (decision 3), so what's typed next names it instead of reaching the
      // canvas's one-key shortcuts (T, L, C).
      items: () =>
        quickAddMenu((s) => {
          pickNamed(() => editor.addNamed(s.id, point), s.label);
          pushRecentStencil(s.id);
        }, getRecentStencils()),
    });
  };

  // ---------------------------------------------------------------- dropping a stencil (D13)
  // While a stencil is dragged over the canvas: over empty canvas, a faint outline where it will land; over
  // a node, the node lights up (the drop goes after it, connected); held over an edge, the edge lights up
  // (the drop goes in between, D8).
  const railDrop = useRef<{ hover: EdgeHover; node: Element | null } | null>(null);
  const endRailDrop = useCallback(() => {
    const r = railDrop.current;
    railDrop.current = null;
    r?.hover.clear();
    r?.node?.classList.remove("is-connect-target");
    landing.set(null);
  }, []);
  useEffect(() => endRailDrop, [endRailDrop]);
  /** The node a stencil dropped here would follow (one that takes edges), if any. */
  const dropNodeAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y);
    const t = connectTarget(connectHitAt(el, annotationKindOf), "");
    return t.kind === "node" ? { id: t.id, el: el?.closest(".react-flow__node") ?? null } : null;
  };
  const onRailDragOver = (e: DragEvent) => {
    if (!editGestures) return;
    const r = (railDrop.current ??= { hover: insertHover(), node: null });
    const over = dropNodeAt(e.clientX, e.clientY);
    if (over?.el !== r.node) {
      r.node?.classList.remove("is-connect-target");
      over?.el?.classList.add("is-connect-target");
      r.node = over?.el ?? null;
    }
    r.hover.at(e.clientX, e.clientY, !!over || e.ctrlKey || e.metaKey);
    if (over) return landing.set(null);
    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const { width, height } = getNodeVariant(nodeVariant).size;
    landing.set({
      x: Math.round((p.x - width / 2) / 10) * 10,
      y: Math.round((p.y - height / 2) / 10) * 10,
      width,
      height,
    });
  };

  const onDrop = (e: DragEvent) => {
    const into = railDrop.current?.hover.lit() ?? null;
    endRailDrop();
    const note = parseAnnotationDrag(e.dataTransfer.getData(ANNOTATION_DND_MIME));
    if (note) {
      e.preventDefault();
      controller.placing();
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
    const after = editGestures ? dropNodeAt(e.clientX, e.clientY) : null;
    controller.placing();
    // Onto a node: after it, connected (as a rail click does with it selected).
    if (after && editor.createConnected({ from: after.id, stencil: id })) return revealSelection();
    const at = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    // Held over an edge: in between, where it was dropped.
    if (into && !(e.ctrlKey || e.metaKey) && editor.insertNode(into, id, at)) return;
    // Anywhere else: where it was dropped, moved clear if it landed on something.
    const made = editor.addNode(id, at);
    requestAnimationFrame(() => editor.keepClear({ nodeIds: [made] }));
  };

  // ---------------------------------------------------------------- derived

  const direction = meta.direction ?? "LR";
  const { settleText, boundaryResized } = usePlacementSettling(editor);
  const ui = useMemo<DiagramUi>(
    () => ({
      theme,
      canvasColor: meta.color,
      direction,
      presenting,
      editing,
      setEditing: editGestures ? setEditing : () => {},
      rename: canOpenInspector ? renameIn : undefined,
      openEdgeMenu,
      settleText: editGestures ? settleText : undefined,
      grow: editGestures ? growFromChip : undefined,
      reconnect: editGestures ? editor.reconnectEdge : undefined,
      boundaryResized: editGestures ? boundaryResized : undefined,
    }),
    [
      theme,
      meta.color,
      direction,
      presenting,
      editing,
      openEdgeMenu,
      settleText,
      editGestures,
      canOpenInspector,
      growFromChip,
      editor,
      renameIn,
      boundaryResized,
    ],
  );
  // Read-only (embed) hides the same chrome as presenting, without the presentation sizing.
  const hideChrome = presenting || readOnly;
  const {
    diagramNodes,
    groupNodes,
    annotationNodes,
    selectedNodes,
    selectedAnnotations,
    selectedGroups,
    selectedEdges,
    nothingSelected,
    soleId,
  } = useSelectionSummary(nodes, edges);
  const inspectorFindings =
    soleId && checksOn ? <SelectionFindings store={checks} id={soleId} host={checksHost} /> : undefined;
  // Below ROOMY an open AI panel folds the stencils to their rail too, as live view does: at 1440 the
  // dock, the stencils and the inspector's rail left the diagram 780 px.
  const paletteHidden = paletteCollapsed || ((live || (narrow && aiDockOpen)) && !openedByHand.palette);
  const settledEmpty = useSettledSelection({ wrapper, editGestures, controller, nothingSelected });
  const inspectorHidden =
    livePanelOpen ||
    !prefs.inspector ||
    ((live || (narrow && settledEmpty) || (cramped && aiDockOpen)) && !openedByHand.inspector);
  const { checksMounted, readPaneChange, onManualPaneChange } = usePaneCamera(controller, {
    paletteHidden,
    aiDock,
    inspectorHidden,
    sheetResize,
    inspectorPref: prefs.inspector,
    inspectorByHand: openedByHand.inspector,
    livePanelOpen,
    narrow,
    cramped,
    nodes,
    edges,
    inspectorRequest,
    nothingSelected,
    menu: menu ? (menu.testId === "quick-add" ? "quickAdd" : "context") : null,
    live,
    presenting,
  });
  // Stable, so the memoized stencil rail skips the canvas's frequent renders (drag, select, zoom).
  const togglePalette = useCallback(() => {
    setPaletteCollapsed(!paletteHidden);
    setOpenedByHand((o) => ({ ...o, palette: paletteHidden }));
  }, [paletteHidden]);
  const addFromPalette = useAddFromPalette(editor, live, controller);
  const anchorLabel = useMemo(() => {
    if (selectedNodes.length + selectedAnnotations.length + selectedGroups.length + selectedEdges.length !== 1)
      return undefined;
    const n = selectedNodes[0];
    if (n) return n.data.label || n.id;
    const a = selectedAnnotations[0];
    return a && isConnectable(a.data.kind) ? annotationTitle(a.data) : undefined;
  }, [selectedNodes, selectedAnnotations, selectedGroups, selectedEdges]);
  useEffect(() => railAnchor.set(live || hideChrome ? undefined : anchorLabel), [live, hideChrome, anchorLabel]);
  useEffect(() => () => railAnchor.set(undefined), []);
  const annotateFromPalette = useAnnotateFromPalette(editor, controller);
  const labels = useMemo(
    () =>
      new Map([
        ...annotationNodes.map((n): [string, string] => [n.id, annotationTitle(n.data)]),
        ...diagramNodes.map((n): [string, string] => [n.id, n.data.label || n.id]),
      ]),
    [diagramNodes, annotationNodes],
  );
  const { ariaNodes, ariaEdges } = useCanvasNavigation({
    nodes,
    edges,
    labels,
    readOnly,
    direction,
    nodeVariant,
    controller,
    getNodes,
    store,
    editor,
    wrapper,
    revealSelection,
    setEdges,
    navigate,
    stepping,
    onHistoryStep,
    setAnnouncement,
  });
  const nodeCount = diagramNodes.length;
  /** Anything drawn: an annotations-only canvas isn't "empty", though there's nothing to simulate. */
  const contentCount = nodeCount + annotationNodes.length;
  const diagramColor = meta.color ? resolveAnnotationColor(meta.color).hex : undefined;

  return (
    <CameraContext.Provider value={controller}>
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
              nodeVariant={nodeVariant}
            />
          )}
          <div
            className={`canvas-wrap${diagramColor ? " has-diagram-color" : ""}`}
            data-testid="canvas-wrap"
            data-toast-area
            tabIndex={-1}
            ref={wrapper}
            style={diagramColor ? ({ "--diagram-color": diagramColor } as CSSProperties) : undefined}
            onFocusCapture={(e) => {
              if (e.target instanceof Element && e.target.closest('[data-testid^="rf__node-"]')) interruptFit();
            }}
            onPointerDownCapture={(e) => {
              // Shift+drag on empty canvas adds the box's pick to the selection, as Shift+click adds a node.
              const onPane = e.target instanceof Element && e.target.classList.contains("react-flow__pane");
              if (!onPane || e.button !== 0 || !e.shiftKey) return void (boxBaseRef.current = null);
              const { nodes: ns, edges: es } = store.getState();
              boxBaseRef.current = {
                nodes: new Set(ns.filter((n) => n.selected).map((n) => n.id)),
                edges: new Set(es.filter((x) => x.selected).map((x) => x.id)),
              };
            }}
            onPointerMove={(e) => {
              pointer.current = { x: e.clientX, y: e.clientY };
              const target =
                e.target instanceof Element ? e.target.closest<HTMLElement>('[data-testid^="rf__node-"]') : null;
              if (controller.fitting && target) {
                // Hover is input too: keep the target still and arm its tooltip after
                // stopping the fit (whose move-start dismisses the previous tooltip).
                interruptFit();
                const id = target.dataset.testid?.slice("rf__node-".length);
                const node = id ? getNode(id) : undefined;
                if (node?.type === "diagram" && !editing)
                  showTip(target, {
                    nodeId: node.id,
                    label: node.data.label || node.id,
                    sublabel: node.data.sublabel,
                    stencil: node.data.stencil,
                  });
              }
              // Ctrl/Cmd during a box selection: only what's wholly inside.
              containRef.current = e.ctrlKey || e.metaKey;
            }}
            onPointerLeave={() => (pointer.current = null)}
            onDragOver={(e) => {
              if (
                e.dataTransfer.types.includes(STENCIL_DND_MIME) ||
                e.dataTransfer.types.includes(ANNOTATION_DND_MIME)
              ) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
              }
              if (e.dataTransfer.types.includes(STENCIL_DND_MIME)) onRailDragOver(e);
            }}
            onDragLeave={(e) => {
              if (!wrapper.current?.contains(e.relatedTarget as Node | null)) endRailDrop();
            }}
            onDrop={onDrop}
          >
            <EdgeMarkers />
            {!hideChrome && copyNotice && <CopyNotice text={copyNotice} />}
            <ReactFlow<FlowNode, DiagramFlowEdge>
              nodes={ariaNodes}
              fitView={bootstrapFit}
              fitViewOptions={presenting ? FIT_PRESENT : FIT}
              // Focus brings a node into view clear of the chrome (revealFocused above).
              autoPanOnNodeFocus={false}
              edges={ariaEdges}
              onNodesChange={handleNodesChange}
              onEdgesChange={handleEdgesChange}
              onConnect={onConnect}
              onConnectStart={onConnectStart}
              onConnectEnd={onConnectEnd}
              connectionLineComponent={ConnectionLine}
              isValidConnection={isValidConnection}
              connectionMode={ConnectionMode.Loose}
              connectionRadius={28}
              onEdgeDoubleClick={readOnly ? undefined : onEdgeDoubleClick}
              // Every drag, the selection's frame included (see onNodeDragStart).
              onNodeDragStart={onNodeDragStart}
              onNodeDragStop={onNodeDragStop}
              onPaneContextMenu={onPaneContextMenu}
              onNodeContextMenu={onNodeContextMenu}
              onEdgeContextMenu={onEdgeContextMenu}
              onSelectionContextMenu={onSelectionContextMenu}
              onDoubleClick={onPaneDoubleClick}
              onMoveStart={onMoveStart}
              onMove={onMove}
              onNodeMouseEnter={onNodeMouseEnter}
              onNodeMouseLeave={onNodeMouseLeave}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              colorMode={theme}
              // Bottom-right, lifted above the minimap (canvas.css): never under the live bar or the hint.
              attributionPosition="bottom-right"
              minZoom={0.15}
              maxZoom={2.5}
              snapToGrid={prefs.snap}
              snapGrid={SNAP_GRID}
              elevateNodesOnSelect={false}
              // Space held: a drag pans even from a node, so nodes neither drag nor connect meanwhile.
              nodesDraggable={!readOnly && !spaceHeld}
              nodesConnectable={!readOnly && !spaceHeld}
              elementsSelectable={!readOnly}
              // The wheel and a two-finger swipe pan (Shift+wheel sideways); Ctrl/Cmd+wheel and pinch zoom
              // at the pointer. Embedded in a page, the wheel scrolls the page (pinch / Ctrl+wheel zoom).
              panOnScroll={!readOnly || !!viewer?.wheel}
              panOnScrollSpeed={1}
              zoomOnScroll={false}
              preventScrolling={!readOnly || !!viewer?.wheel}
              // Editing: a drag on empty canvas draws the selection box (it picks what it touches), the
              // middle button and Space+drag pan, Shift/Ctrl/Cmd+click toggle. Elsewhere a drag pans.
              panOnDrag={editGestures ? PAN_MIDDLE : true}
              selectionOnDrag={editGestures}
              selectionKeyCode={editGestures ? null : "Shift"}
              multiSelectionKeyCode={editGestures ? MULTI_SELECT_KEYS : undefined}
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
              <ZoomVar host={wrapper} />
              {prefs.grid && <DotGrid />}
              {editGestures && <svg ref={guideLayer} className="smart-guides" data-testid="smart-guides" aria-hidden />}
              {editGestures && <LandingOutline />}
              {!hideChrome && (
                <CanvasControls
                  editor={editor}
                  fit={fit}
                  zoomedByButton={zoomedByButton}
                  onShortcuts={() => setShortcutsOpen(true)}
                />
              )}
              {!hideChrome && prefs.minimap && contentCount > 0 && <CanvasMinimap />}
              {/* Nothing to simulate on a blank canvas: the Live toggle appears with the first node. */}
              {(nodeCount > 0 || live) && (
                <LiveView
                  paneRevision={`${paletteHidden}:${inspectorHidden}:${sheetResize}`}
                  paneChange={readPaneChange}
                  paneMenuOpen={!!menu}
                  onManualPaneChange={onManualPaneChange}
                  camera={camera}
                  readOnly={readOnly}
                  initial={viewer?.live}
                  onHandle={receiveLiveHandle}
                  editor={readOnly ? undefined : editor}
                  diagram={readOnly ? fromFlow(meta, nodes, edges) : undefined}
                  presenting={presenting}
                  simulations={meta.simulations}
                  planning={meta.planning}
                  privateDiagram={privacy !== null}
                  onLiveChange={onLiveChange}
                  onPanelChange={setLivePanelOpen}
                  onSaveDiagram={
                    readOnly
                      ? undefined
                      : (diagram) => {
                          const mod = flushSave(diagram);
                          if (mod !== undefined) setModified(mod);
                        }
                  }
                />
              )}
              {viewer?.controls && <CanvasFitContext.Provider value={fit}>{viewer.controls}</CanvasFitContext.Provider>}
              {checksOn && checksCard && <ChecksMarkersView store={checks} />}
            </ReactFlow>

            <CanvasOverlays
              card={card}
              cardCovers={cardCovers}
              presenting={presenting}
              privacy={privacy}
              hideChrome={hideChrome}
              nodeCount={nodeCount}
              meta={meta}
              checks={checks}
              checksCard={checksCard}
              openingFitDone={openingFitDone}
              modified={modified}
              ownDiagram={ownDiagram}
              reset={reset}
              checksOn={checksOn}
              checksHost={checksHost}
              checksTop={checksTop}
              checksMounted={checksMounted}
              onExitPresent={onExitPresent}
              contentCount={contentCount}
              live={live}
              start={start}
              startDismissed={startDismissed}
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
              paletteHidden={paletteHidden}
              hintSeen={hintSeen}
              dismissHint={dismissHint}
            />
          </div>
          {!hideChrome && (
            <Inspector
              editor={editor}
              revision={hostRevision}
              readDiagram={readInspectorDiagram}
              meta={meta}
              selectedNodes={selectedNodes}
              selectedGroups={selectedGroups}
              selectedEdges={selectedEdges}
              selectedAnnotations={selectedAnnotations}
              groups={groupNodes}
              nodeLabel={(id) => labels.get(id) ?? id}
              counts={{ nodes: nodeCount, edges: edges.length, groups: groupNodes.length }}
              collapsed={inspectorHidden}
              onResize={() => setSheetResize((revision) => revision + 1)}
              onTextSettled={settleText}
              onToggle={() => {
                setPref("inspector", inspectorHidden);
                setOpenedByHand((o) => ({ ...o, inspector: inspectorHidden }));
              }}
              focus={inspectorFocus}
              takeFocus={takeInspectorFocus}
              connection={
                naming && selectedNodes[0]?.id === naming.node
                  ? { id: naming.edge, label: edges.find((e) => e.id === naming.edge)?.data?.label ?? "" }
                  : undefined
              }
              onNamed={() => setNaming((current) => (current?.node === selectedNodes[0]?.id ? null : current))}
              findings={inspectorFindings}
            />
          )}
        </div>
        {menu &&
          (menu.connected ? (
            <ConnectedQuickAddMenu
              {...menu}
              anchor={menu.connected}
              root={wrapper}
              items={menuItems}
              onClose={() => setMenu(null)}
            />
          ) : (
            <ContextMenu {...menu} items={menuItems} onClose={() => setMenu(null)} />
          ))}
        {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
        {!readOnly && (
          <div
            className="sr-only"
            role="status"
            aria-live="polite"
            data-testid="canvas-announce"
            data-seq={announcement.seq}
          >
            {announcement.text}
          </div>
        )}
        <NodeTipLayer tips={nodeTips} enabled={tipsEnabled} covered={!!menu} root={wrapper} />
      </DiagramContext.Provider>
    </CameraContext.Provider>
  );
}
