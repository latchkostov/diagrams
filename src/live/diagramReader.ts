import type { DiagramFile } from "../model/types";
import type { EditorApi } from "../editor/types";

/** A live update or draft keystroke must reuse the document and its derived target indexes. */
export function liveDiagramReader(
  editor: Pick<EditorApi, "getDocumentVersion" | "getDiagram"> | undefined,
  diagram?: DiagramFile,
) {
  let version: unknown;
  let cached: DiagramFile | undefined;
  return (): DiagramFile => {
    const next = editor?.getDocumentVersion();
    if (!cached || next !== version) {
      cached = editor ? editor.getDiagram() : diagram!;
      version = next;
    }
    return cached;
  };
}
