import type { Page } from "@playwright/test";
import type { checkRunStats } from "../../src/canvas/checks/useChecks";

/** Wait for the real scheduled worker/replays, without flushing, editing or replacing any result.
 * Like waitForLiveSession, asynchronous preparation uses the whole-test hang backstop; assertions
 * about the rendered findings keep their normal UI timeout. A failed check cannot satisfy this. */
export async function waitForBackgroundChecks(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const ready = () => {
          const stats = (window as unknown as { __checks: typeof checkRunStats }).__checks;
          if (stats.finished > 0 && !stats.pending()) resolve();
          else requestAnimationFrame(ready);
        };
        ready();
      }),
  );
}
