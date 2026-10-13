import type { DiagramFile } from "../model/types";
import type { Evidence } from "./evidence";
import type { EvidenceMessage, EvidenceRequest } from "./evidenceWorker";

export { withEvidence, evidenceText } from "./evidenceMerge";

// Plays a diagram's saved simulations for Run simulations (src/checks/evidence.ts): in a worker of its own, one per
// run, so stopping is terminating it, at once, whatever it's doing. Where workers fail it loads the engine and plays
// here, in slices of a few milliseconds between frames. A lazy chunk: the canvas and check_diagram load it on demand.

export interface EvidenceProgress {
  index: number;
  total: number;
  title: string;
}

/** What a run that was stopped rejects with. */
export class EvidenceStopped extends Error {
  constructor() {
    super("Stopped");
    this.name = "EvidenceStopped";
  }
}

export interface EvidenceRun {
  done: Promise<Evidence>;
  /** Stops it at once; `done` rejects with EvidenceStopped. */
  cancel(): void;
}

/** The longest stretch of main-thread work between frames, where there's no worker. */
const SLICE_MS = 6;

function createWorker(): Worker | null {
  if (typeof Worker !== "function") return null;
  try {
    return new Worker(new URL("./evidenceWorker.ts", import.meta.url), { type: "module", name: "simulations" });
  } catch {
    return null;
  }
}

export function playSimulations(
  diagram: DiagramFile,
  onProgress: (p: EvidenceProgress) => void,
  opts: { wallMs?: number } = {},
): EvidenceRun {
  let stopped = false;
  let halt = () => {};
  let fail: (err: Error) => void = () => {};
  const done = new Promise<Evidence>((resolve, reject) => {
    fail = reject;
    const onMainThread = () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      halt = () => clearTimeout(timer);
      import("./evidence").then(({ gatherEvidence }) => {
        if (stopped) return;
        const it = gatherEvidence(diagram, { wallMs: opts.wallMs, sliceSteps: 1 });
        const slice = () => {
          if (stopped) return;
          const until = performance.now() + SLICE_MS;
          try {
            do {
              const next = it.next();
              if (next.done) return resolve(next.value);
              if (next.value.kind === "simulation") {
                const { index, total, title } = next.value;
                onProgress({ index, total, title });
              }
            } while (performance.now() < until);
          } catch (err) {
            return reject(err instanceof Error ? err : new Error(String(err)));
          }
          timer = setTimeout(slice, 0);
        };
        slice();
      }, reject);
    };
    const worker = createWorker();
    if (!worker) return onMainThread();
    halt = () => worker.terminate();
    worker.onmessage = (e: MessageEvent<EvidenceMessage>) => {
      const m = e.data;
      if (m.type === "progress") onProgress({ index: m.index, total: m.total, title: m.title });
      else {
        worker.terminate();
        if (m.type === "done") resolve(m.evidence);
        else reject(new Error(m.error));
      }
    };
    worker.onerror = (e) => {
      e.preventDefault();
      // A worker that can't load (an old browser, a blocked script) hands over to the main thread.
      worker.terminate();
      if (!stopped) onMainThread();
    };
    const request: EvidenceRequest = { diagram, ...(opts.wallMs ? { wallMs: opts.wallMs } : {}) };
    worker.postMessage(request);
  });
  return {
    done,
    cancel() {
      if (stopped) return;
      stopped = true;
      halt();
      fail(new EvidenceStopped());
    },
  };
}
