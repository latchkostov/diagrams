// The checks off the main thread: the canvas posts the diagram after edits pause, and this worker runs the
// rules (capacity's fixed point can take a few hundred milliseconds on a big diagram with a feedback loop),
// so typing and dragging never wait on them. Same engine, same result as the main-thread fallback.

import type { DiagramFile } from "../model/types";
import { runChecks } from "./run";
import type { CheckResult } from "./types";

export interface CheckRequest {
  id: number;
  diagram: DiagramFile;
}
export type CheckResponse = { id: number; result: CheckResult } | { id: number; error: string };

interface WorkerScope {
  onmessage: ((e: MessageEvent<CheckRequest>) => void) | null;
  postMessage(message: CheckResponse): void;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = (e) => {
  const { id, diagram } = e.data;
  try {
    scope.postMessage({ id, result: runChecks(diagram) });
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
