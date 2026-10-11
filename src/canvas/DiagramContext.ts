import { createContext, useContext, type MouseEvent as ReactMouseEvent } from "react";

/** What is being edited inline on the canvas (F2, "Rename", "Edit label" ...). */
export type EditTarget =
  | { kind: "node"; id: string; field: "label" | "sublabel" }
  | { kind: "edge"; id: string }
  | { kind: "group"; id: string };

/** Diagram-level settings + canvas UI state shared with node / edge renderers. */
export interface DiagramUi {
  /** Flow direction; routing prefers this axis when picking edge sides. */
  direction: "LR" | "TB";
  editing: EditTarget | null;
  setEditing: (target: EditTarget | null) => void;
  /** Opens the edge context menu (edge labels live outside the edge's SVG group). */
  openEdgeMenu: (e: MouseEvent | ReactMouseEvent, edgeId: string) => void;
}

export const DiagramContext = createContext<DiagramUi>({ direction: "LR", editing: null, setEditing: () => {}, openEdgeMenu: () => {} });
export const useDiagram = () => useContext(DiagramContext);
