import type { EditorApi } from "../editor/types";
import { describeDiagram } from "./describe";
import { isLocalOnly, privacyOf, type CanvasPrivacyState } from "../lib/localOnly";
import type { CanvasHost } from "../palette/host";

export const LOCAL_ONLY_MESSAGE =
  "Local-only diagrams are excluded from AI. Their contents cannot be described, edited or shared through AI tools.";
/**
 * What agents (the page's tools) and people are told when AI can't use the diagram. A built-in local-only example is
 * always private, so tools say "Private" for it too; LOCAL_ONLY_MESSAGE is only the development examples' own note.
 */
export const PRIVATE_MESSAGE =
  "Private diagrams are excluded from AI. Their contents cannot be described, edited or shared through AI tools.";

/** Why AI can't use this diagram, in the words for its kind (a built-in local-only one, or Private). */
export const aiOffMessage = (state: CanvasPrivacyState | null | undefined): string =>
  privacyOf(state) === "private" ? PRIVATE_MESSAGE : LOCAL_ONLY_MESSAGE;

/** Read provenance before touching document contents, at the time the prompt is copied. */
export function describeForAi(
  editor: EditorApi,
  canvasState: Pick<CanvasHost, "localOnly" | "private" | "editor"> | null,
): string {
  if (isLocalOnly(canvasState)) return aiOffMessage(canvasState);
  const d = editor.getDiagram();
  return d.nodes.length || d.annotations?.length ? describeDiagram(d) : "";
}
