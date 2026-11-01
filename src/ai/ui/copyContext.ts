import { copyText } from "../../interop/ui/copyText";
import { observationPorts, sameObservationSource } from "../../lib/observations";
import { currentObservationSource } from "../../palette/observationSource";
import { paletteHost } from "../../palette/host";

/** Clipboard writes stay local; success never means a model received the prompt. */
export async function copyAiContext(prompt: string, signal?: AbortSignal): Promise<boolean> {
  const source = currentObservationSource();
  const selection = paletteHost.get().canvas?.editor.getSelection();
  const changed = selection ? [...selection.nodeIds, ...selection.edgeIds, ...selection.groupIds] : [];
  signal?.throwIfAborted();
  const copied = await copyText(prompt);
  signal?.throwIfAborted();
  const current = currentObservationSource();
  if (copied && source && current && sameObservationSource(source, current))
    observationPorts.ai.publish({ ...source, kind: "context", changed, copiedBytes: new Blob([prompt]).size });
  return copied;
}
