import { useCanvasMenuItems, useCanvasContextMenus, type CanvasSurface } from "./menus/useCanvasMenus";
import {
  InteractionContext,
  useInteractionCamera,
  useInteractionCore,
  useSelectionEvents,
} from "./interaction/useInteraction";
import { useRailPlacement } from "./placement/useRailPlacement";
import { useDragPlacement } from "./placement/useDragPlacement";
import { useConnectionPlacement } from "./placement/useConnectionPlacement";
import { useQuickAddPlacement, paneQuickAdd } from "./placement/useQuickAddPlacement";
import {
  useCanvasNaming,
  usePlacementSettling,
  useAddFromPalette,
  useAnnotateFromPalette,
} from "./placement/useCanvasEditCommands";

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

import { edgeMarks } from "./edgeMarks";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
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
  type NodeMouseHandler,
  type NodeTypes,
  type EdgeTypes,
  type IsValidConnection,
} from "@xyflow/react";
import { examples } from "../examples";
import { useSettings } from "../harness/settings";
import { getNodeVariant } from "../harness/nodeVariants";
import { DRAFT_SLUG, getDiagramIdentity, isLibrarySlug, setDiagramPrivate, setOnDeviceAllowed } from "../lib/diagramIO";
import { privacyOf } from "../lib/localOnly";
import { usePrivacyFlags } from "../lib/usePrivacy";
import type { DiagramFile } from "../model/types";

import { fromFlow, toFlow, type DiagramMeta } from "./convert";

import { DiagramContext, type DiagramUi, type InlineEdit, type RenameTarget } from "./DiagramContext";
import { canvasNodeTypes } from "./nodes/nodeTypes";
import { ANNOTATION_DND_MIME, resolveAnnotationColor, annotationTitle } from "./annotations";
import { EdgeMarkers, FlowEdge } from "./edges/FlowEdge";
import { Palette, STENCIL_DND_MIME } from "./Palette";
import { Inspector } from "./Inspector";
import { ContextMenu } from "../components/ContextMenu";
import { ShortcutsDialog } from "../components/ShortcutsDialog";
import { actionRegistry } from "../editor/actions";
import { builtinActions } from "../editor/builtinActions";
import { useEditorPrefs } from "../editor/prefs";
import { useHistory, type CanvasSnapshot } from "../editor/useHistory";
import type { FlowSelection } from "../editor/historySelection";
import { useEditor } from "../editor/useEditor";
import { useCanvasShortcuts, type NavStep } from "../editor/useCanvasShortcuts";
import { isEditableTarget } from "../editor/shortcuts";

import type { DiagramFlowEdge, FlowNode } from "./types";

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

import { ConnectionLine } from "./ConnectionLine";

import { type Toward } from "./placement";

import { LandingOutline } from "./LandingOutline";

import { isConnectable } from "./annotations";
import { railAnchor } from "./railAnchor";
import { checksPanel, useChecksPanel } from "./checks/checksPanel";
import { useChecks } from "./checks/useChecks";
import { ChecksMarkersView, SelectionFindings } from "./checks/ChecksViews";
import { PresenceLayer } from "./PresenceLayer";

/** A room's cursor is sent at most this often (src/collab/limits.ts, cursorIntervalMs; the canvas doesn't import it). */
const COLLAB_CURSOR_MS = 67;
import { t as tr, useLocale } from "../i18n";
import { CopyNotice } from "./CopyNotice";
import {
  CameraContext,
  FIT,
  FIT_PRESENT,
  useCameraCore,
  useModeFit,
  useMoveHandlers,
  usePaneCamera,
  useRevealIds,
  useRevealSelection,
} from "./camera";
import type { EditorRoom } from "../editor/room";
import { remoteTargetRemoved } from "../editor/remoteSnapshot";
import { targetRemoved } from "./menus/menuTargets";

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

  // Menus, dialogs and keyboard focus open and move through one controller (it tells the camera of menus).
  const {
    controller: interaction,
    state: interactionState,
    setOrder,
  } = useInteractionCore<CanvasSurface>(wrapper, store, nodes, edges);
  const surface = interactionState.menu;
  const menu = surface && surface.kind !== "dialog" ? surface.payload : null;
  const menuSeq = surface?.seq;
  const menuItems = useCanvasMenuItems(menu, locale);
  const shortcutsOpen = surface?.kind === "dialog";
  const showShortcuts = useCallback(() => void interaction.openMenu("dialog", null), [interaction]);
  const closeShortcuts = useCallback(() => interaction.closeMenu("escape"), [interaction]);
  const closeMenu = useCallback(
    (reason: "pick" | "escape" | "outside" | "scroll" | "blur" | "resize") => interaction.closeMenu(reason, menuSeq),
    [interaction, menuSeq],
  );
  /** A pan by hand closes menus (React Flow's move start with an event). */
  const closeMenuOnPan = useCallback(() => interaction.closeMenu("scroll"), [interaction]);
  const [announcement, setAnnouncement] = useState({ text: "", seq: 0 });
  const snapshot = useMemo<CanvasSnapshot>(() => ({ meta, nodes, edges }), [meta, nodes, edges]);
  const libraryPrivacy = usePrivacyFlags(slug);
  const [roomPrivate, setRoomPrivate] = useState(false);
  const privacyFlags = useMemo(
    () => ({ ...libraryPrivacy, private: libraryPrivacy.private || roomPrivate }),
    [libraryPrivacy, roomPrivate],
  );
  /** A peer's change arrived: the camera hears of it (set up with the camera, below). */
  const onRemote = useRef(() => {});
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
      // What had focus in this canvas may go with a peer's change: the canvas takes it, and says why (R1).
      if (originatedHere)
        interaction.dispatch({ type: "document.replaced", active }, (focused) => {
          if (focused)
            setAnnouncement((a) => ({
              text: removed ? tr("collab.targetRemoved") : tr("collab.controlRemoved"),
              seq: a.seq + 1,
            }));
        });
      if (remote) {
        onRemote.current();
        // A context menu on something a peer deleted closes (M7): its commands would act on nothing.
        const open = interaction.getSnapshot().menu;
        if (open?.kind === "context" && targetRemoved(open.payload?.targets, s)) {
          // The menu is portalled outside the canvas, so R1's announcement above can't have said why.
          const focusedMenu = !!document.activeElement?.closest(".cm");
          interaction.closeMenu("remote", open.seq);
          if (focusedMenu) setAnnouncement((a) => ({ text: tr("collab.targetRemoved"), seq: a.seq + 1 }));
        }
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
  useInteractionCamera(interaction, controller);
  // A peer's change never moves the view: the camera hears it and decides nothing (C1).
  useLayoutEffect(() => {
    onRemote.current = () => controller.dispatch({ type: "remote.changed", kind: "doc" });
  }, [controller]);
  // The room's canvas replaced a joiner's wait: it takes the keyboard only if that went with the wait (W2).
  useEffect(() => {
    if (room) interaction.dispatch({ type: "room.ready" });
  }, [room, interaction]);
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
    showShortcuts,
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
        !interaction.menu &&
        checksPanel.isOpen() &&
        !sel.nodeIds.length &&
        !sel.edgeIds.length &&
        !sel.groupIds.length &&
        !stopSimulations.current()
      )
        checksPanel.close();
      interaction.closeMenu("escape");
    },
    live,
    onGrow: (from, toward, clone) => grow.current(from, toward, clone),
    onNavigate: (step, from) => navigate.current(step, from),
    keepFocus: (from) => interaction.dispatch({ type: "escape", from }),
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
  const allowOnDevice = useCallback((on: boolean) => void setOnDeviceAllowed(slug, on), [slug]);
  // Only development builds read content for privacy (privacyOf); production reads provenance alone.
  const privacy = privacyOf({
    ...privacyFlags,
    ...(import.meta.env.DEV ? { diagram: fromFlow(meta, nodes, edges) } : {}),
  });
  /** The palette went to a node, or added one (P1, P2). */
  const focusFromPalette = useCallback(
    (id: string, placed: boolean) =>
      interaction.dispatch({ type: "selection.changed", cause: "palette", target: { kind: "node", id }, placed }),
    [interaction],
  );
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
    focus: focusFromPalette,
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
    // Dialog teardown first restores its opener; move to the destination after that cleanup (C1).
    if (focusRequest !== undefined) interaction.dispatch({ type: "canvas.requested" });
  }, [focusRequest, interaction]);

  // Presenting hides the button that started it: focus goes to the canvas, not the page, so the keys (Esc, L,
  // Space) and the next Tab start from there (C2).
  useEffect(() => {
    if (presenting) interaction.dispatch({ type: "presenting" });
  }, [presenting, interaction]);

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

  const [renameIn, pickNamed, nameNew] = useCanvasNaming(
    canOpenInspector,
    editor,
    openInspector,
    setEditing,
    setNaming,
    rename,
    history,
    interaction,
    revealSelection,
  );

  const [growTo, cloneTo, growFromChip] = useQuickAddPlacement(
    readOnly,
    live,
    presenting,
    meta,
    editor,
    getNode,
    wrapper,
    hideTip,
    setEditing,
    store,
    controller,
    pickNamed,
    menu,
    interaction,
  );
  const revealIds = useRevealIds(controller, editor);
  const checksHost = useMemo(
    () => ({
      editor,
      reveal: revealIds,
      choose: growFromChip,
      hover: checks.setHot,
      open: () => checksPanel.open(),
      returnFocus: () =>
        interaction.dispatch({ type: "dialog.closed", dialog: "checks", opener: checksPanel.opener() }),
    }),
    [editor, revealIds, growFromChip, checks, interaction],
  );
  useLayoutEffect(() => {
    grow.current = (from, toward, clone) => (clone ? cloneTo(from, toward) : growTo(from, toward));
  });

  const [annotationKindOf, onConnectStart, onConnectEnd] = useConnectionPlacement(
    getNode,
    hideTip,
    wrapper,
    readOnly,
    live,
    editor,
    screenToFlowPosition,
    pickNamed,
    interaction,
  );

  const { contain: containRef, boxBase: boxBaseRef } = useBoxSelection({
    editGestures,
    store,
    setNodes,
    setEdges,
    selecting: interaction.selecting,
  });

  const [
    guideLayer,
    handleNodesChange,
    handleEdgesChange,
    onEdgeDoubleClick,
    onNodeDragStart,
    onNodeDragStop,
    insertHover,
  ] = useDragPlacement(
    store,
    prefs,
    editGestures,
    onNodesChange,
    onEdgesChange,
    beginGesture,
    endGesture,
    rename,
    edgeStyle,
    meta,
    nodeVariant,
    screenToFlowPosition,
    wrapper,
    editor,
    dragStarted,
    hideTip,
    interaction,
  );

  const spaceHeld = usePanKeys(wrapper, editGestures);

  const [onPaneContextMenu, onNodeContextMenu, openEdgeMenu, onEdgeContextMenu, onSelectionContextMenu] =
    useCanvasContextMenus(
      editor,
      screenToFlowPosition,
      readOnly,
      live,
      hideTip,
      hintSeen,
      dismissHint,
      setEditing,
      interaction,
    );

  // The handlers below keep their identity across renders (see SNAP_GRID): a new node handler re-renders every node.
  const { onMoveStart, onMove } = useMoveHandlers(controller, hideTip, closeMenuOnPan);
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

  const onPaneDoubleClick = paneQuickAdd(readOnly, screenToFlowPosition, interaction, pickNamed, editor);

  const [onRailDragOver, endRailDrop, onDrop] = useRailPlacement(
    editGestures,
    insertHover,
    annotationKindOf,
    screenToFlowPosition,
    nodeVariant,
    interaction,
    editor,
    revealSelection,
  );

  // ---------------------------------------------------------------- derived

  const direction = meta.direction ?? "LR";
  const [settleText, boundaryResized] = usePlacementSettling(editor);
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
  const { checksMounted } = usePaneCamera(controller, {
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
    live,
    presenting,
  });
  const selectionKey = useSelectionEvents(interaction, nodes, edges);
  // In a room, the others see what this person selects (outlines in their colour; never their own selection).
  const presence = room?.presence;
  useEffect(() => presence?.setSelection(JSON.parse(selectionKey) as string[]), [presence, selectionKey]);
  // The pointer, for the others: the latest position, converted (one geometry read) at the cursor's own pace and
  // never snapped to the grid.
  const cursorScreen = useRef<{ x: number; y: number } | null>(null);
  const cursorTimer = useRef<number | undefined>(undefined);
  const sendCursor = useCallback(
    (at: { x: number; y: number } | null) => {
      if (!presence) return;
      cursorScreen.current = at;
      if (!at) {
        window.clearTimeout(cursorTimer.current);
        cursorTimer.current = undefined;
        return presence.setCursor(undefined);
      }
      if (cursorTimer.current !== undefined) return;
      cursorTimer.current = window.setTimeout(() => {
        cursorTimer.current = undefined;
        const latest = cursorScreen.current;
        if (latest) presence.setCursor(screenToFlowPosition(latest, { snapToGrid: false }));
      }, COLLAB_CURSOR_MS);
    },
    [presence, screenToFlowPosition],
  );
  useEffect(() => () => window.clearTimeout(cursorTimer.current), []);
  // A peer's presence never moves the view: the camera hears it and decides nothing (C1).
  const presenceChanged = useCallback(
    () => controller.dispatch({ type: "remote.changed", kind: "presence" }),
    [controller],
  );
  // Stable, so the memoized stencil rail skips the canvas's frequent renders (drag, select, zoom).
  const togglePalette = useCallback(() => {
    setPaletteCollapsed(!paletteHidden);
    setOpenedByHand((o) => ({ ...o, palette: paletteHidden }));
  }, [paletteHidden]);
  const addFromPalette = useAddFromPalette(editor, live, interaction);
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
  const annotateFromPalette = useAnnotateFromPalette(editor, interaction);
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
    onHistoryStep,
    setAnnouncement,
    interaction,
    roving: interactionState.roving,
    setOrder,
  });
  const nodeCount = diagramNodes.length;
  /** Anything drawn: an annotations-only canvas isn't "empty", though there's nothing to simulate. */
  const contentCount = nodeCount + annotationNodes.length;
  const diagramColor = meta.color ? resolveAnnotationColor(meta.color).hex : undefined;

  return (
    <CameraContext.Provider value={controller}>
      <InteractionContext.Provider value={interaction}>
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
                sendCursor({ x: e.clientX, y: e.clientY });
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
              onPointerLeave={() => {
                pointer.current = null;
                sendCursor(null);
              }}
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
                panOnDrag={editGestures && !spaceHeld ? PAN_MIDDLE : true}
                // usePanKeys owns Space; React Flow's global listener would cancel reading-region scrolling.
                panActivationKeyCode={null}
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
                {editGestures && (
                  <svg ref={guideLayer} className="smart-guides" data-testid="smart-guides" aria-hidden />
                )}
                {editGestures && <LandingOutline />}
                {!hideChrome && (
                  <CanvasControls
                    editor={editor}
                    fit={fit}
                    zoomedByButton={zoomedByButton}
                    onShortcuts={showShortcuts}
                  />
                )}
                {!hideChrome && prefs.minimap && contentCount > 0 && <CanvasMinimap />}
                {/* Nothing to simulate on a blank canvas: the Live toggle appears with the first node. */}
                {(nodeCount > 0 || live) && (
                  <LiveView
                    readOnly={readOnly}
                    example={!initial && examples.some((example) => example.slug === slug)}
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
                {viewer?.controls && (
                  <CanvasFitContext.Provider value={fit}>{viewer.controls}</CanvasFitContext.Provider>
                )}
                {checksOn && checksCard && <ChecksMarkersView store={checks} />}
                {presence && <PresenceLayer presence={presence} onChange={presenceChanged} />}
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
                  interaction.dispatch({ type: "start.blank" });
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
                  interaction.dispatch({ type: "inspector.toggled", cause: "panel" });
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
                onClose={closeMenu}
                returnFocus={false}
              />
            ) : (
              <ContextMenu {...menu} items={menuItems} onClose={closeMenu} returnFocus={false} />
            ))}
          {shortcutsOpen && <ShortcutsDialog onClose={closeShortcuts} />}
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
      </InteractionContext.Provider>
    </CameraContext.Provider>
  );
}
