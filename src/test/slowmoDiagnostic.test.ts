import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  installSlowmoTeardownProbe,
  slowmoDiagnosticEnabled,
  SLOWMO_DIAGNOSTIC_GREP,
  SLOWMO_DIAGNOSTIC_TITLES,
} from "../../tests/e2e/slowmo-diagnostic";

describe("Nightly slow-motion diagnostics", () => {
  it("requires the dedicated Nightly Windows opt-in", () => {
    const env = { CI: "true", GITHUB_WORKFLOW: "Nightly", NIGHTLY_SLOWMO_DIAGNOSTIC: "1" };
    expect(slowmoDiagnosticEnabled(env, "win32")).toBe(true);
    expect(slowmoDiagnosticEnabled(env, "linux")).toBe(false);
    expect(slowmoDiagnosticEnabled({ ...env, NIGHTLY_SLOWMO_DIAGNOSTIC: undefined }, "win32")).toBe(false);
    expect(slowmoDiagnosticEnabled({ ...env, GITHUB_WORKFLOW: "CI" }, "win32")).toBe(false);
    expect(slowmoDiagnosticEnabled({ ...env, CI: undefined }, "win32")).toBe(false);
    for (const title of SLOWMO_DIAGNOSTIC_TITLES)
      expect(SLOWMO_DIAGNOSTIC_GREP.test(`chromium slowmo.spec.ts slow motion ${title}`)).toBe(true);
    expect(SLOWMO_DIAGNOSTIC_GREP.test("Esc restores the pre-replay viewport (zoomed by hand)")).toBe(false);
  });

  it("keeps diagnostic failures out of the Nightly verdict and failure issue", () => {
    const workflow = parse(readFileSync(".github/workflows/nightly.yml", "utf8")) as {
      jobs: Record<
        string,
        {
          "continue-on-error"?: boolean;
          "runs-on"?: string;
          needs?: string[];
          steps?: { run?: string; if?: string; with?: { path?: string } }[];
        }
      >;
    };
    const job = workflow.jobs["slowmo-teardown-diagnostic"];
    expect(job["continue-on-error"]).toBe(true);
    expect(job["runs-on"]).toBe("windows-latest");
    expect(job.steps?.find((step) => step.run?.includes("pnpm gate"))?.run).toContain(
      "--repeat 3 --workers 3 --ports 6980 --max-wait 1",
    );
    expect(job.steps?.find((step) => step.with?.path === "tests/.output/g")?.if).toBe("always()");
    expect(workflow.jobs.report.needs).not.toContain("slowmo-teardown-diagnostic");
  });

  it("records live handles, successful canvas transfers and recorder state without consuming work", async () => {
    let id = 0;
    const callbacks = new Map<number, () => void>();
    const schedule = (callback: () => void) => {
      callbacks.set(++id, callback);
      return id;
    };
    class Worker {
      terminated = false;
      terminate() {
        this.terminated = true;
      }
      postMessage() {}
    }
    class MediaRecorder {
      state = "inactive";
      mimeType = "video/webm";
    }
    class OffscreenCanvas {
      width = 1;
      height = 1;
    }
    class HTMLCanvasElement {
      getAttribute() {
        return "live-canvas";
      }
      transferControlToOffscreen() {
        return new OffscreenCanvas();
      }
    }
    let complete!: () => void;
    const fetch = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const browser = {
      requestAnimationFrame: schedule,
      cancelAnimationFrame: (id: number) => callbacks.delete(id),
      setTimeout: schedule,
      setInterval: schedule,
      clearTimeout: (id: number) => callbacks.delete(id),
      clearInterval: (id: number) => callbacks.delete(id),
      fetch: () => fetch,
      Worker,
      MediaRecorder,
    };
    const realm = { window: browser, HTMLCanvasElement, OffscreenCanvas, Request };
    runInNewContext(`(${installSlowmoTeardownProbe.toString()})()`, realm);
    const snapshot = () =>
      (
        browser as typeof browser & {
          __slowmoTeardownSnapshot: () => {
            raf: number[];
            timers: { id: number; kind: string }[];
            workers: { terminated: boolean; transfers: number }[];
            recorders: { state: string }[];
            offscreenCanvases: unknown[];
            pendingFetchHeaders: unknown[];
          };
        }
      ).__slowmoTeardownSnapshot();
    let fired = 0;
    const frame = browser.requestAnimationFrame(() => {
      fired++;
    });
    const timer = browser.setTimeout(() => {
      fired++;
    });
    const interval = browser.setInterval(() => {
      fired++;
    });
    const worker = new browser.Worker();
    const recorder = new browser.MediaRecorder();
    recorder.state = "recording";
    const canvas = new HTMLCanvasElement().transferControlToOffscreen();
    Reflect.apply(worker.postMessage, worker, [{}, [canvas]]);
    Reflect.apply(browser.fetch, browser, ["/held"]);
    expect(snapshot()).toMatchObject({
      raf: [frame],
      timers: [
        { id: timer, kind: "timeout" },
        { id: interval, kind: "interval" },
      ],
      workers: [{ terminated: false, transfers: 1 }],
      recorders: [{ state: "recording" }],
    });
    expect(snapshot().offscreenCanvases).toHaveLength(1);
    expect(snapshot().pendingFetchHeaders).toHaveLength(1);
    expect(fired).toBe(0);
    callbacks.get(frame)!();
    callbacks.get(timer)!();
    browser.clearInterval(interval);
    worker.terminate();
    recorder.state = "inactive";
    complete();
    await fetch;
    expect(fired).toBe(2);
    expect(snapshot()).toMatchObject({
      raf: [],
      timers: [],
      workers: [{ terminated: true, transfers: 1 }],
      recorders: [{ state: "inactive" }],
      pendingFetchHeaders: [],
    });
  });
});
