import { createContext, useContext, type MouseEvent as ReactMouseEvent } from "react";
import type { EdgeEnd } from "../editor/edgeEdits";

/**
 * What F2, Enter, a double-click, "Rename" or "Edit label" edits. A node, a connection and a boundary are named in
 * the inspector (its Label field, all of it selected); an annotation's text is edited in place, on the canvas.
 * A node's `text`: typed before the field could take it (it starts with that, the caret at the end). `edge`: the
 * node was just made connected (quick-add after a dropped connection, Alt+arrow, the "+"), so the inspector also
 * names that connection, one Tab after the Subtitle.
 */
export type EditTarget =
  | { kind: "node"; id: string; field?: "label" | "sublabel"; text?: string; edge?: string }
  | { kind: "edge"; id: string }
  | { kind: "group"; id: string }
  | { kind: "annotation"; id: string };

/** The one thing edited in place on the canvas: an annotation's text. */
export type InlineEdit = Extract<EditTarget, { kind: "annotation" }>;
/** What's named in the inspector: a node, a connection or a boundary. */
export type RenameTarget = Exclude<EditTarget, InlineEdit>;

/** Diagram-level settings + canvas UI state shared with node / edge renderers. */
export interface DiagramUi {
  /** Flow direction; routing prefers this axis when picking edge sides. */
  direction: "LR" | "TB";
  /** Appearance changes invalidate custom caption contrast measured against the canvas. */
  theme?: "light" | "dark";
  canvasColor?: string;
  editing: InlineEdit | null;
  setEditing: (target: InlineEdit | null) => void;
  /** Edit or live (not presenting or read-only): a double-click names a node, connection or boundary in the inspector. */
  rename?: (target: RenameTarget) => void;
  /** Opens the edge context menu (edge labels live outside the edge's SVG group). */
  openEdgeMenu: (e: MouseEvent | ReactMouseEvent, edgeId: string) => void;
  /** A text's edit is done: if it grew over a node or edge it didn't cover at `before`, move it clear. */
  settleText?: (id: string, before: { x: number; y: number; width: number; height: number }) => void;
  /** Editing only (not live, presenting or embedded): the selected node's "+" opens quick-add for the next node. */
  grow?: (nodeId: string) => void;
  /** Editing only: a selected edge's end dropped on another node moves there. */
  reconnect?: (edgeId: string, end: EdgeEnd, nodeId: string) => boolean;
  /** Editing only: a boundary resized by hand adopts the nodes now inside it and releases those outside (D12). */
  boundaryResized?: (groupId: string) => void;
}

export const DiagramContext = createContext<DiagramUi>({
  direction: "LR",
  editing: null,
  setEditing: () => {},
  openEdgeMenu: () => {},
});
export const useDiagram = () => useContext(DiagramContext);
