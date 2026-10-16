import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./fixtures";
import { checksChrome, command, openExample, settledCanvas } from "./canvas";
import { GOLDENS } from "../lib/golden";
import { holdChecks, holdResizeObservers } from "./holdReadiness";

test("layout waits for background warning chrome, even when its worker result is delayed", async ({ page }) => {
  await page.addInitScript(holdChecks);
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

test("opening fit remains deterministic across delayed warning delivery", async ({ page, context }) => {
  const viewports: string[] = [];
  for (const [target, checksFirst] of [
    [page, true],
    [await context.newPage(), false],
  ] as const) {
    await target.addInitScript(holdChecks);
    await target.addInitScript(holdResizeObservers, true);
    await target.goto("./?view=canvas&example=shared-api-quotas");
    await expect(target.getByTestId("diagram-title")).toBeVisible();
    await expect(target.getByTestId("canvas-wrap")).toHaveAttribute("data-fit-pending", "true");
    await expect
      .poll(() => target.evaluate(() => (window as unknown as { heldChecks(): number }).heldChecks()))
      .toBeGreaterThan(0);
    if (checksFirst) await target.evaluate(() => window.dispatchEvent(new Event("release-checks")));
    await target.evaluate(() => window.dispatchEvent(new Event("release-resize-observers")));
    const opening = await settledCanvas(target);
    if (!checksFirst) await target.evaluate(() => window.dispatchEvent(new Event("release-checks")));
    await checksChrome(target, "shared-api-quotas");
    // Warning delivery must neither change the opening target nor trigger a corrective fit.
    expect((await settledCanvas(target)).viewport).toBe(opening.viewport);
    viewports.push(opening.viewport);
  }
  expect(viewports[0]).toBe(viewports[1]);
  const golden = JSON.parse(readFileSync(join(GOLDENS, "browser/render/shared-api-quotas.json"), "utf8")) as {
    viewport: string;
  };
  expect(viewports[0]).toBe(golden.viewport);
});
