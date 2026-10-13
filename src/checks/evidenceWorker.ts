// Run simulations off the main thread: the Checks card (and check_diagram, when asked) posts the diagram, and this
// worker plays its saved simulations (src/checks/evidence.ts), saying which one it's on. One run per worker: to stop
// a run, the client terminates it (src/checks/evidenceClient.ts).

import type { DiagramFile } from "../model/types";
import { collectEvidence, type Evidence } from "./evidence";

export interface EvidenceRequest {
  diagram: DiagramFile;
  wallMs?: number;
}
export type EvidenceMessage =
  | { type: "progress"; index: number; total: number; title: string }
  | { type: "done"; evidence: Evidence }
  | { type: "error"; error: string };

interface WorkerScope {
  onmessage: ((e: MessageEvent<EvidenceRequest>) => void) | null;
  postMessage(message: EvidenceMessage): void;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = (e) => {
  try {
    const evidence = collectEvidence(e.data.diagram, { wallMs: e.data.wallMs }, (step) => {
      if (step.kind === "simulation")
        scope.postMessage({ type: "progress", index: step.index, total: step.total, title: step.title });
    });
    scope.postMessage({ type: "done", evidence });
  } catch (err) {
    scope.postMessage({ type: "error", error: err instanceof Error ? err.message : String(err) });
  }
};
