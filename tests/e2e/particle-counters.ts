import type { Page } from "@playwright/test";
import type {} from "./fixtures";

export interface RenderCounters {
  frames: number;
  particles: number;
}

declare global {
  interface Window {
    __particleCounters?: {
      snapshot(): RenderCounters;
      holdReports(): number;
      held(): number;
      releaseReports(): void;
    };
  }
}

/** Observe actual paints without changing frame requests or their transferable ownership. */
export function installParticleCountersInPage() {
  const Native = window.Worker;
  let current = 0;
  let epoch = -1;
  let counters: RenderCounters = { frames: 0, particles: 0 };
  let holding = false;
  const held: { worker: Worker; data: unknown }[] = [];
  window.__particleCounters = {
    snapshot: () => ({ ...counters }),
    holdReports() {
      holding = true;
      return counters.frames;
    },
    held: () => held.length,
    releaseReports() {
      holding = false;
      for (const { worker, data } of held.splice(0)) worker.dispatchEvent(new MessageEvent("message", { data }));
    },
  };
  window.Worker = class extends Native {
    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options);
      if (!String(url).includes("particleWorker")) return;
      const workerId = ++current;
      epoch = -1;
      counters = { frames: 0, particles: 0 };
      this.addEventListener("message", (event: MessageEvent) => {
        if (workerId !== current) return;
        const report = event.data;
        if (
          !report ||
          report.type !== "ack" ||
          typeof report.epoch !== "number" ||
          typeof report.frames !== "number" ||
          typeof report.drawn !== "number"
        )
          return;
        if (report.epoch > epoch || (report.epoch === epoch && report.frames >= counters.frames)) {
          epoch = report.epoch;
          counters = { frames: report.frames, particles: report.drawn };
        }
        if (holding) {
          event.stopImmediatePropagation();
          held.push({ worker: this, data: event.data });
        }
      });
    }
  };
}

export async function installParticleCounters(page: Page) {
  await page.addInitScript(installParticleCountersInPage);
}

/** A one-pixel readback is a FIFO barrier after previously posted worker frames, not a paint request. */
export async function rendererCountersInPage(settled: boolean): Promise<RenderCounters> {
  const canvas = document.querySelector<HTMLElement>('[data-testid="live-canvas"]');
  if (!canvas) throw new Error("Expected a live canvas");
  if (canvas.dataset.renderer !== "worker")
    return {
      frames: Number(canvas.getAttribute("data-frames")),
      particles: Number(canvas.getAttribute("data-particles")),
    };
  const counters = window.__particleCounters;
  if (!counters) throw new Error("Install the particle counter observer before navigation");
  if (settled) {
    if (!window.__liveProbe) throw new Error("Expected the renderer readback hook");
    const rect = canvas.getBoundingClientRect();
    await window.__liveProbe("base", { x: rect.left, y: rect.top, width: 1, height: 1 });
  }
  return counters.snapshot();
}

export function rendererCounters(page: Page, settled = false) {
  return page.evaluate(rendererCountersInPage, settled);
}
