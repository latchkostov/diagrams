// The browser tier's `test`: after each test, every golden it changed is reported at once
// (tests/parity/lib/golden.ts).
import { test as base, type Page } from "@playwright/test";
import { assertGoldens } from "../lib/golden";

export const test = base.extend<{
  goldens: undefined;
  naturalDrawing: undefined;
  cpuThrottle: ReadonlyMap<Page, number>;
  cpuThrottleRate: number;
}>({
  cpuThrottleRate: [Number(process.env.PARITY_CPU_THROTTLE ?? 1), { option: true }],
  cpuThrottle: [
    async ({ context, cpuThrottleRate: rate }, use) => {
      if (!Number.isFinite(rate) || rate < 1) throw new Error("PARITY_CPU_THROTTLE must be at least 1");
      const targets = new Map<Page, number>();
      const newPage = context.newPage.bind(context);
      // Playwright's page fixture and exported file viewers both use context.newPage().
      // Await the CDP command here: an async `page` event alone can race the caller's goto().
      context.newPage = async () => {
        const page = await newPage();
        if (rate > 1) {
          const cdp = await context.newCDPSession(page);
          await cdp.send("Emulation.setCPUThrottlingRate", { rate });
          targets.set(page, rate);
        }
        return page;
      };
      try {
        await use(targets);
      } finally {
        context.newPage = newPage;
      }
    },
    { auto: true },
  ],
  // The browser tier pins the natural drawing (measured cards, routed edges, placed labels) at every
  // fitted zoom. Below 60% the editor shows settled screen-only chips instead; they never reach an export,
  // a layout or a measured size, and tests/e2e/lowzoom-*.spec.ts cover them (docs/PARITY.md, Browser tier).
  naturalDrawing: [
    async ({ context }, use) => {
      await context.addInitScript(() => localStorage.setItem("diagrams.lowZoom", "off"));
      await use(undefined);
    },
    { auto: true },
  ],
  goldens: [
    // eslint-disable-next-line no-empty-pattern -- Playwright's fixture signature: this one uses no other fixture.
    async ({}, use) => {
      await use(undefined);
      assertGoldens();
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
