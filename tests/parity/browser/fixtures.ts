// The browser tier's `test`: after each test, every golden it changed is reported at once
// (tests/parity/lib/golden.ts).
import { test as base } from "@playwright/test";
import { assertGoldens } from "../lib/golden";

export const test = base.extend<{ goldens: undefined; cpuThrottle: undefined }>({
  cpuThrottle: [
    async ({ page }, use) => {
      const rate = Number(process.env.PARITY_CPU_THROTTLE ?? 1);
      if (!Number.isFinite(rate) || rate < 1) throw new Error("PARITY_CPU_THROTTLE must be at least 1");
      if (rate > 1) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate });
      }
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
