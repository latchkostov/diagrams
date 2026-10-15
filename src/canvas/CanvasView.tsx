import { useCaptionContrast } from "./useCaptionContrast";
import { retainConversation } from "../lib/exampleConversations";
import { isDenyRule } from "../stencils/netDevices";
import { edgeSettings, isDependency, RELATION_META, settingsSummary } from "../model/relations";
import { pipsByNode } from "./nodes/dependencyRows";
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
  type CSSProperties,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type Ref,
  type RefObject,
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
  useStore,
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
  type FitViewOptions,
  type IsValidConnection,
  type ReactFlowState,
} from "@xyflow/react";
import { getStencil } from "../stencils/registry";
import { useSettings } from "../harness/settings";
import { getNodeVariant } from "../harness/nodeVariants";
import {
  DRAFT_SLUG,
  copyEditedExample,
  emptyDiagram,
  getAutosave,
  getDiagramIdentity,
  releaseExampleSaveTarget,
  getOriginal,
  isLibrarySlug,
  setDiagramPrivate,
  setOnDeviceAllowed,
  UNTITLED,
  writeAutosave,
} from "../lib/diagramIO";
import { privacyOf } from "../lib/localOnly";
import { PRIVACY_REQUEST, usePrivacyFlags } from "../lib/usePrivacy";
import type { AnnotationKind, AnnotationShape, DiagramFile } from "../model/types";
import { memberBoxes } from "./memberBoxes";
import { expandGroupIds } from "../model/groupHierarchy";
import {
  edgeAriaLabel,
  fromFlow,
  nodeAriaLabel,
  toFlow,
  withEdgeAria,
  withNodeAria,
  withRovingFocus,
  type DiagramMeta,
} from "./convert";
import { previewMembership, type GroupRect, type MemberBox } from "./membership";
import { nearestInDirection, readingOrder, stepInOrder, tabOrder, type NavBox } from "./keyboardNav";
import { DiagramContext, type DiagramUi, type InlineEdit, type RenameTarget } from "./DiagramContext";
import { revealPan, useCovered, useKeepSelectionInView, useOverlayFit, useOverlayTestIds } from "./useOverlayFit";
import { panIntoView, type Viewport } from "./geometry/fit";
import { union } from "./geometry/rect";
import { canvasNodeTypes } from "./nodes/nodeTypes";
import {
  ANNOTATION_DND_MIME,
  annotationAriaLabel,
  resolveAnnotationColor,
  annotationTitle,
  parseAnnotationDrag,
} from "./annotations";
import { resolveGroupTone } from "./groupTones";
import { EdgeMarkers, FlowEdge } from "./edges/FlowEdge";
import { Palette, STENCIL_DND_MIME } from "./Palette";
import { Inspector } from "./Inspector";
import { Icon } from "../components/Icon";
import { ContextMenu } from "../components/ContextMenu";
import { ShortcutsDialog } from "../components/ShortcutsDialog";
import { actionRegistry, type ActionContext, type MenuNode } from "../editor/actions";
import { builtinActions, quickAddMenu } from "../editor/builtinActions";
import { useEditorPrefs } from "../editor/prefs";
import { useHistory, type CanvasSnapshot } from "../editor/useHistory";
import type { FlowSelection } from "../editor/historySelection";
import { useEditor } from "../editor/useEditor";
import { inCanvas, useCanvasShortcuts, type NavStep } from "../editor/useCanvasShortcuts";
import { formatCombo, isEditableTarget, shortcutKeys } from "../editor/shortcuts";
import type { NewNode, Selection, XYBox } from "../editor/types";
import type { AnnotationFlowNode, DiagramFlowEdge, DiagramFlowNode, FlowNode, GroupFlowNode } from "./types";
import { flushSync } from "react-dom";
import { LiveView, type LiveHandle, type LiveViewProps } from "../live/LiveView";
import { CanvasFitContext } from "./canvasFit";
import { LIVE_BAR_SPACE } from "../live/layout";
import { safeStorage } from "../lib/storage";
import { StartCard, type StartOptions } from "./StartCard";
import { useAiDock } from "../ai/ui/dock";
import { motionMs } from "../lib/motion";
import { NodeTooltip } from "./NodeTooltip";
import { useNodeTipKeyboard, useNodeTooltip } from "./useNodeTooltip";
import { FirstRunHint } from "./FirstRunHint";
import { notify, toast } from "../interop/ui/toast";
import { useCanvasHost } from "../palette/canvasHost";
import { useNoCanvasTextSelection } from "./useNoCanvasTextSelection";
import { getRecentStencils, pushRecentStencil } from "../lib/recentStencils";
import { connectHitAt, connectOver, connectTarget, edgesBetween, pickInBox, type BoxItem } from "./gestures";
import { ConnectionLine } from "./ConnectionLine";
import { captureTypeAhead } from "./typeAhead";
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
import { ChecksCardView, ChecksMarkersView, DiagramCardMeta, SelectionFindings } from "./checks/ChecksViews";
import { useBelow } from "./checks/useBelow";
import { PresentFullscreen } from "./PresentFullscreen";
import { useFullscreen } from "../lib/fullscreen";
import { t as tr, useLocale } from "../i18n";
import { CopyNotice } from "./CopyNotice";
import { useMeasuredTask } from "./useMeasuredTask";

const nodeTypes: NodeTypes = canvasNodeTypes;
const edgeTypes: EdgeTypes = { flow: FlowEdge };
// Pixel padding keeps the title card (top-left) from covering the diagram.
const FIT: FitViewOptions = { padding: { top: "110px", right: "48px", bottom: "48px", left: "48px" }, maxZoom: 1.25 };
const FIT_PRESENT: FitViewOptions = {
  padding: { top: "190px", right: "64px", bottom: "64px", left: "64px" },
  maxZoom: 1.6,
};

/** Editing: Shift+click and Ctrl/Cmd+click both toggle an item in the selection, as in other tools. */
const MULTI_SELECT_KEYS = ["Shift", "Control", "Meta"];
/** Editing: a plain drag on empty canvas draws the selection box, so only the middle button pans. */
const PAN_MIDDLE = [1];

/**
 * The view's zoom as a CSS variable on the canvas (`--rf-zoom`), for sizes that must hold on screen at
 * any zoom (the handles' hit areas, the inline editors). Rounded down to a step, so what's scaled by
 * 1/zoom is never short of its size. Re-renders only itself, and only when the zoom moves a step.
 */
function ZoomVar({ host }: { host: RefObject<HTMLElement | null> }) {
  const zoom = useStore((s: ReactFlowState) => Math.max(0.02, Math.floor(s.transform[2] * 50 + 1e-6) / 50));
  useLayoutEffect(() => void host.current?.style.setProperty("--rf-zoom", String(zoom)), [host, zoom]);
  return null;
}

/**
 * The dot grid: a dot every 10 px from 100% zoom up and every 20 px below, so the dots and the snap agree
 * where they can be told apart. Re-renders only when the zoom crosses 100%.
 */
function DotGrid() {
  const fine = useStore((s: ReactFlowState) => s.transform[2] >= 1);
  return <Background variant={BackgroundVariant.Dots} gap={fine ? 10 : 20} size={1.3} color="var(--dot)" />;
}

/** Ids whose selected flag inside React Flow disagrees with the box's pick. */
function staleBoxFlags(
  s: Pick<ReactFlowState<FlowNode, DiagramFlowEdge>, "nodeLookup">,
  picked: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>();
  for (const n of s.nodeLookup.values()) if (!!n.selected !== picked.has(n.id)) out.add(n.id);
  return out;
}

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

/** Minimap: notes show their tint; zones, text and shapes are outlines. */
function annotationMinimapFill(n: AnnotationFlowNode): string {
  return n.data.kind === "note" ? resolveAnnotationColor(n.data.color, n.data.kind).hex : "transparent";
}

export function CanvasView(props: Props) {
  useLocale();
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

type MenuState = {
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
}: Props) {
  const locale = useLocale();
  const { theme, nodeVariant, edgeStyle } = useSettings();
  const { screenToFlowPosition, getNode, getNodes, getNodesBounds, getViewport, setCenter, setViewport } = useReactFlow<
    FlowNode,
    DiagramFlowEdge
  >();
  const store = useStoreApi<FlowNode, DiagramFlowEdge>();
  const wrapper = useRef<HTMLDivElement>(null);
  useNoCanvasTextSelection(wrapper);
  /** The pointer over the canvas (client coords), for "T adds text here" and Ctrl+V. */
  const pointer = useRef<{ x: number; y: number } | null>(null);
  /** The node under the pointer (Shift+2 with nothing selected zooms to it). */
  const hovered = useRef<string | undefined>(undefined);

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
  useCaptionContrast(wrapper, nodes, theme, meta.color);
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
  const openInspector = useCallback(
    (field?: string, caret?: "end", target?: string) => {
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
      if (on) {
        setEditing(null);
        dismissHint();
      }
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
  /** Undo and Redo chose a selection: keyboard focus follows it (set up with the keyboard selection, below). */
  const onHistoryStep = useRef((_direction: "undo" | "redo", _selection: FlowSelection) => {});
  const history = useHistory(
    snapshot,
    (s) => {
      setEditing(null);
      setMeta(s.meta);
      setNodes(s.nodes);
      setEdges(s.edges);
    },
    (direction, selection) => onHistoryStep.current(direction, selection),
  );

  const latest = useRef({ meta, nodes, edges, slug });
  useLayoutEffect(() => {
    latest.current = { meta, nodes, edges, slug };
  });
  const lastSaved = useRef(loadedJson);
  const saveBaseline = useRef(originalJson);
  const copyCallback = useRef(onExampleCopy);
  useLayoutEffect(() => {
    copyCallback.current = onExampleCopy;
  });
  const copiedExample = useRef<{ slug: string; identity: string } | null>(null);
  const exampleCopyFailed = useRef(false);
  /** Returns whether the diagram differs from its original, or undefined when there was nothing to write. */
  const flushSave = useCallback(
    (override?: DiagramFile): boolean | undefined => {
      if (readOnly) return undefined;
      const { meta, nodes, edges, slug } = latest.current;
      let d = override ?? fromFlow(meta, nodes, edges);
      let json = JSON.stringify(d);
      if (json === lastSaved.current) return undefined;
      const mod = json !== saveBaseline.current;
      // Only the editable app promotes examples; embeds and exported viewers never save.
      if (mod && identity && copyCallback.current && !copiedExample.current) {
        try {
          const copy = copyEditedExample(slug, d, identity);
          if (copy) {
            const sourceTitle = d.title;
            const canvasTitle = sourceTitle.trim() ? copy.title : sourceTitle;
            renameHistoryTitle(sourceTitle, canvasTitle);
            copiedExample.current = { slug: copy.slug, identity: getDiagramIdentity(copy.slug) };
            saveBaseline.current = JSON.stringify({ ...d, title: copy.title });
            d = { ...d, title: canvasTitle };
            json = JSON.stringify(d);
            latest.current = { ...latest.current, slug: copy.slug, meta: toFlow(d).meta };
            setMeta((current) => ({ ...current, title: canvasTitle }));
            copyCallback.current(slug, copy.slug, original.title);
          }
        } catch {
          if (!exampleCopyFailed.current) notify(tr("library.storageFull"), { kind: "error" });
          exampleCopyFailed.current = true;
          return mod;
        }
      }
      const destination = copiedExample.current?.slug ?? slug;
      if (writeAutosave(destination, mod ? d : null, copiedExample.current?.identity ?? identity))
        lastSaved.current = json;
      return mod;
    },
    [readOnly, identity, renameHistoryTitle, original.title],
  );
  const firstExampleEdit = onExampleCopy !== undefined;
  const saveRevision = history.stateKey;

  // Fit-view keeps content out from under the title card, minimap, controls and live bar.
  const fitView_ = useOverlayFit(wrapper, { style: edgeStyle, direction: meta.direction ?? "LR" });
  const { request: afterMeasured, enqueue: afterMeasuredCommand } = useMeasuredTask(wrapper, nodes, edges);
  const firstFit = useRef(false);
  /** True while the view is a fit (the whole diagram in view), false once the user pans or zooms. */
  const showingAll = useRef(true);
  const overlayFit = useCallback(
    (o?: Parameters<typeof fitView_>[0]) => {
      const runFit = () => {
        showingAll.current = true;
        firstFit.current = true;
        return fitView_(o);
      };
      afterMeasured(() => {
        // The reset row belongs to this edit's chrome, not the later debounced storage write.
        const mod = flushSave();
        if (mod !== undefined && mod !== modified) {
          setModified(mod);
          afterMeasured(runFit);
          return;
        }
        return runFit();
      });
    },
    [afterMeasured, fitView_, flushSave, modified],
  );
  const fit = useCallback(() => overlayFit({ maxZoom: 1.25, duration: 300 }), [overlayFit]);
  // Privacy: the diagram's provenance (Private switch, local-only example), re-read when the library changes.
  const privacyFlags = usePrivacyFlags(slug);
  const privacyNow = () => privacyOf({ ...privacyFlags, editor: { getDiagram: () => fromFlow(meta, nodes, edges) } });
  const editor = useEditor({
    slug,
    isPrivate: () => privacyNow() !== null,
    makePrivate: () => {
      if (setDiagramPrivate(slug, true)) {
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
    afterMeasured: afterMeasuredCommand,
    nodeSize: getNodeVariant(nodeVariant).size,
    // Zoom to selection: never past 125% (no huge single node), clear of the panels.
    zoomTo: (only, onlyEdges) => fitView_({ only, onlyEdges, maxZoom: 1.25, margin: 64, duration: 300 }),
    hovered: () => hovered.current,
    reveal: () => revealSelection(),
    nameNew: (make, fallback) => nameNew.current(make, fallback),
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
    documentId: getDiagramIdentity(slug),
    revision: hostRevision,
  });

  const renameHistoryTitle = history.renameTitle;

  // ---------------------------------------------------------------- autosave
  // Debounced while editing, and flushed whenever the canvas could go away before the timer fires:
  // on unmount (switching diagrams), on page hide (reload, close, navigation) and when the tab is
  // hidden (mobile browsers may discard it). Writes the latest state, never a stale closure, and
  // drops the save again once the diagram matches the original.
  useEffect(() => {
    if (readOnly) return;
    const t = setTimeout(
      () => {
        const mod = flushSave();
        if (mod !== undefined) setModified(mod);
      },
      firstExampleEdit && !exampleCopyFailed.current ? 0 : 300,
    );
    return () => clearTimeout(t);
  }, [saveRevision, readOnly, flushSave, firstExampleEdit]);
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
      releaseExampleSaveTarget(latest.current.slug);
    };
  }, [readOnly, flushSave]);

  // Release after the unmount flush: promotion still needs this tab's conversation snapshot.
  const conversationIdentity = initial ? undefined : getDiagramIdentity(slug);
  useEffect(
    () => (conversationIdentity ? retainConversation(conversationIdentity) : undefined),
    [conversationIdentity],
  );

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

  // Opening and mode changes share one fit, after the pane and floating chrome measure.
  useEffect(() => {
    overlayFit({
      maxZoom: (presenting ? FIT_PRESENT : FIT).maxZoom,
      margin: presenting ? 64 : 40,
      insets: live ? { bottom: LIVE_BAR_SPACE } : undefined,
      duration: firstFit.current ? 350 : 0,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a fit request on opening or mode changes only
  }, [presenting, live]);
  const fullscreen = useFullscreen();
  const lastFullscreen = useRef(fullscreen);
  useEffect(() => {
    if (lastFullscreen.current === fullscreen) return;
    lastFullscreen.current = fullscreen;
    if (!presenting || !showingAll.current) return;
    overlayFit({
      maxZoom: FIT_PRESENT.maxZoom,
      margin: 64,
      insets: live ? { bottom: LIVE_BAR_SPACE } : undefined,
      duration: 350,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refit when full screen changes only
  }, [fullscreen]);
  // The title card folds to a chip while nodes sit under it, so it never hides the diagram.
  const card = useRef<HTMLDivElement>(null);
  const cardCovers = useCovered(card, wrapper);
  const checksTop = useBelow(card, checksOn && checksCard);
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
    overlayFit({ maxZoom: FIT.maxZoom, duration: 350 });
  };

  // Editing gestures (D4, D5): a drag on empty canvas draws the selection box, the wheel pans, and
  // Space+drag or the middle button pan. Live view, presentation and embeds keep drag-to-pan.
  const editGestures = !readOnly && !live && !presenting;
  // Live's property sheet remains editable; its other gesture gates stay separate.

  // New edges float (sides picked from geometry); pin a side from the menu or inspector.
  const onConnect = useCallback((c: Connection) => void editor.connect(c.source, c.target), [editor]);
  const isValidConnection: IsValidConnection<DiagramFlowEdge> = useCallback((c) => c.source !== c.target, []);

  /**
   * Brings the selection into view (a pan, never a zoom) once React Flow has measured it, clear of the
   * floating chrome (minimap, controls, hint), then runs `then`: a copy, a paste or a node added from a
   * dropped connection may land off screen, under the inspector its selection opens, or under the
   * minimap. `roomBelow` keeps space for what hangs under the card (its label editor): screen px up to 100%
   * zoom (the editor never reads smaller than its CSS size), growing with the zoom above it.
   */
  const keepInView = useRef<() => Viewport | null>(() => null);
  const revealSelection = useCallback(
    (then?: () => void, roomBelow = 0) => {
      /** The reveal from `from` (where keep-in-view's pan lands, else the view now), or null. */
      const clearOfChrome = (from: Viewport | null): Viewport | null => {
        const el = wrapper.current;
        if (!el) return null;
        const s = store.getState();
        const [tx, ty] = s.transform;
        const base = from ?? { x: tx, y: ty, zoom: s.transform[2] };
        const k = base.zoom;
        // What hangs below, in flow px.
        const below = (roomBelow * Math.max(1, k)) / k;
        const sel = union(
          [...s.nodeLookup.values()]
            .filter((n) => n.selected && !n.hidden && n.measured?.width)
            .map((n) => ({
              x: n.internals.positionAbsolute.x,
              y: n.internals.positionAbsolute.y,
              width: n.measured?.width ?? 0,
              height: (n.measured?.height ?? 0) + below,
            })),
        );
        if (!sel) return null;
        // The same reveal as keyboard focus (revealFocused).
        return revealPan(el, base, sel);
      };
      let frames = 30;
      const step = () => {
        const waiting = getNodes().some((n) => n.selected && !n.measured?.width);
        if (waiting && --frames > 0) return void requestAnimationFrame(step);
        // The editor opens at once (keys typed next belong to it); the view follows meanwhile, clearing
        // the chrome once keep-in-view's own pan has landed. Worked out from where that pan lands, not
        // from the view mid-way (a busy frame can still be animating it then).
        then?.();
        const kept = keepInView.current();
        const next = clearOfChrome(kept);
        if (!next) return;
        const go = () => void setViewport(next, { duration: motionMs(200) });
        if (kept) setTimeout(go, motionMs(250) + 30);
        else go();
      };
      requestAnimationFrame(step);
    },
    [getNodes, setViewport, store],
  );

  /**
   * Names a node, connection or boundary in the inspector (the owner's decision, 2026-10-13: no renaming in
   * place): it's selected alone, the inspector opens, and its Label takes focus with all of it selected, so
   * typing replaces it. A name typed before the field could take it is written and the caret goes after it.
   */
  const renameIn = useCallback(
    (t: RenameTarget) => {
      if (!canOpenInspector) return;
      setEditing(null);
      editor.select(
        t.kind === "node" ? { nodeIds: [t.id] } : t.kind === "edge" ? { edgeIds: [t.id] } : { groupIds: [t.id] },
      );
      setNaming(t.kind === "node" && t.edge ? { node: t.id, edge: t.edge } : null);
      const typed = t.kind === "node" && t.text !== undefined;
      if (typed) editor.updateNode(t.id, { label: t.text }, { merge: editor.creating(t.id) });
      openInspector(
        t.kind === "node" && t.field === "sublabel" ? "sublabel" : "label",
        typed ? "end" : undefined,
        t.kind === "group" ? GROUP_PREFIX + t.id : t.id,
      );
    },
    [canOpenInspector, editor, openInspector],
  );
  useLayoutEffect(() => {
    rename.current = renameIn;
  });

  /**
   * A node made by quick-add (a dropped connection, Alt+arrow, the "+", a double-click on the canvas) or
   * Alt+Shift+arrow: in view, then its name in the inspector, selected (decision 3), so typing names it. Keys
   * typed meanwhile are kept for it (React Flow measures the card before showing it).
   */
  const endCreation = history.end;
  const pickNamed = useCallback(
    (make: () => NewNode | null, fallback: string) => {
      // Hold what's typed from now until the label editor can take it.
      const typing = captureTypeAhead();
      const made = make();
      if (!made) return void typing.stop();
      revealSelection(() => {
        const typed = typing.stop();
        if (typed.done === "escape") return endCreation(made.merge);
        if (typed.done === "enter") {
          if (typed.text !== null)
            editor.updateNode(made.id, { label: typed.text.trim() || fallback }, { merge: made.merge });
          return endCreation(made.merge);
        }
        // In this same task: a key arriving before the field has focus would reach the canvas instead.
        flushSync(() =>
          editor.startEditing({
            kind: "node",
            id: made.id,
            text: typed.text ?? undefined,
            edge: made.edge ?? undefined,
          }),
        );
      }, 90);
    },
    [editor, revealSelection, endCreation],
  );

  /** For the editor's `nameNew` (menus and Ctrl+K: Insert node on an edge). */
  const nameNew = useRef(pickNamed);
  useLayoutEffect(() => {
    nameNew.current = pickNamed;
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
      const room = (QUICK_ADD_W + 16) / k;
      const menuLeft = dir === "left";
      const card = {
        x: from.position.x,
        y: from.position.y,
        width: from.measured?.width ?? spot.width,
        height: from.measured?.height ?? spot.height,
      };
      const want = union([card, { ...spot, x: menuLeft ? spot.x - room : spot.x, width: spot.width + room }]) ?? spot;
      const view = { x: 24, y: 24, width: r.width - 48, height: r.height - 48 };
      const next = panIntoView(want, spot, { x: tx, y: ty, zoom: k }, view);
      if (next) void setViewport(next, { duration: motionMs(200) });
      const v = next ?? { x: tx, y: ty, zoom: k };
      const sx = r.left + spot.x * k + v.x;
      const sy = r.top + spot.y * k + v.y;
      const right = sx + spot.width * k + 8;
      landing.set(spot);
      setMenu({
        alignment: "physical-left",
        x: menuLeft ? sx - 8 - QUICK_ADD_W : right,
        flipX: sx - 8,
        y: sy,
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
    [readOnly, live, presenting, meta.direction, editor, getNode, hideTip, store, setViewport, pickNamed],
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
  /**
   * A check's row or chip: selects the nodes and connections it names and brings them into view with the one
   * reveal (revealPan), clear of the Checks card and the other floating chrome.
   */
  const revealIds = useCallback(
    (ids: readonly string[]) => {
      // From React Flow's lookups: one finding may name thousands of things, and the editor's getNode/getEdge
      // each rebuild the file.
      const st = store.getState();
      const nodeIds = ids.filter((id) => st.nodeLookup.get(id)?.type === "diagram");
      const edgeIds = ids.filter((id) => st.edgeLookup.has(id));
      editor.select({ nodeIds, edgeIds, groupIds: [] });
      requestAnimationFrame(() => {
        const el = wrapper.current;
        if (!el) return;
        const now = store.getState();
        const ends = edgeIds.flatMap((id) => {
          const e = now.edgeLookup.get(id);
          return e ? [e.source, e.target] : [];
        });
        const boxes = [...nodeIds, ...ends]
          .map((id) => now.nodeLookup.get(id))
          .filter((n) => !!n && !n.hidden && n.measured?.width)
          .map((n) => ({
            x: n!.internals.positionAbsolute.x,
            y: n!.internals.positionAbsolute.y,
            width: n!.measured!.width!,
            height: n!.measured!.height ?? 0,
          }));
        const want = union(boxes);
        if (!want) return;
        const [x, y, zoom] = now.transform;
        const next = revealPan(el, { x, y, zoom }, want);
        if (next) void setViewport(next, { duration: motionMs(250) });
      });
    },
    [editor, store, setViewport],
  );
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

  // ---------------------------------------------------------------- selection box (D5)
  // React Flow's own box picks only whole nodes and every edge they touch. Ours picks what it touches
  // (Ctrl/Cmd held: only what's wholly inside), boundaries and zones only when wholly inside, and the
  // edges whose both ends it picked. React Flow's selection changes are dropped while a box is drawn.
  const contain = useRef(false);
  /** Shift held as the box started: what was selected then stays selected (Shift adds, as Shift+click does). */
  const boxBase = useRef<{ nodes: ReadonlySet<string>; edges: ReadonlySet<string> } | null>(null);
  const boxPicked = useRef<string | null>(null);
  const boxSet = useRef<Set<string> | null>(null);
  /**
   * Sets the box's pick on the app's nodes. React Flow's own box code flips the selected flag on its
   * internal copies before emitting the changes we drop, and keeps an internal copy as long as the app's
   * node object is the same. `stale` (ids whose internal flag disagrees) get a fresh object, so React
   * Flow re-reads them from the app's state and both agree.
   */
  const applyBoxPick = useCallback(
    (set: ReadonlySet<string>, stale: ReadonlySet<string>) =>
      setNodes((ns) =>
        ns.map((n) => (!!n.selected === set.has(n.id) && !stale.has(n.id) ? n : { ...n, selected: set.has(n.id) })),
      ),
    [setNodes],
  );
  useEffect(() => {
    if (!editGestures) return;
    return store.subscribe((s, prev) => {
      if (!s.userSelectionActive || !s.userSelectionRect) {
        if (prev.userSelectionActive && !s.userSelectionActive) {
          // React Flow's last pick may have flipped its own flags after ours: one source of truth.
          const set = boxSet.current;
          if (set) {
            const stale = staleBoxFlags(s, set);
            if (stale.size) applyBoxPick(set, stale);
          }
          boxSet.current = null;
          boxBase.current = null;
          // React Flow shows its multi-selection frame (drag it, right-click it) from its own pick, which
          // it sets after this; follow ours instead: the combined selection, so a Shift-drag that adds nothing
          // keeps the frame of what was already selected.
          const any = set ? set.size > 0 : !!boxPicked.current;
          queueMicrotask(() => store.setState({ nodesSelectionActive: any }));
        }
        boxPicked.current = null;
        return;
      }
      if (s.userSelectionRect === prev.userSelectionRect && prev.userSelectionActive) return;
      const r = s.userSelectionRect;
      const [tx, ty, k] = s.transform;
      const box = { x: (r.x - tx) / k, y: (r.y - ty) / k, width: r.width / k, height: r.height / k };
      const items: BoxItem[] = [];
      for (const n of s.nodeLookup.values()) {
        const w = n.measured?.width ?? n.width ?? 0;
        const h = n.measured?.height ?? n.height ?? 0;
        if (n.hidden || n.selectable === false || !w || !h) continue;
        const backdrop =
          n.type === "boundary" || (n.type === "annotation" && (n as AnnotationFlowNode).data.kind === "zone");
        items.push({ id: n.id, ...n.internals.positionAbsolute, width: w, height: h, backdrop });
      }
      const base = boxBase.current;
      const picked = pickInBox(items, box, contain.current);
      const key = picked.join(" ");
      const set = new Set(base ? [...base.nodes, ...picked] : picked);
      const stale = staleBoxFlags(s, set);
      if (key === boxPicked.current && !stale.size) return;
      const pickChanged = key !== boxPicked.current;
      boxPicked.current = key;
      boxSet.current = set;
      applyBoxPick(set, stale);
      if (!pickChanged) return;
      const hiddenDeps = !dependencyVisibility.get();
      const edgeSet = edgesBetween(
        s.edges.filter((e) => !(hiddenDeps && isDependency(e.data))),
        set,
      );
      if (base) for (const id of base.edges) edgeSet.add(id);
      // The same array when no edge's flag changes: the routes and their caches stay as they are.
      setEdges((es) => {
        let changed = false;
        const next = es.map((e) => {
          if (!!e.selected === edgeSet.has(e.id)) return e;
          changed = true;
          return { ...e, selected: edgeSet.has(e.id) };
        });
        return changed ? next : es;
      });
    });
  }, [editGestures, store, setNodes, setEdges, applyBoxPick]);

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
      let next = changes;
      if (store.getState().userSelectionActive) next = next.filter((c) => c.type !== "select");
      const copies = altCopies.current;
      if (copies)
        next = next.map((c) => (c.type === "position" && copies.has(c.id) ? { ...c, id: copies.get(c.id)! } : c));
      // While dragging: snapped to guides, equal gaps or the grid, with boundary members following.
      next = guides.filter(next);
      if (next.length) onNodesChange(next);
    },
    [store, onNodesChange, guides],
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
      dragActive.current = true;
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
    [hideTip, editGestures, editor, guides, store, watchInsert, watchMembership],
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
    [editor, guides, editGestures, sayLeft, droppedNodes],
  );

  // ---------------------------------------------------------------- Space, Alt and the middle button (D4, D9)
  // Space held: a drag pans from anywhere, even starting on a node (nodes don't drag meanwhile), with a
  // grab cursor. Alt held over a selected node: the copy cursor (Alt-drag duplicates).
  const [spaceHeld, setSpaceHeld] = useState(false);
  useEffect(() => {
    const wrap = wrapper.current;
    if (!editGestures || !wrap) return;
    const setSpace = (on: boolean) => {
      wrap.classList.toggle("is-space-pan", on);
      setSpaceHeld(on);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Alt") wrap.classList.toggle("is-alt", e.type === "keydown");
      if (e.code !== "Space") return;
      if (e.type === "keyup") return setSpace(false);
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isEditableTarget(e.target)) return;
      if (!(e.target === document.body || inCanvas(e.target))) return;
      // Not a page scroll, and not a key press on a focused node.
      e.preventDefault();
      setSpace(true);
    };
    const reset = () => {
      wrap.classList.remove("is-alt");
      setSpace(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", reset);
      reset();
    };
  }, [editGestures]);

  // The middle button pans (everywhere); it never starts the browser's autoscroll.
  useEffect(() => {
    const wrap = wrapper.current;
    const noAutoscroll = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };
    wrap?.addEventListener("mousedown", noAutoscroll);
    return () => wrap?.removeEventListener("mousedown", noAutoscroll);
  }, []);

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
  /** Text isn't a routing obstacle: one that grew over a node or edge moves clear (undoable, said so). */
  const settleText = useCallback(
    (id: string, before: XYBox) => {
      // Once the edit (and any growth it caused) has rendered.
      setTimeout(() => {
        const hit = editor.keepTextClear(id, before);
        if (hit)
          notify(hit === "node" ? tr("chrome.movedTheTextOffANode") : tr("chrome.movedTheTextOffAnEdge"), {
            action: {
              get label() {
                return tr("ai.undo");
              },
              run: editor.undo,
              testId: "text-moved-undo",
              undoes: true,
            },
          });
      }, 60);
    },
    [editor],
  );
  /** A boundary resized by hand adopts the nodes now inside it and releases those outside (D12), and says so. */
  const boundaryResized = useCallback(
    (groupId: string) =>
      // Once the resize's last size has landed.
      requestAnimationFrame(() => {
        const { adopted, released } = editor.adoptAfterResize(groupId);
        if (!adopted.length && !released.length) return;
        const name = editor.getGroup(groupId)?.label || tr("chrome.theBoundary");
        const text = !released.length
          ? tr("chrome.addedValueOtherValueNodesToValue", { count: adopted.length, name })
          : !adopted.length
            ? tr("chrome.tookValueOtherValueNodesOutOfValue", { count: released.length, name })
            : tr("chrome.addedValueOtherValueNodesToValueAndTookValue", {
                count: adopted.length,
                name,
                released: released.length,
              });
        notify(text, {
          action: {
            get label() {
              return tr("ai.undo");
            },
            run: editor.undo,
            testId: "membership-undo",
            undoes: true,
          },
        });
      }),
    [editor],
  );
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
  const diagramNodes = useMemo(() => nodes.filter(isDiagramNode), [nodes]);
  const groupNodes = useMemo(() => nodes.filter(isGroupNode), [nodes]);
  const annotationNodes = useMemo(() => nodes.filter(isAnnotationNode), [nodes]);
  const selectedNodes = useMemo(() => diagramNodes.filter((n) => n.selected), [diagramNodes]);
  const selectedAnnotations = useMemo(() => annotationNodes.filter((n) => n.selected), [annotationNodes]);
  const selectedGroups = useMemo(() => groupNodes.filter((n) => n.selected), [groupNodes]);
  const selectedEdges = useMemo(() => edges.filter((e) => e.selected), [edges]);
  const nothingSelected =
    !selectedNodes.length && !selectedGroups.length && !selectedEdges.length && !selectedAnnotations.length;
  // A single selected node or connection with findings shows them at the top of its inspector, with the fix.
  const soleId =
    selectedNodes.length + selectedGroups.length + selectedEdges.length + selectedAnnotations.length === 1
      ? (selectedNodes[0]?.id ?? selectedEdges[0]?.id)
      : undefined;
  const inspectorFindings =
    soleId && checksOn ? <SelectionFindings store={checks} id={soleId} host={checksHost} /> : undefined;
  // Below ROOMY an open AI panel folds the stencils to their rail too, as live view does: at 1440 the
  // dock, the stencils and the inspector's rail left the diagram 780 px.
  const paletteHidden = paletteCollapsed || ((live || (narrow && aiDockOpen)) && !openedByHand.palette);
  // The inspector waits for pointer-up (D5). Below 1680 px it opens with a selection and narrows the
  // canvas: opening it under a drag (a box being drawn, a node being moved) would shift the canvas under
  // the pointer. It follows `settledEmpty`, the selection as of the last pointer-up. A press costs no
  // render (a ref); keys, undo and menus change it at once.
  const pointerHeld = useRef(false);
  const latestEmpty = useRef(nothingSelected);
  const [settledEmpty, setSettledEmpty] = useState(nothingSelected);
  useLayoutEffect(() => {
    latestEmpty.current = nothingSelected;
    if (!pointerHeld.current && settledEmpty !== nothingSelected) setSettledEmpty(nothingSelected);
  }, [nothingSelected, settledEmpty]);
  useEffect(() => {
    const wrap = wrapper.current;
    if (!editGestures || !wrap) return;
    const hold = (e: MouseEvent) => {
      if (e.button !== 0) return;
      pointerHeld.current = true;
      const up = () => {
        pointerHeld.current = false;
        // After the drop has painted: the inspector opening is its own frame, not the pointer-up's.
        requestAnimationFrame(() =>
          setTimeout(() => {
            // A new drag may have begun before the previous drop's frame gets to run.
            if (!pointerHeld.current) setSettledEmpty(latestEmpty.current);
          }, 0),
        );
        window.removeEventListener("pointerup", up, true);
        window.removeEventListener("pointercancel", up, true);
      };
      window.addEventListener("pointerup", up, true);
      window.addEventListener("pointercancel", up, true);
    };
    wrap.addEventListener("mousedown", hold, true);
    return () => wrap.removeEventListener("mousedown", hold, true);
  }, [editGestures]);
  const inspectorHidden =
    livePanelOpen ||
    !prefs.inspector ||
    ((live || (narrow && settledEmpty) || (cramped && aiDockOpen)) && !openedByHand.inspector);
  // Below ROOMY the inspector opens with a selection and narrows the canvas: keep the selection
  // and its edges in view (a pan, never a zoom), once the pane has its new size.
  const keepSelectionInView = useKeepSelectionInView(wrapper, { style: edgeStyle, direction: meta.direction ?? "LR" });
  useLayoutEffect(() => {
    keepInView.current = keepSelectionInView;
  });
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
    overlayFit({ maxZoom: FIT.maxZoom, margin: 40, duration: 250 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when a side panel opens or closes
  }, [panelsKey]);
  // The Checks card opened over a diagram that was all in view: refit it clear of the card (the card is floating
  // chrome, data-canvas-overlay), once the card has drawn. A view the user panned or zoomed stays put.
  const checksMounted = () => {
    if (!showingAll.current || live || presenting) return;
    overlayFit({ maxZoom: FIT.maxZoom, margin: 40, duration: 250 });
  };
  // The AI panel opened, closed or was resized by more than a little: the pane changed size at its
  // right edge. A fit is refitted to the new pane; a view the user panned or zoomed keeps the selection
  // (or, with none, the diagram's centre) in view with a pan.
  const dockKey = `${aiDock.open}:${aiDock.open ? Math.round(aiDock.width / 40) : 0}`;
  const lastDock = useRef(dockKey);
  useEffect(() => {
    if (lastDock.current === dockKey) return;
    lastDock.current = dockKey;
    // Live view refits around its own chrome (the trace card, a side panel): see LiveView.
    if (presenting || live) return;
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
  // With exactly one node selected, a rail click adds after it, connected, as Ctrl+K does (decision 4).
  // Live view adds a node by itself, as before: nothing gets wired mid-run.
  const addFromPalette = useCallback(
    (id: string) => void (live ? editor.addNode(id) : editor.addStencil(id)),
    [editor, live],
  );
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
  // ---------------------------------------------------------------- keyboard selection between nodes (D14)
  // The canvas is one Tab stop: the node last focused (else the first in reading order) is the one in the page's
  // Tab order. Inside, Tab and Shift+Tab step through nodes in reading order, Ctrl+Alt+arrows go to the nearest
  // node that way, and Ctrl+Alt+] / [ to a node's outgoing and incoming edges. Selection and focus move
  // together, the view follows, and a polite live region names what's selected.
  const [focusId, setFocusId] = useState<string | undefined>();
  /** The node keyboard selection is focusing: it brings it into view itself (revealSelection). */
  const navFocus = useRef<string | undefined>(undefined);
  /**
   * Keyboard focus that lands on a node out of view or under the chrome (Tab into the canvas, a screen reader's
   * focus) brings it into view with a pan: the same reveal as a new selection (revealPan). The canvas can't
   * scroll (overflow: clip in canvas.css), and React Flow's own pan on focus only moves for a node wholly
   * outside the pane. A boundary too big for the pane keeps its name in view.
   */
  const revealFocused = useRef((_id: string, _target: HTMLElement) => {});
  useLayoutEffect(() => {
    revealFocused.current = (id, target) => {
      const el = wrapper.current;
      const s = store.getState();
      const n = s.nodeLookup.get(id);
      if (!el || !n) return;
      const width = n.measured?.width ?? n.width ?? 0;
      const height = n.measured?.height ?? n.height ?? 0;
      if (!width || !height) return;
      const card = { x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, width, height };
      const [tx, ty, k] = s.transform;
      const pane = el.getBoundingClientRect();
      // A boundary's name, else the card's top-left corner: what has to show when the whole can't.
      const label = target.querySelector('[data-testid^="group-label-"]')?.getBoundingClientRect();
      const must = label
        ? {
            x: (label.left - pane.left - tx) / k,
            y: (label.top - pane.top - ty) / k,
            width: label.width / k,
            height: label.height / k,
          }
        : { ...card, width: Math.min(width, 240), height: Math.min(height, 48) };
      const next = revealPan(el, { x: tx, y: ty, zoom: k }, card, must);
      if (next) void setViewport(next, { duration: motionMs(200) });
    };
  });
  useEffect(() => {
    const wrap = wrapper.current;
    if (!wrap) return;
    const onFocus = (e: FocusEvent) => {
      const id = e.target instanceof Element ? e.target.closest(".react-flow__node")?.getAttribute("data-id") : null;
      if (!id) return;
      setFocusId(id);
      const own = navFocus.current === id;
      // The node itself, by keyboard (a click is on a node in view; an editor inside it isn't the node).
      const node = e.target instanceof HTMLElement && e.target.classList.contains("react-flow__node");
      if (!own && node && (e.target as HTMLElement).matches(":focus-visible"))
        revealFocused.current(id, e.target as HTMLElement);
    };
    wrap.addEventListener("focusin", onFocus);
    return () => wrap.removeEventListener("focusin", onFocus);
  }, []);
  const { width: nominalW, height: nominalH } = getNodeVariant(nodeVariant).size;
  const navBox = useCallback(
    (n: FlowNode): NavBox => ({
      id: n.id,
      x: n.position.x,
      y: n.position.y,
      width: n.measured?.width ?? n.width ?? nominalW,
      height: n.measured?.height ?? n.height ?? nominalH,
    }),
    [nominalW, nominalH],
  );
  /** Tab's order: reading order, each boundary just before its first member, an empty one where it reads. */
  const navOrder = useCallback(
    (ns: readonly FlowNode[]) =>
      tabOrder(
        ns.filter((n) => !isGroupNode(n)).map(navBox),
        ns.filter(isGroupNode).map((g) => ({
          ...navBox(g),
          members: ns.filter((m) => m.data.group === g.data.groupId).map((m) => m.id),
        })),
        direction,
      ),
    [navBox, direction],
  );
  const rovingId = useMemo(() => {
    if (readOnly) return undefined;
    if (focusId && nodes.some((n) => n.id === focusId && !n.hidden)) return focusId;
    // The first thing Tab would meet, a boundary included: a diagram of boundaries only is still reachable.
    return navOrder(nodes.filter((n) => !n.hidden))[0];
  }, [readOnly, focusId, nodes, navOrder]);
  // Accessible names follow renames (React Flow names focusable nodes / edges from ariaLabel).
  // Only one node is in the page's Tab order (see above).
  const ariaNodes = useMemo(
    () => (readOnly ? withNodeAria(nodes) : withRovingFocus(withNodeAria(nodes), rovingId)),
    [nodes, readOnly, rovingId],
  );
  /** What the live region says (seq: the same words again are read again). */
  const [announcement, setAnnouncement] = useState({ text: "", seq: 0 });
  const announce = useCallback((text: string) => setAnnouncement((a) => ({ text, seq: a.seq + 1 })), []);
  useLayoutEffect(() => {
    navigate.current = (step, from) => {
      const ns = getNodes().filter((n) => !n.hidden);
      const es = store.getState().edges.filter((e) => !e.hidden);
      const el = from instanceof Element ? from : null;
      const focusedNode = stepping.current ?? el?.closest(".react-flow__node")?.getAttribute("data-id") ?? undefined;
      const focusedEdge = el?.closest(".react-flow__edge")?.getAttribute("data-id") ?? undefined;
      const sel = editor.getSelection();
      const selectedFlowIds = [...sel.nodeIds, ...sel.groupIds.map((g) => GROUP_PREFIX + g)];
      const current = focusedNode ?? (!focusedEdge && selectedFlowIds.length === 1 ? selectedFlowIds[0] : undefined);
      const labelOf = (id: string) => {
        const n = ns.find((x) => x.id === id);
        if (!n) return id;
        if (isDiagramNode(n)) return n.data.label || n.id;
        if (isAnnotationNode(n)) return annotationTitle(n.data);
        return (n as GroupFlowNode).data.label || tr("chrome.untitledBoundary");
      };
      const order = navOrder(ns);

      const goNode = (id: string) => {
        const n = ns.find((x) => x.id === id);
        if (!n) return false;
        if (isGroupNode(n)) editor.select({ groupIds: [n.data.groupId] });
        else editor.select({ nodeIds: [id] });
        setFocusId(id);
        stepping.current = id;
        requestAnimationFrame(() => {
          if (stepping.current === id) stepping.current = undefined;
          // Focus events fire inside focus(): the flag covers exactly this one.
          navFocus.current = id;
          wrapper.current
            ?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`)
            ?.focus({ preventScroll: true });
          navFocus.current = undefined;
        });
        revealSelection();
        const at = `${order.indexOf(id) + 1} of ${order.length}`;
        if (isDiagramNode(n)) {
          const outs = es.filter((e) => e.source === id).length;
          const ins = es.filter((e) => e.target === id).length;
          const inGroup = n.data.group ? editor.getGroup(n.data.group)?.label : undefined;
          const edges = outs + ins ? `${outs} out, ${ins} in` : "no connections";
          // Hidden dependencies show as pips, whose list opens on the focused node: say it too.
          const pips = dependencyVisibility.get() ? [] : (pipsByNode(store.getState().edges).get(id) ?? []);
          const deps = pips.length
            ? ` Dependencies: ${pips.map((r) => `${RELATION_META[r.relation].label} · ${labelOf(r.target)}`).join(", ")}.`
            : "";
          announce(`${nodeAriaLabel(n.data)}${inGroup ? `, in ${inGroup}` : ""}. ${at}. ${edges}.${deps}`);
        } else if (isAnnotationNode(n)) announce(`${annotationAriaLabel(n.data)}. ${at}.`);
        else {
          const members = ns.filter(
            (m) => (isDiagramNode(m) || isAnnotationNode(m)) && m.data.group === (n as GroupFlowNode).data.groupId,
          );
          announce(`${labelOf(id)}, boundary, ${members.length === 1 ? "1 node" : `${members.length} nodes`}. ${at}.`);
        }
        return true;
      };

      if (step === "next" || step === "prev") {
        // From an edge, the order goes on from its source.
        const start = current ?? (focusedEdge ? es.find((e) => e.id === focusedEdge)?.source : undefined);
        if (!start && el?.matches('[data-testid="canvas-wrap"]') === false) return false;
        const next = start ? stepInOrder(order, start, step === "prev") : (rovingId ?? order[0]);
        return next ? goNode(next) : false;
      }

      if (step === "edge-out" || step === "edge-in") {
        // From a node: its first outgoing (or incoming) edge; again from that edge: the node's next one.
        const edge = focusedEdge ? es.find((e) => e.id === focusedEdge) : undefined;
        const out = step === "edge-out";
        const anchor = edge ? (out ? edge.source : edge.target) : current;
        if (!anchor || anchor.startsWith(GROUP_PREFIX)) return false;
        const pos = new Map(order.map((id, i) => [id, i]));
        const list = es
          .filter((e) => (out ? e.source : e.target) === anchor)
          .sort((a, b) => (pos.get(out ? a.target : a.source) ?? 0) - (pos.get(out ? b.target : b.source) ?? 0));
        if (!list.length) {
          announce(`${labelOf(anchor)} has no ${out ? "outgoing" : "incoming"} edges.`);
          return false;
        }
        const i = edge ? list.findIndex((e) => e.id === edge.id) : -1;
        const e = list[(i + 1) % list.length];
        editor.select({ edgeIds: [e.id] });
        requestAnimationFrame(() =>
          wrapper.current
            ?.querySelector<SVGElement>(`.react-flow__edge[data-id="${CSS.escape(e.id)}"]`)
            ?.focus({ preventScroll: true }),
        );
        revealSelection();
        const said = edgeAriaLabel(
          labelOf(e.source),
          labelOf(e.target),
          e.data?.kind,
          e.data?.label,
          e.data?.relation,
          isDenyRule(e.data?.props),
        );
        const settings = settingsSummary(edgeSettings(e.data));
        announce(
          `${said}.${settings ? ` ${settings}.` : ""} ${out ? "Outgoing" : "Incoming"} ${list.indexOf(e) + 1} of ${list.length}.`,
        );
        return true;
      }

      // Ctrl+Alt+arrows: the nearest node that way (boundaries and zones are backdrops, not stops).
      const stops = ns.filter((n) => !isGroupNode(n) && !(isAnnotationNode(n) && n.data.kind === "zone")).map(navBox);
      let fromBox = current ? stops.find((b) => b.id === current) : undefined;
      if (!fromBox && focusedEdge) {
        // From an edge: halfway along it.
        const e = es.find((x) => x.id === focusedEdge);
        const a = e && stops.find((b) => b.id === e.source);
        const b = e && stops.find((x) => x.id === e.target);
        if (a && b)
          fromBox = {
            id: focusedEdge,
            x: (a.x + a.width / 2 + b.x + b.width / 2) / 2,
            y: (a.y + a.height / 2 + b.y + b.height / 2) / 2,
            width: 0,
            height: 0,
          };
      }
      if (!fromBox) {
        // Nothing selected: the first thing in Tab's order (a boundary, when there are only boundaries).
        const first = readingOrder(stops, direction)[0]?.id ?? order[0];
        return first ? goNode(first) : false;
      }
      const to = nearestInDirection(fromBox, stops, step);
      if (!to) {
        announce(
          `Nothing ${step === "right" ? "to the right" : step === "left" ? "to the left" : step === "up" ? "above" : "below"}.`,
        );
        return false;
      }
      return goNode(to);
    };
  });
  // Undo and Redo select what the step changed (historySelection.ts). From the canvas (focus on a node, an
  // edge or the canvas itself), focus goes with it: onto the first selected node in Tab's order (else the
  // first selected edge, else the canvas, never a node that's gone or no longer selected), revealed and
  // announced. From the toolbar, the inspector or a panel, focus stays put; Tab into the canvas still lands on
  // the selection.
  useLayoutEffect(() => {
    onHistoryStep.current = (direction, selection) => {
      const wrap = wrapper.current;
      const active = document.activeElement;
      const fromCanvas =
        !!wrap &&
        !!active &&
        wrap.contains(active) &&
        (active === wrap || !!active.closest(".react-flow__node, .react-flow__edge"));
      // After React has drawn the restored canvas.
      requestAnimationFrame(() => {
        const ns = getNodes().filter((n) => !n.hidden);
        const picked = new Set(selection.nodes);
        const target = navOrder(ns).find((id) => picked.has(id));
        if (target) setFocusId(target);
        if (!fromCanvas || !wrap) return;
        // Once what's selected is measured (React Flow hides a node until then, and a hidden one can't take
        // focus), and while the view pans to it.
        revealSelection(() => {
          const edge = target ? undefined : selection.edges[0];
          const el = target
            ? wrap.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(target)}"]`)
            : edge
              ? wrap.querySelector<HTMLElement>(`.react-flow__edge[data-id="${CSS.escape(edge)}"]`)
              : null;
          navFocus.current = target;
          el?.focus({ preventScroll: true });
          // An edge that isn't a Tab stop, or nothing to focus: the canvas, not the page.
          if (!el || document.activeElement !== el) wrap.focus({ preventScroll: true });
          navFocus.current = undefined;
          const count = selection.nodes.length + selection.edges.length;
          const only = count === 1 && target ? ns.find((n) => n.id === target) : undefined;
          const name = !only
            ? undefined
            : isDiagramNode(only)
              ? only.data.label || only.id
              : isAnnotationNode(only)
                ? annotationTitle(only.data)
                : (only as GroupFlowNode).data.label || tr("chrome.untitledBoundary");
          const what = !count
            ? tr("chrome.nothingSelected")
            : name
              ? tr("chrome.valueSelected", { name })
              : tr("ai.selected", { count });
          announce(
            direction === "undo"
              ? tr("chrome.undoneValue", { selection: what })
              : tr("chrome.redoneValue", { selection: what }),
          );
        });
      });
    };
  });
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
  const undoTitle = tr("canvas.undoValue", { combo: formatCombo(shortcutKeys("undo")) });
  const redoTitle = tr("canvas.redoValue", { combo: formatCombo(shortcutKeys("redo")) });
  const diagramColor = meta.color ? resolveAnnotationColor(meta.color).hex : undefined;

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
          onPointerDownCapture={(e) => {
            // Shift+drag on empty canvas adds the box's pick to the selection, as Shift+click adds a node.
            const onPane = e.target instanceof Element && e.target.classList.contains("react-flow__pane");
            if (!onPane || e.button !== 0 || !e.shiftKey) return void (boxBase.current = null);
            const { nodes: ns, edges: es } = store.getState();
            boxBase.current = {
              nodes: new Set(ns.filter((n) => n.selected).map((n) => n.id)),
              edges: new Set(es.filter((x) => x.selected).map((x) => x.id)),
            };
          }}
          onPointerMove={(e) => {
            pointer.current = { x: e.clientX, y: e.clientY };
            // Ctrl/Cmd during a box selection: only what's wholly inside.
            contain.current = e.ctrlKey || e.metaKey;
          }}
          onPointerLeave={() => (pointer.current = null)}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(STENCIL_DND_MIME) || e.dataTransfer.types.includes(ANNOTATION_DND_MIME)) {
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
            onMoveStart={(e) => {
              // A pan by hand closes menus; the app's own (a new node brought into view) doesn't: quick-add
              // opened right after naming the last node must stay open while the view settles.
              if (e) setMenu(null);
              hideTip();
              // A pan or zoom by hand (an event), or by a command such as Shift+0 (no event, and not
              // our own fit starting), means the view is the user's now, not a fit.
              if (e || wrapper.current?.dataset.fitPending !== "true") showingAll.current = false;
            }}
            onNodeMouseEnter={(e, node) => {
              hovered.current = node.type === "boundary" ? undefined : node.id;
              if (node.type === "diagram" && !editing)
                showTip(e.currentTarget as Element, {
                  nodeId: node.id,
                  label: node.data.label || node.id,
                  sublabel: node.data.sublabel,
                  stencil: node.data.stencil,
                });
            }}
            onNodeMouseLeave={() => {
              hovered.current = undefined;
              hideTip();
            }}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            colorMode={theme}
            // Bottom-right, lifted above the minimap (canvas.css): never under the live bar or the hint.
            attributionPosition="bottom-right"
            minZoom={0.15}
            maxZoom={2.5}
            snapToGrid={prefs.snap}
            snapGrid={[10, 10]}
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
                  title={tr("chrome.fitViewValue", { combo: formatCombo(shortcutKeys("fit-view")) })}
                  aria-label={tr("menu.fitView")}
                  data-testid="fit-view-button"
                >
                  <Icon name="fit" size={14} />
                </ControlButton>
                <ControlButton
                  onClick={editor.undo}
                  disabled={!history.canUndo}
                  title={undoTitle}
                  aria-label={tr("ai.undo")}
                  data-testid="undo-button"
                >
                  <Icon name="undo" size={14} />
                </ControlButton>
                <ControlButton
                  onClick={editor.redo}
                  disabled={!history.canRedo}
                  title={redoTitle}
                  aria-label={tr("shortcuts.redo")}
                  data-testid="redo-button"
                >
                  <Icon name="redo" size={14} />
                </ControlButton>
                <ControlButton
                  onClick={() => setShortcutsOpen(true)}
                  title={tr("canvas.keyboardShortcuts")}
                  aria-label={tr("shortcuts.title")}
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
                    ? resolveGroupTone((n as GroupFlowNode).data.tone)
                    : n.type === "annotation" && (n as AnnotationFlowNode).data.kind !== "note"
                      ? resolveAnnotationColor(
                          (n as AnnotationFlowNode).data.color,
                          (n as AnnotationFlowNode).data.kind,
                        ).hex
                      : "transparent"
                }
              />
            )}
            {/* Nothing to simulate on a blank canvas: the Live toggle appears with the first node. */}
            {(nodeCount > 0 || live) && (
              <LiveView
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

          <div
            ref={card}
            className={`diagram-card${presenting ? " is-large" : ""}${cardCovers ? " is-compact" : ""}${privacy && !hideChrome ? " has-badge" : ""}`}
            data-testid="diagram-card"
            data-canvas-overlay
            data-collapsed={cardCovers ? "1" : undefined}
            // A blank, untitled diagram is already named in the picker: the card waits for the first node
            // (a private one shows at once, so its lock does).
            hidden={
              nodeCount === 0 &&
              !presenting &&
              (meta.title || UNTITLED) === UNTITLED &&
              !meta.description &&
              !(privacy && !hideChrome)
            }
          >
            {/* The person's own words: their direction is their own, whatever the language around them (dir="auto"). */}
            <h1 data-testid="diagram-title" dir="auto">
              {meta.title}
            </h1>
            {privacy && !hideChrome && <PrivateBadge kind={privacy} />}
            {meta.description && <p dir="auto">{meta.description}</p>}
            {/* Node and edge counts live in the inspector's diagram panel, not here too. */}
            {!hideChrome && (
              <DiagramCardMeta
                store={checks}
                open={checksCard}
                reset={
                  modified &&
                  !ownDiagram && (
                    <button
                      className="link-btn"
                      onClick={reset}
                      data-testid="reset-diagram"
                      title={tr("canvas.discardYourEditsToThisDiagramUndoable")}
                    >
                      <Icon name="reset" size={13} />
                      {tr("canvas.editedReset")}
                    </button>
                  )
                }
              />
            )}
          </div>

          {checksOn && checksCard && (
            <ChecksCardView store={checks} host={checksHost} top={checksTop} onMount={checksMounted} />
          )}

          {presenting && (
            <div className="present-bar">
              <PresentFullscreen />
              <button className="present-exit" onClick={onExitPresent} data-testid="present-exit">
                <Icon name="close" size={14} /> {tr("present.exit")} <kbd>{tr("keys.escape")}</kbd>
              </button>
            </div>
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
                <strong>{tr("canvas.thisDiagramIsEmpty")}</strong>
                <span>
                  {paletteHidden
                    ? tr("chrome.doubleClickTheCanvasToAddANodeOrOpen")
                    : tr("chrome.dragAStencilFromTheLeftOrDoubleClickThe")}
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
            revision={hostRevision}
            readDiagram={() => fromFlow(meta, nodes, edges)}
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
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          flipX={menu.flipX}
          alignment={menu.alignment}
          items={menuItems}
          label={menu.label}
          searchable={menu.searchable}
          testId={menu.testId}
          onClose={() => setMenu(null)}
        />
      )}
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
      {nodeTip && !menu && <NodeTooltip tip={nodeTip} />}
    </DiagramContext.Provider>
  );
}

/**
 * The lock beside the title of a private diagram. A click explains what Private means and offers to turn it
 * off (one confirmation). A local-only example's lock only says it's always private.
 */
function PrivateBadge({ kind }: { kind: "local-only" | "private" }) {
  const always = kind === "local-only";
  return (
    <button
      type="button"
      className="private-badge"
      data-testid="private-badge"
      data-kind={kind}
      aria-label={
        always ? tr("chrome.privateAlwaysItComesFromALocalOnlyExample") : tr("chrome.privateDiagramWhatThisMeans")
      }
      title={
        always ? tr("chrome.alwaysPrivateNoShareLinksCloudSavesOrAI") : tr("chrome.privateNoShareLinksCloudSavesOrAI")
      }
      aria-disabled={always || undefined}
      onClick={() => {
        if (!always) window.dispatchEvent(new Event(PRIVACY_REQUEST));
      }}
    >
      <Icon name="lock" size={12} /> {tr("ai.private")}
    </button>
  );
}
