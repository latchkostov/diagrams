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
import type { DiagramDiff } from "./diagramDiff";
import type { Toward } from "../canvas/placement";
import type { EdgeEnd } from "./edgeEdits";
export type { DiagramDiff, ChangeSet } from "./diagramDiff";

export type XY = { x: number; y: number };
/** A node just made with its edge (null when it has none of its own) and the undo tag naming it joins. */
export type NewNode = { id: string; edge: string | null; merge: string };
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
export type DiagramMetaPatch = Partial<
  Pick<DiagramFile, "title" | "description" | "color" | "direction" | "simulations" | "checks" | "planning">
>;

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
  /**
   * Select similar (a node's or an edge's right-click, Ctrl+K): every node of the same stencil, or every edge
   * of the same relationship (Message, Request, or one dependency), shown or hidden as dependencies are.
   * Returns how many are selected.
   */
  selectSimilar(target: { nodeId?: string; edgeId?: string }): number;

  // ---- create / update ----
  /** One replacement and one immediate undo step, isolated from user edits. */
  applyDiagram(next: DiagramFile, opts?: EditOptions): DiagramDiff;
  /**
   * The `merge` tag of the step Undo would reverse next (e.g. an applyDiagram's), or undefined when
   * it's untagged, there's nothing to undo, or an edit is still pending.
   */
  undoTarget(): string | undefined;
  /** Adds a node centred on `at` (flow coords; default = view centre). Returns its id. */
  addNode(stencilId: string, at?: XY): string;
  /**
   * Quick-add on empty canvas: adds a node centred on `at`, tagged so naming it joins the add's undo step (as
   * createConnected's node is).
   */
  addNamed(stencilId: string, at: XY): NewNode;
  updateNode(id: string, patch: Partial<Omit<DiagramNode, "id">>, opts?: EditOptions): void;
  /** Shallow-merges node props; `undefined` values delete keys. */
  setNodeProps(id: string, patch: Record<string, unknown>, opts?: EditOptions): void;
  /** Bulk edit (the multi-selection's inspector): one state pass and one undo step for all of `ids`. */
  updateNodes(ids: readonly string[], patch: Pick<Partial<DiagramNode>, "stencil" | "group">, opts?: EditOptions): void;
  /** Bulk edit: shallow-merges the same props into every node of `ids`, as one undo step. */
  setNodesProps(ids: readonly string[], patch: Record<string, unknown>, opts?: EditOptions): void;
  /** Bulk edit: one colour for several texts, notes, zones and shapes, as one undo step. */
  updateAnnotations(ids: readonly string[], patch: Pick<Partial<DiagramAnnotation>, "color">, opts?: EditOptions): void;
  /** Bulk edit: one colour for several boundaries, as one undo step. */
  updateGroups(ids: readonly string[], patch: Pick<Partial<DiagramGroup>, "tone">, opts?: EditOptions): void;
  updateEdge(id: string, patch: Partial<Omit<DiagramEdge, "id">>, opts?: EditOptions): void;
  /** Update selected edges in one state pass and one history step. */
  updateEdges(ids: readonly string[], patch: Partial<Omit<DiagramEdge, "id">>, opts?: EditOptions): void;
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
  /**
   * Where a node added on `toward` side of `fromId` lands (a box, top-left): one gap that way, stepping
   * across past what's there, and always clear of nodes and edges. Default side: downstream. `clone`: the
   * size of a copy of `fromId` rather than a new node. Null when `fromId` takes no edges.
   */
  nextSpot(fromId: string, toward?: Toward, clone?: boolean): XYBox | null;
  /**
   * The one way a connected node is made: a dropped connection (`at`, the drop point), the "+" and Alt+arrow
   * (`toward`, default downstream), Alt+Shift+arrow (`clone`), the rail and Ctrl+K after a selected node, and a
   * stencil dropped on a node. The node and its edge are built from one snapshot (the relationship inferred from
   * both stencils) and committed together as one undo step, tagged `merge` so naming the node joins it. The new
   * node is fed by `from` (→, ↓, a drop) or feeds it (←, ↑).
   */
  createConnected(req: { from: string; stencil?: string; clone?: boolean; toward?: Toward; at?: XY }): NewNode | null;
  /**
   * Insert node on an edge (its menu, Ctrl+K, a stencil dropped on it): a new node at `at`, else the free place
   * nearest the middle of the edge's ends, and the edge split around it (src/model/edgeSplit.ts), one undo step.
   */
  insertNode(edgeId: string, stencilId: string, at?: XY): NewNode | null;
  /** Makes a node with `make`, brings it into view and opens its name (keys typed meanwhile are kept). */
  nameNew(make: () => NewNode | null, fallback: string): void;
  /**
   * The stencil rail and Ctrl+K: with exactly one node selected (one that takes edges), the stencil goes
   * after it, connected; otherwise it goes to the free place nearest the view's centre. Returns its id.
   */
  addStencil(stencilId: string): string;
  /** The single selected node a new stencil would follow (rail and Ctrl+K), if any. */
  stencilAnchor(): string | undefined;
  /** Moves one end of an edge onto another node, keeping its label, relationship and settings. */
  reconnectEdge(edgeId: string, end: EdgeEnd, nodeId: string): boolean;
  /** Splits an edge around a node: A→B becomes A→N→B, both keeping the edge's meaning. */
  insertIntoEdge(edgeId: string, nodeId: string): boolean;

  // ---- structure ----
  deleteElements(sel: Partial<Selection>): void;
  /**
   * Copies the selection beside itself, clear of everything (one gap in the flow direction, or the
   * nearest free place). Again on the copy: the same step, or the gap chosen by moving the copy.
   */
  duplicate(sel: Partial<Selection>): void;
  /** Copies the selection onto itself, selected (Alt-drag drags the copies away). Old flow id → new. */
  duplicateInPlace(sel: Partial<Selection>): Map<string, string>;
  /** Moves the selection (with its boundaries' members) to the nearest place clear of other things. */
  keepClear(sel: Partial<Selection>): void;
  align(nodeIds: string[], mode: AlignMode): void;
  distribute(nodeIds: string[], axis: Axis): void;
  /**
   * Tidy up (D15): the layered layout on just these nodes and the edges between them, inside their bounding
   * box where it fits (its top-left kept), clear of everything else, members kept in their boundaries (which
   * grow to hold them). Nothing else moves; one undo step. When no such place is within reach, nothing moves
   * and a toast says so: false.
   */
  tidy(nodeIds: string[]): boolean;
  /**
   * Boundaries that keep up (D12): nodes `ids`, just dropped, join the boundary around their centre (or leave
   * theirs), and a boundary grows to hold a member that pokes out. Joins the drop's undo step. Returns the
   * boundaries members left (group id → node ids), for the toast that says so.
   */
  settleMembership(ids: readonly string[]): Map<string, string[]>;
  /** A boundary resized by hand adopts the nodes now inside it and releases those now outside it. */
  adoptAfterResize(groupId: string): { adopted: string[]; released: string[] };
  /** Wraps nodes, annotations, and boundaries in a new boundary and starts renaming it. Returns the group id. */
  groupNodes(ids: string[], tone?: GroupTone): string | null;
  ungroup(groupId: string): void;
  deleteGroupWithContents(groupId: string): void;
  fitGroupToContents(groupId: string): void;
  /** Converts a boundary into a zone annotation, releasing all member nodes. Returns the new zone id. */
  convertGroupToZone(groupId: string, opts?: EditOptions): string | null;
  /** Converts a zone annotation into a boundary, adopting all elements inside it. Returns the new boundary id. */
  convertZoneToBoundary(zoneId: string, opts?: EditOptions): string | null;
  bringToFront(nodeIds: string[]): void;
  sendToBack(nodeIds: string[]): void;
  /** Moves the selected nodes (and the contents of selected boundaries). */
  moveSelection(dx: number, dy: number): void;
  /**
   * The arrow keys. With Snapping on they're grid-true: the selection's top-left corner goes to the next
   * 10 px grid line that way (`far`, Shift: 50 px, onto the grid). With Snapping off, 1 px (Shift: 10 px).
   */
  nudge(dx: -1 | 0 | 1, dy: -1 | 0 | 1, far: boolean): void;
  /**
   * A text that grew (new words, a new size) and now covers a node or an edge it didn't cover at
   * `before` moves to the nearest free spot, as its own undo step. Returns what it was moved off.
   */
  keepTextClear(id: string, before?: XYBox): "node" | "edge" | null;

  // ---- clipboard ----
  copy(sel: Partial<Selection>): void;
  cut(sel: Partial<Selection>): void;
  /**
   * Pastes the clipboard; `at` = top-left target in flow coords, default = centred on the pointer over
   * the canvas (else the view's centre). Either way it lands clear of what's there.
   */
  paste(at?: XY): Promise<void>;
  /** Inserts a payload (e.g. from a system clipboard paste event); placed as `paste`. */
  pastePayload(payload: ClipboardPayload, at?: XY): void;
  hasClipboard(): boolean;
  /** A private diagram: what's copied from it carries that, so a paste elsewhere makes the target private. */
  isPrivate?(): boolean;

  // ---- history ----
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  // ---- view / UI ----
  fitView(): void;
  zoomTo100(): void;
  /** Fits the selection (or, with none, the node under the pointer) in view. False: nothing to zoom to. */
  zoomToSelection(): boolean;
  prefs: EditorPrefs;
  setPref<K extends keyof EditorPrefs>(key: K, value: EditorPrefs[K]): void;
  /** F2, Enter, "Rename": an annotation's text in place; a node, connection or boundary in the inspector's Label. */
  startEditing(target: EditTarget): void;
  /** The creation transaction of node `id`, if it was just made and not yet named: its name joins that step. */
  creating(id: string): string | undefined;
  /** Opens one undo step for the name fields; a new node keeps its creation step. */
  beginNaming(kind: "node" | "edge" | "group", id: string): string;
  /** Enter, Esc or focus away completes that naming step. */
  doneNaming(tag: string): void;
  /** Opens the inspector, optionally focusing `inspector-field-<focusField>`. */
  openInspector(focusField?: string): void;
  showShortcuts(): void;
  autoLayout(): void;
}
