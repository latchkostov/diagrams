import { test, expect, gotoLive, expectNoErrors } from "./fixtures";
import { chunk, holdChunk, releaseAndEvaluate } from "./chunk";

const DETAILS = chunk("NodeDetails", "src/live/NodeDetails.tsx");
const URL = "./?view=canvas&example=blocking-call&live=1&paused=1";

test("a cold node-details failure keeps its keyboard stop and exposes shared recovery", async ({ page }) => {
  const held = await holdChunk(page, DETAILS);
  try {
    await gotoLive(page, URL);
    await page.getByTestId("node-caller").evaluate((el) => el.parentElement?.focus());
    await expect.poll(held.requested).toBe(true);
    await page.keyboard.press("Enter");
    const loading = page.getByTestId("live.node-details-loading");
    await expect(loading).toBeFocused();
    await expect(loading).toHaveAttribute("aria-busy", "true");
    held.fail = true;
    held.release();
    await expect(page.getByTestId("lazy-load-retry")).toBeVisible();
    await expect(loading).toHaveAttribute("aria-busy", "false");
    await expect(loading).toHaveAccessibleName(
      "Part of the app couldn't be downloaded. Check your connection and try again.",
    );
    await expect(loading).toBeFocused();
  } finally {
    held.release();
  }
});

for (const key of ["Tab", "Enter"]) {
  test(`cold node details hand off the ${key} loading stop to the card`, async ({ page, consoleErrors }) => {
    const held = await holdChunk(page, DETAILS);
    try {
      await gotoLive(page, URL);
      await page.getByTestId("node-caller").evaluate((el) => el.parentElement?.focus());
      await expect.poll(held.requested).toBe(true);
      await page.keyboard.press(key);
      await expect(page.getByTestId("live.node-details-loading")).toBeFocused();
      await releaseAndEvaluate(page, DETAILS, held.release);
      const card = page.getByTestId("node-detail-caller");
      await expect(card).toBeFocused();
      await expect(card).toHaveAttribute("data-pinned", String(key === "Enter"));
      await page.keyboard.press("Escape");
      await expect(card).toHaveCount(0);
      expect(await page.getByTestId("node-caller").evaluate((el) => el.parentElement === document.activeElement)).toBe(
        true,
      );
      expectNoErrors(consoleErrors);
    } finally {
      held.release();
    }
  });
}

for (const leave of ["focus", "menu", "escape", "next-node"] as const) {
  test(`cold node details cannot reclaim focus after ${leave}`, async ({ page, consoleErrors }) => {
    const held = await holdChunk(page, DETAILS);
    try {
      await gotoLive(page, URL);
      await page.getByTestId("node-caller").evaluate((el) => el.parentElement?.focus());
      await expect.poll(held.requested).toBe(true);
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("live.node-details-loading")).toBeFocused();
      if (leave === "focus") {
        await page.getByTestId("live-play").focus();
        await expect(page.getByTestId("live-play")).toBeFocused();
      } else if (leave === "menu") {
        await page.getByTestId("file-button").click();
        await expect(page.getByTestId("file-menu")).toBeVisible();
      } else if (leave === "escape") {
        await page.keyboard.press("Escape");
        await expect(page.getByTestId("live.node-details-loading")).toHaveCount(0);
      } else {
        await page.keyboard.press("Tab");
        await expect
          .poll(() => page.getByTestId("node-partner").evaluate((el) => el.parentElement === document.activeElement))
          .toBe(true);
      }
      const owner = await page.evaluateHandle(() => document.activeElement);
      expect(await owner.evaluate((el) => !!el && el !== document.body)).toBe(true);
      await releaseAndEvaluate(page, DETAILS, held.release);
      await expect.poll(() => owner.evaluate((el) => el === document.activeElement)).toBe(true);
      if (leave === "focus") {
        await expect(page.getByTestId("node-detail-caller")).toBeVisible();
      } else if (leave === "next-node") {
        await expect(page.getByTestId("node-detail-partner")).toBeVisible();
        await expect(page.getByTestId("node-detail-caller")).toHaveCount(0);
      } else await expect(page.getByTestId("node-detail-caller")).toHaveCount(0);
      expectNoErrors(consoleErrors);
    } finally {
      held.release();
    }
  });
}
