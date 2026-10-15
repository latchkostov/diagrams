import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./fixtures";
import { checksChrome, command, openExample, settledCanvas } from "./canvas";
import { GOLDENS } from "../lib/golden";

test("layout waits for background warning chrome, even when its worker result is delayed", async ({ page }) => {
  await page.addInitScript(() => {
    const Native = window.Worker;
    let held = true;
    const pending: (() => void)[] = [];
    window.Worker = class extends Native {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (options?.name !== "checks") return;
        this.addEventListener("message", (event) => {
          if (!held) return;
          event.stopImmediatePropagation();
          pending.push(() => this.dispatchEvent(new MessageEvent("message", { data: event.data })));
        });
      }
    };
    Object.assign(window, { heldChecks: () => pending.length });
    window.addEventListener("release-checks", () => {
      held = false;
      pending.splice(0).forEach((run) => run());
    });
  });
  await openExample(page, "shared-api-quotas");
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { heldChecks(): number }).heldChecks()))
    .toBeGreaterThan(0);
  await expect(page.getByTestId("checks-count")).toHaveCount(0);
  let ready = false;
  const chrome = checksChrome(page, "shared-api-quotas").then(() => {
    ready = true;
  });
  // Give the wait a chance to finish; frames, not a wall-clock delay.
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  expect(ready).toBe(false);
  await page.evaluate(() => window.dispatchEvent(new Event("release-checks")));
  await chrome;
  await command(page, "Auto-layout", "canvas.auto-layout");
  const drawn = await settledCanvas(page);
  const golden = JSON.parse(readFileSync(join(GOLDENS, "browser/layout/shared-api-quotas.json"), "utf8")) as {
    autoLayout: unknown;
  };
  expect(drawn).toEqual(golden.autoLayout);
});
