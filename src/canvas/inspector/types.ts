import { type ReactNode } from "react";
import type { EditorApi } from "../../editor/types";
import type { DiagramFile } from "../../model/types";
import type { DiagramMeta } from "../convert";
import type { AnnotationFlowNode, DiagramFlowEdge, DiagramFlowNode, GroupFlowNode } from "../types";

export interface InspectorProps {
  privacy?: "private" | "local-only" | null;
  diagramReset?: ReactNode;
  checksStore?: import("../checks/useChecks").ChecksStore;
  checksHost?: import("../checks/ChecksViews").ChecksHost;
  editor: EditorApi;
  meta: DiagramMeta;
  selectedNodes: DiagramFlowNode[];
  selectedGroups: GroupFlowNode[];
  selectedEdges: DiagramFlowEdge[];
  /** Selected texts, notes, zones and shapes. */
  selectedAnnotations?: AnnotationFlowNode[];
  groups: GroupFlowNode[];
  nodeLabel: (id: string) => string;
  counts: { nodes: number; edges: number; groups: number };
  collapsed: boolean;
  onToggle: () => void;
  /** A completed resize lets the canvas preserve the fitted diagram or selection. */
  onResize?: () => void;
  /**
   * Focus request: `inspector-field-<name>`, its text all selected (`caret: "end"`: the caret after it, for a name
   * typed before the field could take it); `seq` re-triggers for the same name.
   */
  focus?: { name: string; seq: number; caret?: "end"; target?: string; text?: string };
  /** Request consumption survives inspector unmounts (presentation). */
  takeFocus?: (seq: number) => boolean;
  /**
   * A node just made connected, while it's being named: its connection's label, one Tab after the Subtitle
   * (`onNamed`: the naming is done, so the field goes).
   */
  connection?: { id: string; label: string };
  onNamed?: () => void;
  /** The selection's architecture-check findings. Nodes show them after their configuration. */
  findings?: ReactNode;
  /** Canvas revision, read by planning only outside a name edit. */
  revision?: unknown;
  /** Reads the canvas's current render, before React Flow's imperative store catches up. */
  readDiagram?: () => DiagramFile;
  /** A text's edit is done (see DiagramUi.settleText): it moves clear if it grew over something. */
  onTextSettled?: (id: string, before: { x: number; y: number; width: number; height: number }) => void;
}
