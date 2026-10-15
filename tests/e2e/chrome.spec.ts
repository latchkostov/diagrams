import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, publicExamples } from "./fixtures";

// UX gate 3 chrome trims: things said once, where they belong. Selectors are data-testid only.

async function openLibrary(page: Page) {
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-library").click();
  await expect(page.getByTestId("library-dialog")).toBeVisible();
}

test.describe("said once", () => {
  test("a blank diagram is named by the picker only; the title card waits for the first node", async ({ page }) => {
    await page.goto("./");
    await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", "new");
    await expect(page.getByTestId("start-card")).toBeVisible();
    await expect(page.getByTestId("diagram-card")).toBeHidden();
    await page.getByTestId("start-blank").click();
    await expect(page.getByTestId("diagram-card")).toBeHidden();
    await page.keyboard.type("kafka topic");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("diagram-card")).toBeVisible();
    await expect(page.getByTestId("diagram-title")).toHaveText("Untitled diagram");
  });

  test("the diagram card leaves node and edge counts to the inspector", async ({ page }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    await expect(page.getByTestId("diagram-title")).toHaveText(publicExamples[0].title);
    await expect(page.getByTestId("diagram-card")).not.toContainText(/\d+ nodes?, \d+ edges?/);
  });

  test("Your diagrams shows the storage meter only once storage is half full", async ({ page }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    await openLibrary(page);
    await expect(page.getByTestId("library-usage")).toHaveCount(0);
  });

  test("past half full, the meter shows how much is used", async ({ page }) => {
    await page.addInitScript(() => {
      try {
        // About 55% of the ~5M-character budget.
        localStorage.setItem("filler", "x".repeat(2_750_000));
      } catch {
        // This browser's quota is smaller: the test skips below.
      }
    });
    await gotoCanvas(page, publicExamples[0].slug);
    test.skip(!(await page.evaluate(() => !!localStorage.getItem("filler"))), "storage quota too small");
    await openLibrary(page);
    await expect(page.getByTestId("library-usage")).toBeVisible();
    await expect(page.getByTestId("library-usage")).toContainText("used");
  });
});
