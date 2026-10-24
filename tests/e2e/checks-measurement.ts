import type { CheckRequest, CheckResponse } from "../../src/checks/worker";

/** Serialized before navigation. Only unmeasured restoration may reuse an identical, real worker result. */
export function installChecksMeasurement() {
  const state = {
    held: false,
    restoring: false,
    nativeChecks: 0,
    workerFailures: 0,
    cacheHits: 0,
    queued: [] as { worker: Worker; data: CheckResponse }[],
    release() {
      this.held = false;
      for (const { worker, data } of this.queued.splice(0)) worker.dispatchEvent(new MessageEvent("message", { data }));
    },
  };
  Object.assign(window, { __checkResults: state });
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    private checks: boolean;
    private requests = new Map<number, CheckRequest["diagram"]>();
    private cached?: { key: string; response: CheckResponse };

    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options);
      this.checks = options?.name === "checks";
      if (!this.checks) return;
      this.addEventListener("error", () => state.workerFailures++);
      this.addEventListener("message", (event: MessageEvent<CheckResponse>) => {
        if ("error" in event.data) state.workerFailures++;
        // Errors must reach the real main-thread fallback inside the measurement.
        if (state.held && !("error" in event.data)) {
          event.stopImmediatePropagation();
          state.queued.push({ worker: this, data: event.data });
          return;
        }
        const diagram = this.requests.get(event.data.id);
        this.requests.delete(event.data.id);
        if (diagram && "result" in event.data)
          // Keying and cloning happen after release, outside the CPU sample.
          this.cached = { key: JSON.stringify(diagram), response: structuredClone(event.data) };
      });
    }

    postMessage(message: unknown, options?: Transferable[] | StructuredSerializeOptions) {
      const request = message as CheckRequest;
      if (this.checks && !request.plan) {
        if (state.restoring && this.cached?.key === JSON.stringify(request.diagram)) {
          state.cacheHits++;
          const data = { ...structuredClone(this.cached.response), id: request.id };
          queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data })));
          return;
        }
        state.nativeChecks++;
        this.requests.set(request.id, request.diagram);
      }
      if (Array.isArray(options)) super.postMessage(message, options);
      else super.postMessage(message, options);
    }
  };
  return state;
}

declare global {
  interface Window {
    __checkResults: ReturnType<typeof installChecksMeasurement>;
  }
}
