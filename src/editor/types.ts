import type {
  AnnotationKind,
  AnnotationShape,
  DiagramAnnotation,
  DiagramEdge,
  DiagramFile,
  DiagramGroup,
  DiagramNode,
} from "../model/types";
import type { EditTarget } from "../canvas/DiagramContext";
import type { AlignMode, Axis } from "./arrange";
import type { GroupTone } from "../canvas/types";
import type { ClipboardPayload } from "./clipboard";

export type XY = { x: number; y: number };
/** A box in flow coordinates. */
export type XYBox = XY & { width: number; height: number };

/**
 * Ids use the saved-file namespace: group ids are DiagramGroup ids (not React Flow ids).
 * `nodeIds` also holds annotation ids (they share the node namespace), so copy, delete, align and
 * nudge treat annotations like nodes; node-only actions check `getNode`.
 */
export interface Selection {
  nodeIds: string[];
  edgeIds: string[];
  groupIds: string[];
}

/** Diagram-level fields. `simulations` is here so the simulation UI gets undo + autosave for free. */
export type DiagramMetaPatch = Partial<Pick<DiagramFile, "title" | "description" | "direction" | "simulations">>;

export interface EditOptions {
  /**
   * Coalescing tag for undo: consecutive edits with the same tag (within ~1.5s) become one
   * undo step. Use it for per-keystroke edits, e.g. `inspector:node:${id}:label`.
   */
  merge?: string;
}

export interface EditorPrefs {
  snap: boolean;
  grid: boolean;
  minimap: boolean;
  inspector: boolean;
}

/**
 * Everything menus, shortcuts and the inspector can do to the diagram. Mutations go through the
 * canvas state, so they are recorded by undo history and autosaved automatically.
 */
export interface EditorApi {
  // ---- read ----
  getDiagram(): DiagramFile;
  getNode(id: string): DiagramNode | undefined;
  getEdge(id: string): DiagramEdge | undefined;
  getGroup(id: string): DiagramGroup | undefined;
  getAnnotation(id: string): DiagramAnnotation | undefined;
  getSelection(): Selection;

  // ---- selection ----
  select(sel: Partial<Selection>): void;
  selectAll(): void;
  clearSelection(): void;

  // ---- create / update ----
  /** Adds a node centred on `at` (flow coords; default = view centre). Returns its id. */
  addNode(stencilId: string, at?: XY): string;
  updateNode(id: string, patch: Partial<Omit<DiagramNode, "id">>, opts?: EditOptions): void;
  /** Shallow-merges node props; `undefined` values delete keys. */
  setNodeProps(id: string, patch: Record<string, unknown>, opts?: EditOptions): void;
  updateEdge(id: string, patch: Partial<Omit<DiagramEdge, "id">>, opts?: EditOptions): void;
  setEdgeProps(id: string, patch: Record<string, unknown>, opts?: EditOptions): void;
  updateGroup(id: string, patch: Partial<Omit<DiagramGroup, "id">>, opts?: EditOptions): void;
  /**
   * Adds a text, note, zone or shape centred on `at` (flow coords; default = the pointer for "T",
   * else the free place nearest the view centre), selects it and, except for shapes, starts editing its
   * text. Returns its id. A zone added with things selected is drawn around them instead, unless
   * `aroundSelection` is false (a drop goes where it's dropped).
   */
  addAnnotation(
    kind: AnnotationKind,
    opts?: { at?: XY; shape?: AnnotationShape; atPointer?: boolean; aroundSelection?: boolean },
  ): string | null;
  updateAnnotation(id: string, patch: Partial<Omit<DiagramAnnotation, "id">>, opts?: EditOptions): void;
  updateMeta(patch: DiagramMetaPatch, opts?: EditOptions): void;
  connect(from: string, to: string): string | null;
  reverseEdge(id: string): void;

  // ---- structure ----
  deleteElements(sel: Partial<Selection>): void;
  duplicate(sel: Partial<Selection>): void;
  align(nodeIds: string[], mode: AlignMode): void;
  distribute(nodeIds: string[], axis: Axis): void;
  /** Wraps nodes in a new boundary and starts renaming it. Returns the group id. */
  groupNodes(nodeIds: string[], tone?: GroupTone): string | null;
  ungroup(groupId: string): void;
  deleteGroupWithContents(groupId: string): void;
  fitGroupToContents(groupId: string): void;
  bringToFront(nodeIds: string[]): void;
  sendToBack(nodeIds: string[]): void;
  /** Moves the selected nodes (and the contents of selected boundaries). */
  moveSelection(dx: number, dy: number): void;
  /**
   * A text that grew (new words, a new size) and now covers a node or an edge it didn't cover at
   * `before` moves to the nearest free spot, as its own undo step. Returns what it was moved off.
   */
  keepTextClear(id: string, before?: XYBox): "node" | "edge" | null;

  // ---- clipboard ----
  copy(sel: Partial<Selection>): void;
  cut(sel: Partial<Selection>): void;
  /** Pastes the clipboard; `at` = top-left target in flow coords, default = offset from the source. */
  paste(at?: XY): Promise<void>;
  /** Inserts a payload (e.g. from a system clipboard paste event). */
  pastePayload(payload: ClipboardPayload, at?: XY): void;
  hasClipboard(): boolean;

  // ---- history ----
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  // ---- view / UI ----
  fitView(): void;
  zoomTo100(): void;
  prefs: EditorPrefs;
  setPref<K extends keyof EditorPrefs>(key: K, value: EditorPrefs[K]): void;
  startEditing(target: EditTarget): void;
  /** Opens the inspector, optionally focusing `inspector-field-<focusField>`. */
  openInspector(focusField?: string): void;
  showShortcuts(): void;
  exportJson(): void;
  autoLayout(): void;
}
