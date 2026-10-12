import { test, expect, gotoGallery, gotoCanvas, gotoLab, publicExamples, expectNoErrors } from "./fixtures";

/** Every view loads without console errors or failed requests (dev server). */
test.describe("smoke", () => {
  test.beforeEach(async ({ page, consoleErrors }) => {
    page.on("response", (r) => {
      if (r.status() >= 400) consoleErrors.push(`HTTP ${r.status()} for ${r.url()}`);
    });
  });

  test("gallery", async ({ page, consoleErrors }) => {
    await gotoGallery(page);
    await expect(page.getByTestId(/^stencil-tile-/).first()).toBeVisible();
    expectNoErrors(consoleErrors);
  });

  // One test per example: each is a full page load, and on the dev server (hundreds of unbundled modules
  // per load) a CI runner takes 4 to 10 s for one. All of them in one test overran its 30 s.
  for (const ex of publicExamples)
    test(`canvas: ${ex.slug}`, async ({ page, consoleErrors }) => {
      await gotoCanvas(page, ex.slug);
      await expect(page.getByTestId(`node-${ex.nodeIds[0]}`)).toBeVisible();
      expectNoErrors(consoleErrors);
    });

  test("lab", async ({ page, consoleErrors }) => {
    await gotoLab(page);
    await expect(page.getByTestId("lab-stage")).toBeVisible();
    expectNoErrors(consoleErrors);
  });

  test("unknown view and example fall back gracefully", async ({ page, consoleErrors }) => {
    await page.goto("./?view=nope");
    await expect(page.getByTestId("canvas-view")).toBeVisible();
    await page.goto("./?view=canvas&example=does-not-exist");
    await expect(page.getByTestId("canvas-view")).toBeVisible();
    await expect(page).not.toHaveURL(/does-not-exist/);
    await page.goto("./?view=lab&preset=does-not-exist");
    await expect(page.getByTestId("lab-stage")).toHaveAttribute("data-preset", "nodes-states");
    expectNoErrors(consoleErrors);
  });

  test("a corrupt autosave doesn't break the canvas", async ({ page, consoleErrors }) => {
    const ex = publicExamples[0];
    await page.addInitScript((key) => localStorage.setItem(key, "{ not json"), `diagrams.autosave.v1:${ex.slug}`);
    await gotoCanvas(page, ex.slug);
    await expect(page.getByTestId(`node-${ex.nodeIds[0]}`)).toBeVisible();
    expectNoErrors(consoleErrors);
  });
});
