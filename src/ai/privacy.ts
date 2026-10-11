import type { EditorApi } from "../editor/types";
import { describeDiagram } from "./describe";
import { isLocalOnly } from "../lib/localOnly";
import type { CanvasHost } from "../palette/host";

export const LOCAL_ONLY_MESSAGE =
  "Local-only diagrams are excluded from AI. Their contents cannot be described, edited or shared through AI tools.";

/** Read provenance before touching document contents, at the time the prompt is copied. */
export function describeForAi(editor: EditorApi, canvasState: Pick<CanvasHost, "localOnly" | "editor"> | null): string {
  if (isLocalOnly(canvasState)) return LOCAL_ONLY_MESSAGE;
  const d = editor.getDiagram();
  return d.nodes.length || d.annotations?.length ? describeDiagram(d) : "";
}
