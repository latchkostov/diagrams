import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { test as base, type TestType } from "@playwright/test";

// This opt-in is set only by the report-only Nightly job. Ordinary Windows runs keep every quarantine.
export function slowmoDiagnosticEnabled(env = process.env, platform: string = process.platform) {
  return (
    platform === "win32" &&
    env.CI === "true" &&
    env.GITHUB_WORKFLOW === "Nightly" &&
    env.NIGHTLY_SLOWMO_DIAGNOSTIC === "1"
  );
}

export const SLOWMO_DIAGNOSTIC_TITLES = [
  "engine changes are disabled consistently; tracing, sequence and recording remain available",
  "an open Inputs panel and capacity Apply fix wait until slow motion ends",
  "Esc restores the pre-replay viewport (fitted)",
  "Trace a message ▸ and the command palette start it; Record video offers this slow motion",
];
export const SLOWMO_DIAGNOSTIC_GREP = new RegExp(
  SLOWMO_DIAGNOSTIC_TITLES.map((title) => title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$").join("|"),
);

/** Runs before application code. Observes main-thread handles; does not inject code into worker realms. */
export function installSlowmoTeardownProbe() {
  const browser: Window = window;
  const raf = new Set<number>();
  const timers = new Map<number, string>();
  const workers: { id: number; url: string; terminated: boolean; transfers: number }[] = [];
  const recorders: MediaRecorder[] = [];
  const fetches = new Map<number, string>();
  const canvases: { id: number; testId: string | null }[] = [];
  let requests = 0;
  const requestFrame = browser.requestAnimationFrame.bind(window);
  const cancelFrame = browser.cancelAnimationFrame.bind(window);
  browser.requestAnimationFrame = (callback) => {
    const id = requestFrame((time) => {
      raf.delete(id);
      callback(time);
    });
    raf.add(id);
    return id;
  };
  browser.cancelAnimationFrame = (id) => {
    raf.delete(id);
    cancelFrame(id);
  };
  const timeout = browser.setTimeout.bind(window);
  const interval = browser.setInterval.bind(window);
  const clearTimeout = browser.clearTimeout.bind(window);
  const clearInterval = browser.clearInterval.bind(window);
  browser.setTimeout = (handler, delay, ...args) => {
    // String handlers retain the browser's native CSP/error behaviour.
    if (typeof handler !== "function") return timeout(handler, delay, ...args);
    const id = timeout(() => {
      timers.delete(id);
      Reflect.apply(handler, browser, args);
    }, delay);
    timers.set(id, "timeout");
    return id;
  };
  browser.setInterval = (handler, delay, ...args) => {
    const id = interval(handler, delay, ...args);
    timers.set(id, "interval");
    return id;
  };
  browser.clearTimeout = (id) => {
    if (id !== undefined) timers.delete(id);
    clearTimeout(id);
  };
  browser.clearInterval = (id) => {
    if (id !== undefined) timers.delete(id);
    clearInterval(id);
  };
  const fetch = browser.fetch.bind(window);
  browser.fetch = (...args) => {
    const id = ++requests;
    const input = args[0];
    fetches.set(id, input instanceof Request ? input.url : String(input));
    const promise = fetch(...args);
    void promise.then(
      () => fetches.delete(id),
      () => fetches.delete(id),
    );
    return promise;
  };
  window.Worker = new Proxy(window.Worker, {
    construct(target, args) {
      const worker = Reflect.construct(target, args) as Worker;
      const entry = { id: workers.length + 1, url: String(args[0]), terminated: false, transfers: 0 };
      workers.push(entry);
      const terminate = worker.terminate.bind(worker);
      worker.terminate = () => {
        entry.terminated = true;
        terminate();
      };
      const post = worker.postMessage.bind(worker);
      worker.postMessage = (message: unknown, options?: Transferable[] | StructuredSerializeOptions) => {
        const transfer = Array.isArray(options) ? options : (options?.transfer ?? []);
        if (Array.isArray(options)) post(message, options);
        else post(message, options);
        entry.transfers += transfer.filter((value) => value instanceof OffscreenCanvas).length;
      };
      return worker;
    },
  });
  if (window.MediaRecorder)
    window.MediaRecorder = new Proxy(window.MediaRecorder, {
      construct(target, args) {
        const recorder = Reflect.construct(target, args) as MediaRecorder;
        recorders.push(recorder);
        return recorder;
      },
    });
  const transfer = HTMLCanvasElement.prototype.transferControlToOffscreen;
  if (transfer)
    HTMLCanvasElement.prototype.transferControlToOffscreen = function () {
      const canvas = transfer.call(this);
      canvases.push({ id: canvases.length + 1, testId: this.getAttribute("data-testid") });
      return canvas;
    };
  Object.assign(window, {
    __slowmoTeardownSnapshot: () => ({
      raf: [...raf],
      timers: [...timers].map(([id, kind]) => ({ id, kind })),
      workers,
      recorders: recorders.map((recorder) => ({ state: recorder.state, mimeType: recorder.mimeType })),
      offscreenCanvases: canvases,
      pendingFetchHeaders: [...fetches].map(([id, url]) => ({ id, url })),
    }),
  });
}

/** Keep original test.fixme calls intact, lifting only the four named cases in the dedicated runner job. */
export function withSlowmoDiagnostic<T extends object, W extends object>(original: TestType<T, W>): TestType<T, W> {
  if (!slowmoDiagnosticEnabled()) return original;
  return new Proxy(original, {
    get(target, key, receiver) {
      if (key !== "fixme") return Reflect.get(target, key, receiver);
      return (...args: unknown[]) => {
        const info = target.info();
        if (
          args[0] === true &&
          args[1] === "Nightly native teardown: docs/backlog/2026-10-18-nightly-native-load.md" &&
          /[/\\]slowmo\.spec\.ts$/.test(info.file) &&
          SLOWMO_DIAGNOSTIC_TITLES.includes(info.title)
        ) {
          info.annotations.push({ type: "diagnostic", description: "Nightly report-only quarantine investigation" });
          return;
        }
        return Reflect.apply(target.fixme, target, args);
      };
    },
  });
}

export const slowmoDiagnosticTest: typeof base = base.extend<{ slowmoTeardownProbe: undefined }>({
  slowmoTeardownProbe: [
    async ({ context }, use, info) => {
      const file = info.outputPath("teardown-probe.jsonl");
      mkdirSync(dirname(file), { recursive: true });
      const log = (event: string, detail: unknown = {}) => {
        const line = JSON.stringify({ time: new Date().toISOString(), event, detail });
        appendFileSync(file, line + "\n");
        process.stdout.write(`[slowmo-teardown] ${line}\n`);
      };
      const workers = new Map<string, string>();
      const pending = new Map<object, { url: string; kind: string }>();
      let ids = 0;
      context.on("page", (page) => {
        page.on("worker", (worker) => {
          const id = String(++ids);
          workers.set(id, worker.url());
          log("worker.open", { id, url: worker.url() });
          worker.on("close", () => {
            workers.delete(id);
            log("worker.close", { id });
          });
        });
        page.on("request", (request) => pending.set(request, { url: request.url(), kind: request.resourceType() }));
        page.on("requestfinished", (request) => pending.delete(request));
        page.on("requestfailed", (request) => {
          pending.delete(request);
          log("request.failed", { url: request.url(), failure: request.failure() });
        });
      });
      await context.addInitScript(installSlowmoTeardownProbe);
      // Log synchronously before calling the real close: a stalled close still leaves uploadable evidence.
      const close = context.close.bind(context);
      context.close = async (options) => {
        log("context.close.begin", { openWorkers: [...workers], pendingRequests: [...pending.values()] });
        try {
          await close(options);
        } finally {
          log("context.close.end", { openWorkers: [...workers], pendingRequests: [...pending.values()] });
        }
      };
      log("test.begin", { title: info.title, repeat: info.repeatEachIndex, worker: info.workerIndex });
      await use(undefined);
      log("snapshot.begin", {
        status: info.status,
        openWorkers: [...workers],
        pendingRequests: [...pending.values()],
      });
      for (const page of context.pages()) {
        try {
          const snapshot: unknown = await page.evaluate(() => {
            const probe = (window as Window & { __slowmoTeardownSnapshot?: () => unknown }).__slowmoTeardownSnapshot;
            return probe?.();
          });
          log("page.snapshot", { url: page.url(), snapshot });
        } catch (error) {
          log("snapshot.error", String(error));
        }
      }
    },
    { auto: true },
  ],
});
