import type { Page } from "@playwright/test";

/** Capture one UI publication after pause; the readout has a slower cadence than rAF. */
export function nextLiveReadout(page: Page) {
  return page.getByTestId("live-canvas").evaluate(
    (canvas) =>
      new Promise<{ time: string; sum: string }>((resolve) => {
        const observer = new MutationObserver(() => {
          const time = canvas.getAttribute("data-sim-time");
          const sum = canvas.getAttribute("data-particle-sum");
          if (time === null || sum === null) return;
          observer.disconnect();
          canvas.removeAttribute("data-readout-awaiting");
          resolve({ time, sum });
        });
        observer.observe(canvas, { attributes: true, attributeFilter: ["data-sim-time"] });
        canvas.setAttribute("data-readout-awaiting", "true");
      }),
  );
}
