import { mkdirSync } from "node:fs";
import { test, expect, gotoCanvas, gotoGallery, expectNoErrors } from "./fixtures";
import { callTool, installFakeModelContext, MOD, toolNames } from "./ai-helpers";

const searches = [
  ["external", "generic.external-api"],
  ["Iterable", "iterable"],
  ["Stripe", "stripe"],
] as const;

async function screenshot(page: import("@playwright/test").Page, name: string) {
  if (!process.env.P5A_SCREENSHOTS) return;
  mkdirSync("docs/screenshots/round35", { recursive: true });
  await page.screenshot({ path: `docs/screenshots/round35/${name}.png` });
}

test.describe("external discovery", () => {
  for (const [query, id] of searches) {
    test(`library and Ctrl+K find ${query}`, async ({ page, consoleErrors }) => {
      await gotoCanvas(page, "aws-fanout");
      await page.getByTestId("palette-search").fill(query);
      await expect(page.getByTestId(`palette-item-${id}`)).toBeVisible();
      await page.keyboard.press(`${MOD}+k`);
      await expect(page.getByTestId("command-input")).toBeFocused();
      await page.getByTestId("command-input").fill(query);
      await expect(page.getByTestId(`command-item-stencil:${id}`)).toBeVisible();
      if (query === "Iterable") await screenshot(page, "palette-iterable");
      await page.getByTestId(`command-item-stencil:${id}`).click();
      await expect(page.getByTestId(`node-${id.replace("generic.", "")}-1`)).toBeVisible();
      expectNoErrors(consoleErrors);
    });

    test(`gallery finds ${query}`, async ({ page }) => {
      await gotoGallery(page);
      await page.getByTestId("gallery-search").fill(query);
      await expect(page.getByTestId("gallery-section-clients")).toContainText("Clients & external");
      await expect(page.getByTestId("gallery-clients-external").getByTestId(`stencil-tile-${id}`)).toBeVisible();
    });
  }

  for (const width of [1024, 1280]) {
    test(`Clients & external folds and reopens at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await gotoCanvas(page, "aws-fanout");
      if (!(await page.getByTestId("palette-search").isVisible())) await page.getByTestId("palette-toggle").click();
      const section = page.getByTestId("palette-section-clients");
      await expect(section).toContainText("Clients & external");
      await expect(section).toHaveAttribute("aria-expanded", "false");
      await page.getByTestId("palette-section-messaging").click();
      await section.click();
      await expect(
        page.getByTestId("palette-clients-sources").getByTestId("palette-item-client.browser"),
      ).toBeVisible();
      await expect(
        page.getByTestId("palette-clients-external").getByTestId("palette-item-generic.external-api"),
      ).toBeVisible();
      await expect(page.getByTestId("palette-clients-external").getByTestId("palette-item-iterable")).toBeVisible();
      await page.getByTestId("palette-item-iterable").scrollIntoViewIfNeeded();
      await screenshot(page, `clients-${width}`);
      await section.click();
      await expect(page.getByTestId("palette-item-iterable")).toHaveCount(0);
      await page.reload();
      await expect(page.getByTestId("canvas-view")).toBeVisible();
      if (!(await page.getByTestId("palette-search").isVisible())) await page.getByTestId("palette-toggle").click();
      await expect(section).toHaveAttribute("aria-expanded", "false");
    });
  }

  for (const width of [1024, 1280, 1600]) {
    test(`gallery families fit and external fallbacks remain reachable at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await gotoGallery(page);
      const generic = page.getByTestId("family-chip-generic");
      if (width === 1024) await expect(generic).toHaveAttribute("data-folded", "1");
      if (width === 1600)
        await expect
          .poll(() =>
            page
              .getByTestId(/^family-chip-/)
              .evaluateAll((els) => els.filter((el) => el.hasAttribute("data-folded")).length),
          )
          .toBe(0);
      await expect
        .poll(() =>
          page
            .getByTestId("family-chip-all")
            .evaluate((el) => !!el.parentElement && el.parentElement.scrollWidth <= el.parentElement.clientWidth),
        )
        .toBe(true);
      await screenshot(page, `gallery-${width}`);
      const folded = await generic.getAttribute("data-folded");
      await page.getByTestId("vendor-overflow").click();
      await expect(page.getByTestId("context-menu-item-vendor-family:saas")).toBeVisible();
      if (folded) await page.getByTestId("context-menu-item-family:generic").click();
      else {
        await page.keyboard.press("Escape");
        await generic.click();
      }
      await expect(generic).toBeVisible();
      await expect(generic).toHaveAttribute("aria-pressed", "true");
      await page.getByTestId("gallery-search").fill("external");
      await expect(page.getByTestId("stencil-tile-generic.external-api")).toBeVisible();
      await screenshot(page, `gallery-external-${width}`);
      await page.getByTestId("family-chip-all").click();
      await page.getByTestId("stencil-tile-iterable").scrollIntoViewIfNeeded();
      await screenshot(page, `gallery-vendors-${width}`);
      await page.getByTestId("gallery-search").fill("Iterable");
      const saas = page.getByTestId("family-chip-saas");
      if (await saas.getAttribute("data-folded")) {
        await page.getByTestId("vendor-overflow").click();
        await page.getByTestId("context-menu-item-family:saas").click();
      } else await saas.click();
      await expect(page.getByTestId("stencil-tile-iterable")).toBeVisible();
      await expect(saas).toHaveAttribute("aria-pressed", "true");
      await page.getByTestId("family-chip-all").click();
      await expect(page.getByTestId("family-chip-all")).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("stencil-tile-generic.marketing")).toBeVisible();
      await screenshot(page, `gallery-iterable-${width}`);
    });
  }

  test("WebMCP finds generic and named external APIs within the Clients category", async ({ page }) => {
    await installFakeModelContext(page);
    await gotoCanvas(page, "aws-fanout");
    await expect.poll(() => toolNames(page)).toContain("find_stencils");
    for (const [query, id] of searches) {
      const result = await callTool(page, "find_stencils", { query, category: "clients", limit: 10 });
      expect(result.isError).toBe(false);
      expect(result.text).toContain(`"id":"${id}"`);
    }
  });
});
