import type { DiagramFile } from "../../model/types";
import type { CheckResult } from "../../checks/types";
import type { CheckRequest, CheckResponse } from "../../checks/worker";

// Runs the checks for the canvas: in a worker (src/checks/worker.ts) so the main thread only copies the
// diagram, or, where workers aren't available, by loading the engine (a lazy chunk) and running it here.
// Either way the engine never ships in the startup JavaScript or the canvas's own chunk.

type Pending = { resolve: (r: CheckResult) => void; reject: (e: Error) => void };

let worker: Worker | null | undefined;
let seq = 0;
const pending = new Map<number, Pending>();

function failAll(message: string) {
  for (const p of pending.values()) p.reject(new Error(message));
  pending.clear();
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL("../../checks/worker.ts", import.meta.url), { type: "module", name: "checks" });
    worker.onmessage = (e: MessageEvent<CheckResponse>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if ("result" in e.data) p.resolve(e.data.result);
      else p.reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      e.preventDefault();
      // A worker that can't load (an old browser, a blocked script) hands over to the main-thread engine.
      worker?.terminate();
      worker = null;
      failAll(e.message || "the checks worker failed to load");
    };
  } catch {
    worker = null;
  }
  return worker;
}

const loadEngine = () => import("../../checks/run");

/** The checks for `diagram`. Rejects only if the engine itself can't load. */
export async function runChecksOffThread(diagram: DiagramFile): Promise<CheckResult> {
  const w = typeof Worker === "function" ? getWorker() : null;
  if (w) {
    const id = ++seq;
    const request: CheckRequest = { id, diagram };
    try {
      return await new Promise<CheckResult>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        w.postMessage(request);
      });
    } catch {
      // Fall through: the worker failed; the main thread runs this one.
    }
  }
  const { runChecks } = await loadEngine();
  return runChecks(diagram);
}
