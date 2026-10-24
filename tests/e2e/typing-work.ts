import type { Page } from "@playwright/test";

/**
 * Chrome's main-thread CPU work per key, through its next paint. Thread ticks exclude time another
 * browser or a simulation worker owns the CPU; Event Timing includes that scheduling delay (#114).
 * Include all tasks, React commits and layout, so moving simulation work onto this thread still fails.
 * With measureCpu=false, retain trusted input and the paint boundary for operation counts without reading a clock.
 */
export async function typingWork(page: Page, measureCpu = true, painted?: () => Promise<unknown>) {
  const cdp = await page.context().newCDPSession(page);
  if (measureCpu) await cdp.send("Performance.enable", { timeDomain: "threadTicks" });
  const read = async () => {
    const metric = (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === "TaskDuration");
    if (!metric) throw new Error("Chrome did not report main-thread task time");
    return metric.value;
  };
  return {
    async key(ch: string, settled: () => Promise<unknown> = async () => {}) {
      const before = measureCpu ? await read() : 0;
      // Trusted browser input, without Playwright serializing the entire stress diagram into a
      // trace snapshot for every key. That instrumentation would dominate the work being measured.
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, text: ch });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
      await settled();
      if (painted) await painted();
      else
        await cdp.send("Runtime.evaluate", {
          expression: "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
          awaitPromise: true,
        });
      return measureCpu ? (await read()) - before : 0;
    },
    close: () => cdp.detach(),
  };
}

export const median = (xs: readonly number[]) => {
  if (!xs.length) throw new Error("No typing samples collected");
  return [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
};
