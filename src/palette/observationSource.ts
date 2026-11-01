import { paletteHost } from "./host";
import type { ObservationSource } from "../lib/observations";

export function currentObservationSource(): ObservationSource | undefined {
  const canvas = paletteHost.get().canvas;
  return canvas?.documentId
    ? {
        documentId: canvas.documentId,
        identity: canvas.editor.getDocumentVersion().identity,
        revision: canvas.editor.getDocumentVersion().revision,
      }
    : undefined;
}
