import { layerCount, LIVE_SETTLE_FRAMES, slowPhase, steadyTail } from "../../../src/bench/liveMetrics";
import type { CDPSession, Page } from "@playwright/test";
import type { AppHooks } from "./instrument";

declare global {
  interface Window {
    __liveCapture: {
      start(): void;
      stop(): { frames: number[]; peakTransitions: number };
      frames: number[];
    };
  }
}

/** Runs in the page. The first timestamp and transition sampling precede the traffic mutation. */
export function armLiveCapture({ panel, capMs }: { panel: boolean; capMs: number }) {
  let raf = 0;
  let started = false;
  let peakTransitions = 0;
  const frames: number[] = [];
  const sample = () => {
    peakTransitions = Math.max(
      peakTransitions,
      document.getAnimations().filter((a) => a instanceof CSSTransition && a.playState === "running").length,
    );
  };
  const tick = (now: number) => {
    frames.push(now);
    sample();
    if (now - frames[0] < capMs) raf = requestAnimationFrame(tick);
  };
  window.__liveCapture = {
    frames,
    start() {
      if (started) return;
      started = true;
      frames.push(performance.now());
      sample();
      raf = requestAnimationFrame(tick);
    },
    stop() {
      cancelAnimationFrame(raf);
      return { frames, peakTransitions };
    },
  };
  if (panel) {
    const slider = document.querySelector('[data-testid="capacity-traffic-mult"]');
    if (!slider) throw Error("Traffic slider missing");
    // Capture phase: run before React handles End and changes traffic, without including panel setup.
    slider.addEventListener("keydown", () => window.__liveCapture.start(), { capture: true, once: true });
  }
}

/** Both traffic paths arm the same capture, and keep it running throughout panel closure. */
export async function switchTraffic(
  page: Page,
  panel: boolean,
  arm: () => Promise<void>,
  closeCapMs: number,
): Promise<{ closeMs: number; closeTimedOut: number } | null> {
  if (!panel) {
    await arm();
    await page.evaluate(() => {
      window.__liveCapture.start();
      (window as unknown as Required<AppHooks>).__liveBench.timesTen();
    });
    return null;
  }
  await page.getByTestId("live-capacity").click();
  await page.getByTestId("capacity-panel").waitFor();
  const scale = await page.getByTestId("scale-indicator").getAttribute("data-scale");
  await page.getByTestId("scale-override").selectOption(String(scale));
  await page.getByTestId("capacity-traffic-mult").focus();
  await arm();
  await page.keyboard.press("End");
  await page.waitForFunction(
    () => document.querySelector('[data-testid="capacity-traffic-mult"]')?.getAttribute("data-value") === "10",
  );
  const t0 = Date.now();
  try {
    await page.getByTestId("capacity-close").click({ timeout: closeCapMs });
    await page.getByTestId("capacity-panel").waitFor({ state: "detached", timeout: closeCapMs });
    return { closeMs: Date.now() - t0, closeTimedOut: 0 };
  } catch {
    return { closeMs: Date.now() - t0, closeTimedOut: 1 };
  }
}

/** Arm peaks before the switch; collect frames after panel closure, through settling or the recording cap. */
export async function startTransient(b: { page: Page; cdp: CDPSession }, panel: boolean, capMs: number) {
  let peakLayers = 0;
  let disposed = false;
  const onLayers = (event: { layers?: unknown[] }) => {
    peakLayers = Math.max(peakLayers, layerCount(event) ?? 0);
  };
  b.cdp.on("LayerTree.layerTreeDidChange", onLayers);
  try {
    await b.cdp.send("LayerTree.enable");
    await b.page.evaluate(armLiveCapture, { panel, capMs: capMs });
  } catch (error) {
    b.cdp.off("LayerTree.layerTreeDidChange", onLayers);
    await b.cdp.send("LayerTree.disable");
    throw error;
  }
  return {
    async collect() {
      try {
        for (;;) {
          const sofar = await b.page.evaluate(() => window.__liveCapture.frames.slice());
          if (steadyTail(sofar).stable || (sofar.at(-1) ?? sofar[0]) - sofar[0] >= capMs) break;
          await b.page.waitForFunction(
            ({ count, cap }) => {
              const frames = window.__liveCapture.frames;
              return frames.length >= count || (frames.at(-1) ?? frames[0]) - frames[0] >= cap;
            },
            { count: sofar.length + LIVE_SETTLE_FRAMES, cap: capMs },
            { timeout: capMs * 2 },
          );
        }
        const { frames, peakTransitions } = await b.page.evaluate(() => window.__liveCapture.stop());
        const steady = steadyTail(frames);
        return { ...slowPhase(frames, steady), steadyFps: steady.fps, peakLayers, peakTransitions };
      } finally {
        await dispose();
      }
    },
    dispose,
  };
  async function dispose() {
    if (disposed) return;
    disposed = true;
    await b.page.evaluate(() => window.__liveCapture.stop());
    b.cdp.off("LayerTree.layerTreeDidChange", onLayers);
    await b.cdp.send("LayerTree.disable");
  }
}
