import { createContext, useContext, type MouseEvent as ReactMouseEvent } from "react";
import type { EdgeEnd } from "../editor/edgeEdits";

/** What is being edited inline on the canvas (F2, "Rename", "Edit label" ...). */
export type EditTarget =
  /**
   * `text`: typed before the editor opened (it starts with that, the caret at the end). `edge`: the node was
   * just made connected (quick-add from a dropped connection, Alt+arrow, the "+"), so the editor's last field
   * names that connection.
   */
  | { kind: "node"; id: string; field: "label" | "sublabel"; text?: string; edge?: string }
  | { kind: "edge"; id: string }
  | { kind: "group"; id: string }
  | { kind: "annotation"; id: string };

/** Diagram-level settings + canvas UI state shared with node / edge renderers. */
export interface DiagramUi {
  /** Flow direction; routing prefers this axis when picking edge sides. */
  direction: "LR" | "TB";
  editing: EditTarget | null;
  setEditing: (target: EditTarget | null) => void;
  /** Opens the edge context menu (edge labels live outside the edge's SVG group). */
  openEdgeMenu: (e: MouseEvent | ReactMouseEvent, edgeId: string) => void;
  /** A text's edit is done: if it grew over a node or edge it didn't cover at `before`, move it clear. */
  settleText?: (id: string, before: { x: number; y: number; width: number; height: number }) => void;
  /** Editing only (not live, presenting or embedded): the selected node's "+" opens quick-add for the next node. */
  grow?: (nodeId: string) => void;
  /** Editing only: a selected edge's end dropped on another node moves there. */
  reconnect?: (edgeId: string, end: EdgeEnd, nodeId: string) => boolean;
}

export const DiagramContext = createContext<DiagramUi>({
  direction: "LR",
  editing: null,
  setEditing: () => {},
  openEdgeMenu: () => {},
});
export const useDiagram = () => useContext(DiagramContext);
