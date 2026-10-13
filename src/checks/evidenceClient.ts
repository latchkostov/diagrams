import type { DiagramFile } from "../model/types";
import type { Evidence } from "./evidence";
import { EVIDENCE_LIMITS } from "./evidenceLimits";
import type { EvidenceMessage, EvidenceRequest } from "./evidenceWorker";

export { withEvidence, evidenceText, type WithEvidence } from "./evidenceMerge";

// Plays a diagram's saved simulations for Run simulations (src/checks/evidence.ts): in a worker of its own, one per
// run, so stopping is terminating it, at once, whatever it's doing; and terminated too if it outlasts its budget by
// more than a grace (a hostile file, a stuck tick). Where workers fail it plays here, a tick at a time between frames,
// but only a small diagram: preparing one (the checks, the topology) can't be sliced. A lazy chunk: the canvas and
// check_diagram load it on demand.

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

/** Why a run couldn't play: it ran past its budget, or there's no worker and the diagram is too big to play here. */
export class EvidenceUnavailable extends Error {
  constructor(readonly reason: "timeout" | "unsupported") {
    super(
      reason === "timeout"
        ? "The simulations took too long to play."
        : "This browser can't play them in the background.",
    );
    this.name = "EvidenceUnavailable";
  }
}

export interface EvidenceRun {
  done: Promise<Evidence>;
  /** Stops it at once; `done` rejects with EvidenceStopped. */
  cancel(): void;
}

/** The longest stretch of main-thread work between frames, where there's no worker. */
const SLICE_MS = 6;
/** Where there's no worker, only diagrams this small play (their preparation takes a few milliseconds). */
export const MAIN_THREAD_NODES = 300;
/** …and only simulations that start this little work (see EVIDENCE_LIMITS.startWork). */
const MAIN_THREAD_START_WORK = 200_000;
/** How long past its own budget a worker may run before it's terminated. */
const GRACE_MS = 5_000;

export interface PlayOptions {
  wallMs?: number;
  /** Tests: no worker, as in a browser without one. */
  worker?: false;
  /** Tests: the clock and timer the run is held to. */
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

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
  opts: PlayOptions = {},
): EvidenceRun {
  const wallMs = opts.wallMs ?? EVIDENCE_LIMITS.wallMs;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let stopped = false;
  let halt = () => {};
  let fail: (err: Error) => void = () => {};
  const done = new Promise<Evidence>((resolve, reject) => {
    fail = reject;
    const onMainThread = () => {
      if (diagram.nodes.length > MAIN_THREAD_NODES) return reject(new EvidenceUnavailable("unsupported"));
      let timer: unknown;
      halt = () => clearTimer(timer);
      import("./evidence").then(({ gatherEvidence }) => {
        if (stopped) return;
        const now = opts.now ?? (() => performance.now());
        // A tick at a time: the clock is read between ticks, so a slice ends within one tick of its 6 ms.
        const it = gatherEvidence(diagram, { wallMs, now, sliceTicks: 1, startWork: MAIN_THREAD_START_WORK });
        const slice = () => {
          if (stopped) return;
          const until = now() + SLICE_MS;
          try {
            do {
              const next = it.next();
              if (next.done) return resolve(next.value);
              if (next.value.kind === "simulation") {
                const { index, total, title } = next.value;
                onProgress({ index, total, title });
              }
            } while (now() < until);
          } catch (err) {
            return reject(err instanceof Error ? err : new Error(String(err)));
          }
          timer = setTimer(slice, 0);
        };
        slice();
      }, reject);
    };
    const worker = opts.worker === false ? null : createWorker();
    if (!worker) return onMainThread();
    // The worker keeps its own budget; this is for one that doesn't (a single tick that never ends).
    const watchdog = setTimer(() => {
      worker.terminate();
      reject(new EvidenceUnavailable("timeout"));
    }, wallMs + GRACE_MS);
    halt = () => {
      clearTimer(watchdog);
      worker.terminate();
    };
    worker.onmessage = (e: MessageEvent<EvidenceMessage>) => {
      const m = e.data;
      if (m.type === "progress") onProgress({ index: m.index, total: m.total, title: m.title });
      else {
        halt();
        if (m.type === "done") resolve(m.evidence);
        else reject(new Error(m.error));
      }
    };
    worker.onerror = (e) => {
      e.preventDefault();
      // A worker that can't load (an old browser, a blocked script) hands over to the main thread.
      halt();
      if (!stopped) onMainThread();
    };
    const request: EvidenceRequest = { diagram, wallMs };
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
